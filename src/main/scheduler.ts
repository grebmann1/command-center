import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Project,
  ScheduleCreateInput,
  ScheduledTask,
  ScheduleRun,
  ScheduleUpdateInput
} from '../shared/types.js';
import type { PtyManager } from './pty.js';
import { deleteSchedule, listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { store as Store } from './store.js';

/** Hard floor for the fire interval. Below this, runs would pile up faster
 *  than terminals can boot, and a typo in the YAML could DOS the laptop. */
const MIN_INTERVAL_MS = 60_000;
/** History buffer cap. Hand-editing `retain` higher in the JSON works, but
 *  we won't surface a bigger value than this in the UI. */
const MAX_RETAIN = 100;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

/**
 * Parse a human interval ("5m", "1h30m", "300000ms") into milliseconds.
 * Returns null on garbage input. Coerces below the minimum (60s) up to the
 * minimum, so a hand-edited "10s" silently behaves like "1m" rather than
 * fork-bombing the user's machine.
 */
export function parseEvery(every: string): number | null {
  const trimmed = (every ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    const ms = UNIT_MS[unit];
    if (!ms) return null;
    total += value * ms;
    consumed += match[0].length;
  }
  if (total <= 0 || consumed !== trimmed.length) return null;
  return Math.max(MIN_INTERVAL_MS, Math.round(total));
}

interface Live {
  task: ScheduledTask;
  timer: NodeJS.Timeout | null;
  /** Session id from the most recent fire. Used for overlap detection. */
  lastSessionId: string | null;
}

type Deps = {
  ptys: PtyManager;
  store: typeof Store;
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

  list(): ScheduledTask[] {
    return [...this.live.values()].map((l) => l.task);
  }

  /** Read every schedule from disk and (re)arm enabled ones. Called on boot. */
  loadAll(projects: Project[]) {
    this.stopAll();
    const tasks = listAllSchedules(projects);
    for (const task of tasks) {
      this.live.set(task.id, { task, timer: null, lastSessionId: null });
      if (task.enabled) this.arm(task.id);
    }
    this.emit('changed');
  }

  create(input: ScheduleCreateInput): ScheduledTask {
    if (!input.name?.trim()) throw new Error('name is required');
    if (!input.projectId) throw new Error('projectId is required');
    const intervalMs = parseEvery(input.every);
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
    this.live.set(task.id, { task, timer: null, lastSessionId: null });
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
      if (parseEvery(patch.every) === null) throw new Error(`invalid interval: ${patch.every}`);
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

  // ----- internals -----------------------------------------------------------

  private persist(task: ScheduledTask) {
    if (!this.deps) return;
    saveSchedule(task, this.deps.store.listProjects());
  }

  private arm(id: string) {
    const live = this.live.get(id);
    if (!live || !live.task.enabled) return;
    const intervalMs = parseEvery(live.task.schedule.every) ?? MIN_INTERVAL_MS;
    const lastRun = live.task.status.lastRunAt
      ? Date.parse(live.task.status.lastRunAt)
      : 0;
    const targetAt = lastRun ? lastRun + intervalMs : Date.now() + intervalMs;
    // 5-second grace floor so a backlog of overdue schedules doesn't fire all
    // at once on app launch.
    const delay = Math.max(targetAt - Date.now(), 5_000);
    live.task.status.nextRunAt = new Date(Date.now() + delay).toISOString();
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
      this.recordRun(id, {
        at: new Date().toISOString(),
        result: 'error',
        message: `project ${live.task.projectId} not found`
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    // Overlap check: if the previous fire's pty is still alive, skip.
    if (!opts.manual && live.lastSessionId) {
      const stillAlive = this.deps.ptys.list(live.task.projectId).some((s) => s.id === live.lastSessionId && s.status === 'running');
      if (stillAlive) {
        this.recordRun(id, {
          at: new Date().toISOString(),
          result: 'skipped',
          sessionId: live.lastSessionId,
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
      this.recordRun(id, {
        at: new Date().toISOString(),
        result: 'error',
        message: err instanceof Error ? err.message : String(err)
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
      return;
    }

    live.lastSessionId = session.id;
    const runStartedAt = new Date().toISOString();
    const runStartMs = Date.now();

    // Type the prompt into the pty once. We attach a one-shot listener on the
    // shared 'data' EventEmitter — `data` fires for every session, so we filter
    // on session id and detach immediately to avoid retaining a closure for the
    // life of the pty.
    if (live.task.prompt) {
      const prompt = live.task.prompt;
      const onData = (sessionId: string) => {
        if (sessionId !== session.id) return;
        this.deps?.ptys.off('data', onData);
        this.deps?.ptys.write(session.id, `${prompt}\n`);
      };
      this.deps.ptys.on('data', onData);
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
    // If this is the exit-time update for an already-recorded run (same
    // sessionId at the head), replace the head entry rather than push.
    if (run.sessionId && status.runs[0]?.sessionId === run.sessionId) {
      status.runs[0] = { ...status.runs[0], ...run };
    } else {
      status.runs = [run, ...status.runs].slice(0, live.task.history.retain);
      status.runCount += 1;
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
