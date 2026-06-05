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
import { deleteSchedule, listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { store as Store } from './store.js';

/** History buffer cap. Hand-editing `retain` higher in the JSON works, but
 *  we won't surface a bigger value than this in the UI. */
const MAX_RETAIN = 100;

export { parseEveryShared as parseEvery };

interface Live {
  task: ScheduledTask;
  timer: NodeJS.Timeout | null;
  /** Session id from the most recent automatic fire. Used for overlap detection. */
  lastAutoSessionId: string | null;
  /** Session id from the most recent manual "Run now". Informational only. */
  lastManualSessionId: string | null;
  /** Maps a fired session id → its index in `status.runs`, so the exit-time
   *  recordRun can update the right entry even when interleaved with other
   *  schedules' fires. */
  runIndexBySession: Map<string, number>;
}

type Logger = (context: string, err: unknown) => void;

type Deps = {
  ptys: PtyManager;
  store: typeof Store;
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
      source: input.scope ?? 'global'
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
      lastAutoSessionId: null,
      lastManualSessionId: null,
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
        at: new Date().toISOString(),
        result: 'error',
        message: `project ${live.task.projectId} not found`
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    // Overlap check: if the previous *automatic* fire's pty is still alive, skip.
    // Manual "Run now" fires never set lastAutoSessionId, so they don't poison
    // the overlap state and the next scheduled fire still respects overlap.
    if (!opts.manual && live.lastAutoSessionId) {
      const stillAlive = this.deps.ptys
        .list(live.task.projectId)
        .some((s) => s.id === live.lastAutoSessionId && s.status === 'running');
      if (stillAlive) {
        this.log(
          `fire ${id}`,
          `skipped: previous run ${live.lastAutoSessionId} still active`
        );
        this.recordRun(id, {
          at: new Date().toISOString(),
          result: 'skipped',
          sessionId: live.lastAutoSessionId,
          message: 'previous run still active'
        });
        if (live.task.enabled) this.arm(id);
        return;
      }
    }

    let session;
    try {
      session = this.deps.ptys.create({
        projectId: project.id,
        profile: live.task.profile,
        cwd: project.path,
        cols: 80,
        rows: 24,
        config: this.deps.store.getConfig(),
        projectSettings: this.deps.store.getProjectSettings(project.id),
        extraArgs: live.task.extraArgs,
        title: `Scheduled: ${live.task.name}`,
        remote: project.remote
      });
    } catch (err) {
      this.log(`fire ${id} pty.create`, err);
      this.recordRun(id, {
        at: new Date().toISOString(),
        result: 'error',
        message: err instanceof Error ? err.message : String(err)
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    if (opts.manual) {
      live.lastManualSessionId = session.id;
    } else {
      live.lastAutoSessionId = session.id;
    }
    const runStartedAt = new Date().toISOString();
    const runStartMs = Date.now();

    // Type the prompt into the pty once. We attach a one-shot listener on the
    // shared 'data' EventEmitter — `data` fires for every session, so we filter
    // on session id. We also detach on exit so a pty that fails fast (no data
    // emitted) doesn't leak the closure for the rest of the app's lifetime.
    if (live.task.prompt) {
      const prompt = live.task.prompt;
      let sent = false;
      const onData = (sessionId: string) => {
        if (sessionId !== session.id) return;
        if (sent) return;
        sent = true;
        this.deps?.ptys.off('data', onData);
        this.deps?.ptys.write(session.id, `${prompt}\n`);
      };
      const onPromptExit = (sessionId: string) => {
        if (sessionId !== session.id) return;
        this.deps?.ptys.off('data', onData);
        this.deps?.ptys.off('exit', onPromptExit);
      };
      this.deps.ptys.on('data', onData);
      this.deps.ptys.on('exit', onPromptExit);
    }

    // Record success on exit (or as soon as we've spawned, for sessions that
    // don't naturally exit). We listen for the exit event keyed to this id.
    const onExit = (sessionId: string, exitCode: number) => {
      if (sessionId !== session.id) return;
      this.deps?.ptys.off('exit', onExit);
      this.recordRun(id, {
        at: runStartedAt,
        result: exitCode === 0 ? 'success' : 'error',
        sessionId: session.id,
        durationMs: Date.now() - runStartMs,
        message: exitCode === 0 ? undefined : `exit ${exitCode}`
      });
    };
    this.deps.ptys.on('exit', onExit);

    // Optimistically record the run as success at fire time so the UI shows the
    // schedule advanced, even if the session is long-lived. The exit handler
    // above will overwrite the entry once the pty closes.
    this.recordRun(id, {
      at: runStartedAt,
      result: 'success',
      sessionId: session.id
    });

    if (live.task.enabled && !opts.manual) this.arm(id);
  }

  private recordRun(id: string, run: ScheduleRun) {
    const live = this.live.get(id);
    if (!live) return;
    const status = live.task.status;
    // If we've seen this sessionId before, update the existing entry rather
    // than push a new one. The runIndexBySession map survives interleaved
    // fires from other schedules — head-comparison would corrupt under load.
    const knownIdx = run.sessionId ? live.runIndexBySession.get(run.sessionId) : undefined;
    if (knownIdx !== undefined && status.runs[knownIdx]) {
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
