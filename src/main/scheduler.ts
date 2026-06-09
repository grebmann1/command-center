import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Project,
  ScheduleCreateInput,
  ScheduledTask,
  ScheduleRun,
  ScheduleUpdateInput
} from '../shared/types.js';
import { MIN_INTERVAL_MS, parseEvery as parseEveryShared } from '../shared/parse-every.js';
import type { PtyManager } from './pty.js';
import type { IInboxStore } from './inbox-store.js';
import { deleteSchedule, listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { store as Store } from './store.js';

/** Profiles that drive a Claude Code CLI — the only ones we treat the
 *  scheduler `prompt` as a positional argv element for. For `shell` profile,
 *  the prompt is ignored (it would be interpreted as a shell command). */
function isClaudeProfileId(p: string): boolean {
  return p === 'claude' || p === 'claude-resume' || p === 'claude-yolo';
}

/** History buffer cap. Hand-editing `retain` higher in the JSON works, but
 *  we won't surface a bigger value than this in the UI. */
const MAX_RETAIN = 100;

export { parseEveryShared as parseEvery };

interface Live {
  task: ScheduledTask;
  timer: NodeJS.Timeout | null;
  /** Maps a fired session id → its index in `status.runs`, so the exit-time
   *  recordRun can update the right entry even when interleaved with other
   *  schedules' fires. */
  runIndexBySession: Map<string, number>;
}

type Logger = (context: string, err: unknown) => void;

type Deps = {
  ptys: PtyManager;
  store: typeof Store;
  inbox?: IInboxStore;
  logger?: Logger;
};

/**
 * In-process scheduler. Holds a setTimeout per enabled task and recomputes
 * `nextRunAt` after every fire so wall-clock drift doesn't accumulate.
 *
 * Lifetime contract: scheduler runs only while the Electron main process is
 * alive. There is no daemon and no OS cron — closing the app stops fires.
 * On boot, `loadAll()` re-reads all schedules from disk and computes the
 * next fire as `max(now + 5s, lastRunAt + every)`. The 5s grace prevents
 * a fire-storm on relaunch when many overdue schedules pile up.
 */
export class SchedulerManager extends EventEmitter {
  private live = new Map<string, Live>();
  /** Lazily set after the window opens. We don't fire before then. */
  private deps: Deps | null = null;

  setDeps(deps: Deps) {
    this.deps = deps;
  }

  private log(context: string, err: unknown) {
    if (this.deps?.logger) {
      this.deps.logger(context, err);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[scheduler] ${context}:`, err);
    }
  }

  list(): ScheduledTask[] {
    return [...this.live.values()].map((l) => l.task);
  }

  /** Read every schedule from disk and (re)arm enabled ones. Called on boot. */
  loadAll(projects: Project[]) {
    this.stopAll();
    const tasks = listAllSchedules(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid schedule file dropped: ${reason}`)
    );
    for (const task of tasks) {
      this.live.set(task.id, this.makeLive(task));
      if (task.enabled) this.arm(task.id);
    }
    this.emit('changed');
  }

  create(input: ScheduleCreateInput): ScheduledTask {
    if (!input.name?.trim()) throw new Error('name is required');
    if (!input.projectId) throw new Error('projectId is required');
    const intervalMs = parseEveryShared(input.every);
    if (intervalMs === null) throw new Error(`invalid interval: ${input.every}`);

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      enabled: input.enabled ?? true,
      projectId: input.projectId,
      profile: input.profile,
      extraArgs: input.extraArgs,
      prompt: input.prompt,
      schedule: { every: input.every },
      overlap: 'skip',
      history: { retain: clampRetain(input.retain ?? 10) },
      status: {
        runCount: 0,
        runs: [],
        nextRunAt: new Date(Date.now() + intervalMs).toISOString()
      },
      createdAt: now,
      updatedAt: now,
      source: input.scope ?? 'global',
      notifyInbox: input.notifyInbox ?? false
    };
    this.persist(task);
    this.live.set(task.id, this.makeLive(task));
    if (task.enabled) this.arm(task.id);
    this.emit('changed');
    return task;
  }

  update(id: string, patch: ScheduleUpdateInput): ScheduledTask {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    const next: ScheduledTask = { ...live.task };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.projectId !== undefined) next.projectId = patch.projectId;
    if (patch.profile !== undefined) next.profile = patch.profile;
    if (patch.extraArgs !== undefined) next.extraArgs = patch.extraArgs;
    if (patch.prompt !== undefined) next.prompt = patch.prompt;
    if (patch.every !== undefined) {
      if (parseEveryShared(patch.every) === null) throw new Error(`invalid interval: ${patch.every}`);
      next.schedule = { every: patch.every };
    }
    if (patch.retain !== undefined) next.history = { retain: clampRetain(patch.retain) };
    if (patch.notifyInbox !== undefined) next.notifyInbox = patch.notifyInbox;
    next.updatedAt = new Date().toISOString();
    this.persist(next);
    live.task = next;
    this.disarm(id);
    if (next.enabled) this.arm(id);
    this.emit('changed');
    return next;
  }

  setEnabled(id: string, enabled: boolean): ScheduledTask | null {
    const live = this.live.get(id);
    if (!live) return null;
    return this.update(id, { enabled });
  }

  remove(id: string) {
    this.disarm(id);
    this.live.delete(id);
    if (this.deps) deleteSchedule(id, this.deps.store.listProjects());
    this.emit('changed');
  }

  /** Fire immediately, ignoring the timer and the overlap check. */
  runNow(id: string): ScheduledTask {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    this.fire(id, { manual: true });
    return live.task;
  }

  stopAll() {
    for (const id of [...this.live.keys()]) this.disarm(id);
    this.live.clear();
  }

  /**
   * Disarm and drop every live schedule referencing the removed project.
   * Called from the projects.remove IPC handler. The on-disk JSON files
   * (under `<project.path>/.cc-center/schedules/`) are not deleted — if the
   * project is re-added later, `loadAll` will rediscover them.
   */
  onProjectRemoved(projectId: string) {
    let dropped = 0;
    for (const id of [...this.live.keys()]) {
      const live = this.live.get(id);
      if (!live) continue;
      if (live.task.projectId === projectId) {
        this.disarm(id);
        this.live.delete(id);
        dropped += 1;
      }
    }
    if (dropped > 0) this.emit('changed');
  }

  // ----- internals -----------------------------------------------------------

  private makeLive(task: ScheduledTask): Live {
    return {
      task,
      timer: null,
      runIndexBySession: new Map()
    };
  }

  private persist(task: ScheduledTask) {
    if (!this.deps) return;
    saveSchedule(task, this.deps.store.listProjects());
  }

  private arm(id: string) {
    const live = this.live.get(id);
    if (!live || !live.task.enabled) return;
    const intervalMs = parseEveryShared(live.task.schedule.every) ?? MIN_INTERVAL_MS;
    const lastRun = live.task.status.lastRunAt
      ? Date.parse(live.task.status.lastRunAt)
      : 0;
    const now = Date.now();
    // If `lastRunAt` is more than one full interval overdue (e.g. the schedule
    // sat disabled for days, or the laptop was asleep), don't drag it forward
    // by chained intervals — re-arm fresh at `now + interval`. Prevents drift
    // compounding and avoids stampedes on resume.
    const veryStale = lastRun > 0 && lastRun + intervalMs < now - intervalMs;
    const targetAt = lastRun && !veryStale ? lastRun + intervalMs : now + intervalMs;
    // 5-second grace floor so a backlog of overdue schedules doesn't fire all
    // at once on app launch.
    const delay = Math.max(targetAt - now, 5_000);
    live.task.status.nextRunAt = new Date(now + delay).toISOString();
    live.timer = setTimeout(() => this.fire(id, { manual: false }), delay);
  }

  private disarm(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
  }

  private fire(id: string, opts: { manual: boolean }) {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    live.timer = null;

    const project = this.deps.store.listProjects().find((p) => p.id === live.task.projectId);
    if (!project) {
      this.log(
        `fire ${id}`,
        `project ${live.task.projectId} not found for schedule "${live.task.name}"`
      );
      this.recordRun(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        result: 'error',
        message: `project ${live.task.projectId} not found`
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    // Overlap check: skip an auto fire if *any* session this schedule
    // previously spawned (auto or manual) is still alive. Walking the run
    // history rather than a single `lastAutoSessionId` catches the case
    // where the user kicked off a long-running task with "Run now" and the
    // next interval-driven fire would otherwise stack on top of it.
    // Manual "Run now" still overrides — clicking the button is an explicit
    // user choice to spawn another tab regardless.
    if (!opts.manual) {
      const aliveIds = new Set(
        this.deps.ptys
          .list(live.task.projectId)
          .filter((s) => s.status === 'running' || s.status === 'starting')
          .map((s) => s.id)
      );
      const aliveRunSessionId = live.task.status.runs
        .map((r) => r.sessionId)
        .find((sid): sid is string => !!sid && aliveIds.has(sid));
      if (aliveRunSessionId) {
        this.log(
          `fire ${id}`,
          `skipped: previous run ${aliveRunSessionId} still active`
        );
        this.recordRun(id, {
          id: randomUUID(),
          at: new Date().toISOString(),
          result: 'skipped',
          sessionId: aliveRunSessionId,
          message: 'previous run still active'
        });
        if (live.task.enabled) this.arm(id);
        return;
      }
    }

    const runId = randomUUID();
    const profile = live.task.profile;

    // Build extraArgs. For claude-family profiles, the prompt is appended as
    // a positional argv element — Claude's CLI signature is `claude [options]
    // [prompt]`, so the spawned interactive session picks it up automatically.
    // For shell profiles we ignore the prompt (it would be parsed as a shell
    // command, which is not what users want).
    const userExtraArgs = live.task.extraArgs ?? [];
    const promptArgs =
      live.task.prompt && isClaudeProfileId(profile) ? [live.task.prompt] : [];
    const extraArgs = [...userExtraArgs, ...promptArgs];

    let session;
    try {
      session = this.deps.ptys.create({
        projectId: project.id,
        profile,
        cwd: project.path,
        cols: 80,
        rows: 24,
        config: this.deps.store.getConfig(),
        projectSettings: this.deps.store.getProjectSettings(project.id),
        extraArgs,
        title: `Scheduled: ${live.task.name}`,
        remote: project.remote
      });
    } catch (err) {
      this.log(`fire ${id} pty.create`, err);
      this.recordRun(id, {
        id: runId,
        at: new Date().toISOString(),
        result: 'error',
        message: err instanceof Error ? err.message : String(err)
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    const runStartedAt = new Date().toISOString();
    const runStartMs = Date.now();

    const onExit = (sessionId: string, exitCode: number) => {
      if (sessionId !== session.id) return;
      this.deps?.ptys.off('exit', onExit);
      const exitMs = Date.now();
      const finalRun: ScheduleRun = {
        id: runId,
        at: runStartedAt,
        result: exitCode === 0 ? 'success' : 'error',
        sessionId: session.id,
        durationMs: exitMs - runStartMs,
        message: exitCode === 0 ? undefined : `exit ${exitCode}`
      };
      this.recordRun(id, finalRun);
      if (live.task.notifyInbox) {
        void this.notifyInboxOnExit(live.task, finalRun, project);
      }
    };
    this.deps.ptys.on('exit', onExit);

    // Optimistically record the run as success at fire time so the UI shows the
    // schedule advanced, even if the session is long-lived. The exit handler
    // above will overwrite the entry once the pty closes.
    this.recordRun(id, {
      id: runId,
      at: runStartedAt,
      result: 'success',
      sessionId: session.id
    });

    if (live.task.enabled && !opts.manual) this.arm(id);
  }

  /**
   * Append a one-line summary InboxEntry for a finished run. Best-effort.
   * The user can scroll back through the schedule's tab in the project for
   * the full output — we no longer mirror the log into the inbox body.
   */
  private async notifyInboxOnExit(
    task: ScheduledTask,
    run: ScheduleRun,
    project: Project
  ) {
    if (!this.deps?.inbox) return;
    try {
      const durationStr =
        run.durationMs !== undefined ? ` in ${formatDuration(run.durationMs)}` : '';
      const body = `**${task.name}** — ${run.result}${durationStr}`;
      await this.deps.inbox.append({
        projectId: project.id,
        projectLabel: project.name,
        comments: body,
        sessionId: run.sessionId
      });
    } catch (err) {
      this.log(`notifyInbox ${task.id}`, err);
    }
  }

  private recordRun(id: string, run: ScheduleRun) {
    const live = this.live.get(id);
    if (!live) return;
    const status = live.task.status;
    // Prefer matching by run.id (stable per fire) and fall back to sessionId
    // for older paths. Same goal: update the existing entry rather than push
    // a new one when this is the exit-time tail of a previously optimistic
    // record.
    const knownIdxById = run.id
      ? status.runs.findIndex((r) => r.id === run.id)
      : -1;
    const knownIdx =
      knownIdxById >= 0
        ? knownIdxById
        : run.sessionId
        ? live.runIndexBySession.get(run.sessionId)
        : undefined;
    if (knownIdx !== undefined && knownIdx >= 0 && status.runs[knownIdx]) {
      status.runs[knownIdx] = { ...status.runs[knownIdx], ...run };
    } else {
      status.runs = [run, ...status.runs].slice(0, live.task.history.retain);
      status.runCount += 1;
      // After unshift everything shifts right by one. Rebuild the index from
      // surviving entries so we can still find them on their exit-time update.
      live.runIndexBySession.clear();
      status.runs.forEach((r, idx) => {
        if (r.sessionId) live.runIndexBySession.set(r.sessionId, idx);
      });
    }
    if (run.result === 'error') {
      this.log(`run ${id}`, run.message ?? 'error (no message)');
    }
    status.lastRunAt = run.at;
    status.lastRunResult = run.result;
    status.lastRunSessionId = run.sessionId;
    this.persist(live.task);
    this.emit('changed');
  }
}

function clampRetain(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(MAX_RETAIN, Math.round(n)));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}
