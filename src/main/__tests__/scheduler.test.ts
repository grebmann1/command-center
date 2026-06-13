import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// scheduler.ts -> scheduler-store.ts -> electron. Same mock pattern as
// scheduler-store.test.ts so import-time `app.getPath('home')` doesn't blow up.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

// Save / delete to disk are not under test here — stub them out so the manager
// doesn't try to write to /tmp/cc-test-home.
vi.mock('../scheduler-store.js', () => ({
  saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  listAllSchedules: vi.fn(() => [])
}));

// claude.ts touches `app.getPath('home')` at import time; the electron mock
// above satisfies it. listClaudeSessions isn't called from scheduler.ts but
// keeping a stub here means the module's tree-shake doesn't bring electron
// into the test in unexpected ways.
vi.mock('../claude.js', () => ({
  listClaudeSessions: vi.fn(() => [])
}));

import {
  parseEvery,
  formatInterval,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS
} from '../../shared/parse-every.js';
import { EventEmitter } from 'node:events';
import { SchedulerManager } from '../scheduler.js';
import type { PtyManager } from '../pty.js';
import type { Project } from '../../shared/types.js';

describe('parseEvery', () => {
  it('parses simple units', () => {
    expect(parseEvery('5m')).toBe(5 * 60_000);
    expect(parseEvery('1h')).toBe(3_600_000);
    expect(parseEvery('24h')).toBe(24 * 3_600_000);
  });

  it('parses mixed units', () => {
    expect(parseEvery('1h30m')).toBe(60 * 60_000 + 30 * 60_000);
    expect(parseEvery('  2h 0m  ')).toBeNull(); // whitespace inside isn't allowed
    expect(parseEvery('2h0m')).toBe(2 * 3_600_000);
  });

  it('floors below the minimum', () => {
    // "10s" is shorter than the floor — it gets rounded up rather than rejected
    // so a hand-edited typo doesn't fork-bomb the laptop.
    expect(parseEvery('10s')).toBe(MIN_INTERVAL_MS);
    expect(parseEvery('30s')).toBe(MIN_INTERVAL_MS);
  });

  it('caps at the 24-day maximum', () => {
    // Node's setTimeout clamps delays > ~24.85d to 1ms; cap defensively below that.
    expect(parseEvery('30d')).toBe(MAX_INTERVAL_MS);
    expect(parseEvery('100d')).toBe(MAX_INTERVAL_MS);
  });

  it('returns null for garbage', () => {
    expect(parseEvery('1 hour')).toBeNull();
    expect(parseEvery('1hr')).toBeNull();
    expect(parseEvery('60')).toBeNull();
    expect(parseEvery('')).toBeNull();
    expect(parseEvery('abc')).toBeNull();
  });
});

describe('formatInterval', () => {
  it('formats common values', () => {
    expect(formatInterval(5 * 60_000)).toBe('5m');
    expect(formatInterval(60 * 60_000)).toBe('1h');
    expect(formatInterval(60 * 60_000 + 30 * 60_000)).toBe('1h 30m');
    expect(formatInterval(24 * 60 * 60_000)).toBe('1d');
    expect(formatInterval(25 * 60 * 60_000)).toBe('1d 1h');
  });
});

/**
 * Minimal PtyManager double — only what `SchedulerManager.fire()` actually
 * touches. Records `create()` calls so tests can assert the argv that would
 * be handed to node-pty. Extends EventEmitter because the scheduler subscribes
 * to `data` / `exit` events on the manager.
 */
class FakePtyManager extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  /** All sessions ever spawned; `status` flips on simulateExit. The overlap
   *  check in SchedulerManager filters by `status === 'running'`. */
  sessions: Array<{
    id: string;
    projectId: string;
    title: string;
    profile: string;
    cwd: string;
    status: 'running' | 'exited';
    createdAt: number;
  }> = [];
  list(projectId: string) {
    return this.sessions.filter((s) => s.projectId === projectId);
  }
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    const session = {
      id: `pty-${this.createCalls.length}`,
      projectId: opts.projectId as string,
      title: 'x',
      profile: opts.profile as string,
      cwd: opts.cwd as string,
      status: 'running' as 'running' | 'exited',
      createdAt: Date.now()
    };
    this.sessions.push(session);
    return session;
  }
  write() {
    /* no-op */
  }
  /** Ids passed to closeExpected — lets tests assert auto-close behavior. */
  closeExpectedCalls: string[] = [];
  closeExpected(id: string) {
    this.closeExpectedCalls.push(id);
    return true;
  }
  /** Mark a previously-spawned session as exited. */
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find((s) => s.id === id);
    if (session) session.status = 'exited';
    this.emit('exit', id, code);
  }
}

function makeManager(extraTaskFields?: Record<string, unknown>): {
  manager: SchedulerManager;
  ptys: FakePtyManager;
  task: ReturnType<SchedulerManager['create']>;
} {
  const ptys = new FakePtyManager();
  const project: Project = {
    id: 'proj-1',
    name: 'P',
    path: '/tmp/proj',
    createdAt: 0,
    lastActiveAt: 0
  };
  const fakeStore = {
    listProjects: () => [project],
    getConfig: () => ({}),
    getProjectSettings: () => ({})
  };
  const manager = new SchedulerManager();
  // The Deps type wants the real PtyManager + Store shapes. The fakes have a
  // strict subset of methods that fire() needs; cast away the rest.
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    store: fakeStore as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
  });
  const task = manager.create({
    name: 't',
    projectId: 'proj-1',
    profile: 'claude',
    every: '5m',
    enabled: false,
    ...extraTaskFields
  });
  return { manager, ptys, task };
}

describe('SchedulerManager.fire — headless spawn', () => {
  it('appends the prompt as a positional argv element for claude', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'say hello' });
    manager.runNow(task.id);
    expect(ptys.createCalls).toHaveLength(1);
    const call = ptys.createCalls[0];
    expect(call.profile).toBe('claude');
    expect(call.extraArgs).toEqual(['say hello']);
  });

  it('keeps the prompt after the user extraArgs', () => {
    const { manager, ptys, task } = makeManager({
      prompt: 'hi',
      extraArgs: ['--model', 'sonnet']
    });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual(['--model', 'sonnet', 'hi']);
  });

  it('preserves multi-line prompts as one argv element', () => {
    const body = 'line one\nline two';
    const { manager, ptys, task } = makeManager({ prompt: body });
    manager.runNow(task.id);
    const args = ptys.createCalls[0].extraArgs as string[];
    expect(args[args.length - 1]).toBe(body);
  });

  it('omits the prompt arg when no prompt is set', () => {
    const { manager, ptys, task } = makeManager(/* no prompt */);
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual([]);
  });

  it('does not append the prompt for non-claude profiles', () => {
    const { manager, ptys, task } = makeManager({ profile: 'shell', prompt: 'hi' });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual([]);
  });

  it('keeps the claude-resume profile (no print-mode normalisation)', () => {
    const { manager, ptys, task } = makeManager({ profile: 'claude-resume', prompt: 'hi' });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].profile).toBe('claude-resume');
    expect(ptys.createCalls[0].extraArgs).toEqual(['hi']);
  });

  it('spawns headless — background run stays out of the tab strip', () => {
    // Scheduled fires are background work, surfaced via the inbox rather than
    // a tab the user opened. The pty still runs (and stays replyable); the
    // inbox "Open in session" deep-link promotes it to a visible tab on
    // demand. logPath remains unused — runs are tracked via run history.
    const { manager, ptys, task } = makeManager({ prompt: 'hi' });
    manager.runNow(task.id);
    const call = ptys.createCalls[0];
    expect(call.headless).toBe(true);
    expect(call.logPath).toBeUndefined();
  });

  it('does not register a data listener (no TUI keystroke driving)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'hi' });
    expect(ptys.listenerCount('data')).toBe(0);
    manager.runNow(task.id);
    expect(ptys.listenerCount('data')).toBe(0);
  });
});

/**
 * Trigger an *auto* fire by calling the private `fire(id, { manual: false })`
 * directly. `runNow` always passes `manual: true`, which bypasses the overlap
 * guard — exactly what the user wants for an explicit click, but not what we
 * need to exercise the timer-driven overlap path.
 */
function autoFire(manager: SchedulerManager, taskId: string) {
  (manager as unknown as {
    fire: (id: string, opts: { manual: boolean }) => void;
  }).fire(taskId, { manual: false });
}

describe('SchedulerManager.fire — overlap guard', () => {
  it('skips the next auto fire while a prior auto run is still alive', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    // The skipped run should be recorded with result 'skipped'.
    const runs = manager.list().find((t) => t.id === task.id)!.status.runs;
    expect(runs[0].result).toBe('skipped');
  });

  it('skips the next auto fire while a prior MANUAL run is still alive', () => {
    // Regression: previously the overlap check only consulted
    // lastAutoSessionId, so a long-running manual fire would let the next
    // interval-driven fire stack on top of it.
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    manager.runNow(task.id); // manual
    expect(ptys.createCalls).toHaveLength(1);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    const runs = manager.list().find((t) => t.id === task.id)!.status.runs;
    expect(runs[0].result).toBe('skipped');
  });

  it('proceeds once the prior session has exited', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const firstId = ptys.sessions[0].id;
    ptys.simulateExit(firstId, 0);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(2);
  });

  it('manual "Run now" still spawns even when an auto run is alive', () => {
    // Manual fires are an explicit user choice — don't block them on
    // overlap.
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    manager.runNow(task.id);
    expect(ptys.createCalls).toHaveLength(2);
  });
});

describe('SchedulerManager.attachReport', () => {
  const runsOf = (manager: SchedulerManager, id: string) =>
    manager.list().find((t) => t.id === id)!.status.runs;

  it('attaches a report to the run owning the sessionId', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.attachReport(sid, '## done\nall good', 'success');

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.report).toBe('## done\nall good');
    expect(run.reportStatus).toBe('success');
    expect(run.reportedAt).toBeTruthy();
  });

  it('report survives the exit-time recordRun merge (report BEFORE exit)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    // Report arrives while the session is still alive (optimistic run).
    manager.attachReport(sid, 'early report', 'partial');
    // Then the pty exits → recordRun overwrites result/duration.
    ptys.simulateExit(sid, 0);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success'); // exit code 0 finalized
    expect(run.durationMs).toBeDefined();
    expect(run.report).toBe('early report'); // NOT clobbered by the exit merge
    expect(run.reportStatus).toBe('partial');
  });

  it('report attaches to an already-finalized run (report AFTER exit)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    ptys.simulateExit(sid, 0); // finalize first
    manager.attachReport(sid, 'late report', 'success'); // then report

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success');
    expect(run.report).toBe('late report');
  });

  it('is a no-op (no throw) when no run matches the sessionId', () => {
    const { manager, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    expect(() => manager.attachReport('no-such-session', 'orphan')).not.toThrow();
  });
});

describe('SchedulerManager.onAgentFinished', () => {
  const runsOf = (manager: SchedulerManager, id: string) =>
    manager.list().find((t) => t.id === id)!.status.runs;

  it('stamps finishedAt + duration on the run while the pty stays alive', () => {
    // Explicitly opt OUT of auto-close — the create default is now `true`, and
    // this case is specifically the "finished but left open at the prompt" path.
    const { manager, ptys, task } = makeManager({
      prompt: 'work',
      autoCloseOnFinish: false
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.finishedAt).toBeTruthy();
    expect(run.durationMs).toBeDefined();
    // The session is NOT killed for a non-auto-close task — it stays open.
    expect(ptys.closeExpectedCalls).toEqual([]);
    expect(ptys.sessions[0].status).toBe('running');
  });

  it('closes the pty (expected) for an auto-close task', () => {
    const { manager, ptys, task } = makeManager({
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.finishedAt).toBeTruthy();
    expect(ptys.closeExpectedCalls).toEqual([sid]);
  });

  it('finishedAt survives the exit-time recordRun merge', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid); // turn ends, pty still alive
    ptys.simulateExit(sid, 0); // later the pty actually exits

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success');
    expect(run.finishedAt).toBeTruthy(); // not clobbered by the exit merge
  });

  it('falls back to an expected close when no scheduled run matches', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);

    manager.onAgentFinished('no-such-session');

    expect(ptys.closeExpectedCalls).toEqual(['no-such-session']);
  });
});

/**
 * Pausing a schedule == `setEnabled(id, false)` (the panel's "Pause all" maps
 * each enabled task through this). These lock the safety contract the user
 * relies on: a paused schedule MUST NOT fire by itself — not when its timer
 * would have elapsed, not on a re-arm, and not after an app restart. The only
 * thing that may still spawn it is an explicit manual "Run now".
 *
 * Uses fake timers so an enabled task's real `setTimeout(arm)` can be advanced
 * deterministically without waiting out the (minimum 60s) interval.
 */
describe('SchedulerManager — paused schedules do not auto-fire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('disabling clears the armed timer so the elapsed interval never fires', () => {
    // Enabled task → create() arms a setTimeout. Disable it, then advance well
    // past the interval: a cleared timer means zero spawns.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: true });

    manager.setEnabled(task.id, false);
    vi.advanceTimersByTime(60 * 60_000); // an hour — far past the 5m interval

    expect(ptys.createCalls).toHaveLength(0);
  });

  it('an enabled task DOES auto-fire when its interval elapses (control)', () => {
    // Guards against a false-negative: prove the harness actually fires when
    // NOT paused, so the disabled-case assertion above is meaningful. The
    // `every: '5m'` default plus the arm() 5s grace floor → advance one full
    // interval to cross the scheduled delay.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: true });

    vi.advanceTimersByTime(5 * 60_000 + 5_000);

    expect(ptys.createCalls).toHaveLength(1);
    // And it self-re-armed for the next interval — still enabled.
    expect(manager.list().find((t) => t.id === task.id)?.enabled).toBe(true);
  });

  it('re-arming a disabled task schedules no timer (arm() early-returns)', () => {
    // arm() bails on !enabled, so no setTimeout is registered — advancing well
    // past any interval produces zero spawns. (nextRunAt is a display hint set
    // at create() regardless of enabled, so we assert on firing, not that field.)
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: false });

    (manager as unknown as { arm: (id: string) => void }).arm(task.id);
    vi.advanceTimersByTime(60 * 60_000); // an hour — far past the 5m interval

    expect(ptys.createCalls).toHaveLength(0);
  });

  it('persists enabled:false so a restart (loadAll) does not re-arm it', () => {
    // The boot path only arms tasks whose persisted `enabled` is true. Assert
    // the disabled state is what would be read back, locking restart-safety.
    const { manager, task } = makeManager({ prompt: 'work', enabled: true });

    manager.setEnabled(task.id, false);

    expect(manager.list().find((t) => t.id === task.id)?.enabled).toBe(false);
  });

  it('manual "Run now" still fires a paused schedule (explicit user action)', () => {
    // The one sanctioned bypass: pausing stops AUTOMATIC fires, not a
    // deliberate click. Documents that runNow is intentionally exempt.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: false });

    manager.runNow(task.id);

    expect(ptys.createCalls).toHaveLength(1);
  });
});
