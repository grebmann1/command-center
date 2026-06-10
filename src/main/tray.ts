import { Tray, Menu, nativeImage, type NativeImage } from 'electron';
import { buildClockTemplateImage } from './tray-icon.js';
import type { PtyManager } from './pty.js';
import type { SchedulerManager } from './scheduler.js';
import type { ScheduledTask } from '../shared/types.js';

/**
 * macOS menu-bar (status bar) presence for the scheduler.
 *
 * Lives entirely in the main process and reads from the same `SchedulerManager`
 * and `PtyManager` the window does, so the menu always reflects current state
 * without any renderer round-trip. The menu is rebuilt (debounced) whenever a
 * schedule changes, a pty starts/exits, or a 30s timer ticks (so relative
 * "next in 5m" labels stay fresh).
 *
 * It never owns app lifetime — the dock icon and main window stay exactly as
 * they were; the tray is an extra always-available control.
 */
export interface TrayDeps {
  scheduler: SchedulerManager;
  ptys: PtyManager;
  /** Project id → display name, for grouping/labels. */
  projectName: (projectId: string) => string;
  /** Bring the main window forward (create it if it was closed). */
  showWindow: () => void;
  /** Focus a specific live session in the window. */
  focusSession: (sessionId: string, projectId: string) => void;
  /** Switch the window to the Scheduler view. */
  openScheduler: () => void;
  /** App icon path, resized down for the menu bar. May be null. */
  iconPath: string | null;
  logger?: (context: string, err: unknown) => void;
}

/** Max schedule rows before we collapse the tail into "…and N more". */
const MAX_ROWS = 20;

export class TrayController {
  private tray: Tray | null = null;
  private deps: TrayDeps;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private offScheduler: (() => void) | null = null;
  private readonly onPty = () => this.scheduleRebuild();

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  start() {
    if (this.tray) return;
    this.tray = new Tray(this.makeIcon());
    this.tray.setToolTip('Claude Code Terminal Center');
    // Clicking the icon itself brings the window forward; the schedule list
    // lives in the right-click / menu (set below via setContextMenu, which on
    // macOS also opens on a left click).
    this.tray.on('click', () => this.deps.showWindow());

    const onChanged = () => this.scheduleRebuild();
    this.deps.scheduler.on('changed', onChanged);
    this.offScheduler = () => this.deps.scheduler.off('changed', onChanged);
    // pty start/exit changes the running-count badge.
    this.deps.ptys.on('exit', this.onPty);
    this.deps.ptys.on('sessionUpdated', this.onPty);

    // Keep relative "next in …" labels honest without a per-second timer.
    this.tickTimer = setInterval(() => this.rebuild(), 30_000);

    this.rebuild();
  }

  stop() {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.offScheduler?.();
    this.offScheduler = null;
    this.deps.ptys.off('exit', this.onPty);
    this.deps.ptys.off('sessionUpdated', this.onPty);
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // ----- internals -----------------------------------------------------------

  private log(context: string, err: unknown) {
    if (this.deps.logger) this.deps.logger(context, err);
    else console.error(`[tray] ${context}:`, err); // eslint-disable-line no-console
  }

  private makeIcon(): NativeImage {
    // A monochrome template glyph is the macOS-correct choice — the OS tints it
    // for light/dark menu bars. The colored app icon would vanish in dark mode.
    try {
      return buildClockTemplateImage();
    } catch (err) {
      this.log('makeIcon template', err);
    }
    // Fall back to a resized app icon (non-template), then to text-only.
    try {
      if (this.deps.iconPath) {
        const img = nativeImage.createFromPath(this.deps.iconPath);
        if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
      }
    } catch (err) {
      this.log('makeIcon fallback', err);
    }
    // Empty image is valid — on macOS the title text alone still shows.
    return nativeImage.createEmpty();
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 150);
  }

  /** Sessions still alive that this scheduler spawned, one per schedule. */
  private runningScheduled(): Array<{ task: ScheduledTask; sessionId: string }> {
    const out: Array<{ task: ScheduledTask; sessionId: string }> = [];
    for (const task of this.deps.scheduler.list()) {
      const aliveIds = new Set(
        this.deps.ptys
          .list(task.projectId)
          .filter((s) => s.status === 'running' || s.status === 'starting')
          .map((s) => s.id)
      );
      const sid = task.status.runs
        .map((r) => r.sessionId)
        .find((id): id is string => !!id && aliveIds.has(id));
      if (sid) out.push({ task, sessionId: sid });
    }
    return out;
  }

  private rebuild() {
    if (!this.tray || this.tray.isDestroyed()) return;
    try {
      const tasks = this.deps.scheduler.list();
      const running = this.runningScheduled();
      const runningByTask = new Map(running.map((r) => [r.task.id, r.sessionId]));

      // Badge: number of running scheduled sessions, macOS-only (setTitle is a
      // no-op elsewhere). Empty string clears it.
      if (process.platform === 'darwin') {
        this.tray.setTitle(running.length > 0 ? ` ${running.length}` : '');
      }
      this.tray.setToolTip(
        running.length > 0
          ? `${running.length} scheduled session${running.length > 1 ? 's' : ''} running`
          : 'Claude Code Terminal Center'
      );

      const items: Electron.MenuItemConstructorOptions[] = [];
      items.push({
        label:
          running.length > 0
            ? `${running.length} scheduled session${running.length > 1 ? 's' : ''} running`
            : 'No scheduled sessions running',
        enabled: false
      });
      items.push({ type: 'separator' });

      if (tasks.length === 0) {
        items.push({ label: 'No schedules', enabled: false });
      } else {
        const sorted = this.sortTasks(tasks, runningByTask);
        for (const task of sorted.slice(0, MAX_ROWS)) {
          const sid = runningByTask.get(task.id);
          items.push({
            label: this.taskLabel(task, sid),
            // An item with a submenu can't also carry a top-level click handler
            // on macOS, so the former row-click ("open") moves into the submenu.
            submenu: this.taskSubmenu(task, sid)
          });
        }
        if (sorted.length > MAX_ROWS) {
          items.push({ label: `…and ${sorted.length - MAX_ROWS} more`, enabled: false });
        }
      }

      items.push({ type: 'separator' });
      items.push({
        label: 'Open Scheduler',
        click: () => {
          this.deps.showWindow();
          this.deps.openScheduler();
        }
      });
      items.push({
        label: 'Show Command Center',
        click: () => this.deps.showWindow()
      });
      items.push({ type: 'separator' });
      items.push({ label: 'Quit', role: 'quit' });

      this.tray.setContextMenu(Menu.buildFromTemplate(items));
    } catch (err) {
      this.log('rebuild', err);
    }
  }

  /** Running first, then enabled by soonest next run, then paused. */
  private sortTasks(
    tasks: ScheduledTask[],
    runningByTask: Map<string, string>
  ): ScheduledTask[] {
    const rank = (t: ScheduledTask): number => {
      if (runningByTask.has(t.id)) return 0;
      if (t.enabled) return 1;
      return 2;
    };
    return [...tasks].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const na = a.status.nextRunAt ? Date.parse(a.status.nextRunAt) : Infinity;
      const nb = b.status.nextRunAt ? Date.parse(b.status.nextRunAt) : Infinity;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });
  }

  private taskLabel(task: ScheduledTask, runningSessionId: string | undefined): string {
    const project = this.deps.projectName(task.projectId);
    const status = runningSessionId
      ? 'running now'
      : !task.enabled
      ? 'paused'
      : task.status.nextRunAt
      ? `next ${formatNextRun(task.status.nextRunAt)}`
      : 'idle';
    const dot = runningSessionId ? '● ' : task.enabled ? '' : '○ ';
    return `${dot}${task.name} · ${project} — ${status}`;
  }

  /** Per-schedule actions: open/focus, Run now, and Pause/Enable. */
  private taskSubmenu(
    task: ScheduledTask,
    runningSessionId: string | undefined
  ): Electron.MenuItemConstructorOptions[] {
    const sub: Electron.MenuItemConstructorOptions[] = [];
    if (runningSessionId) {
      sub.push({
        label: 'Open running session',
        click: () => {
          this.deps.showWindow();
          this.deps.focusSession(runningSessionId, task.projectId);
        }
      });
    }
    sub.push({
      label: 'Show in Scheduler',
      click: () => {
        this.deps.showWindow();
        this.deps.openScheduler();
      }
    });
    sub.push({ type: 'separator' });
    sub.push({
      label: 'Run now',
      click: () => {
        try {
          this.deps.scheduler.runNow(task.id);
        } catch (err) {
          this.log(`runNow ${task.id}`, err);
        }
      }
    });
    sub.push({
      label: task.enabled ? 'Pause' : 'Enable',
      click: () => {
        try {
          this.deps.scheduler.setEnabled(task.id, !task.enabled);
        } catch (err) {
          this.log(`setEnabled ${task.id}`, err);
        }
      }
    });
    return sub;
  }
}

/** Compact relative time for a future ISO timestamp. Past → "due". */
function formatNextRun(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return 'idle';
  if (ms <= 0) return 'due';
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `in ${h}h ${remM}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}
