import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Project,
  TerminalSession,
  LaunchProfileId,
  ClaudeSessionSummary,
  GitStatus,
  InboxEntry,
  McpServerEntry,
  PluginEntry,
  ScheduledTask,
  ScheduleTemplate,
  ScheduleGroup
} from '@shared/types';

/** Built-in nav destinations. App modules (plugins/*) add their own ids. */
export type CoreNavId =
  | 'projects'
  | 'inbox'
  | 'scheduler'
  | 'plugins'
  | 'skills'
  | 'mcp'
  | 'settings';

/**
 * A nav destination: a core panel or an app-module id. The `string & {}`
 * arm keeps autocomplete for the known ids while allowing module ids
 * (resolved at runtime from the module registry) without a hard import.
 */
export type NavId = CoreNavId | (string & {});

export interface Toast {
  id: string;
  message: string;
  kind?: 'info' | 'error';
}

export type WorkspaceMode = 'terminals' | 'explorer' | 'preview';

export type SplitLayout = 'single' | 'vertical' | 'horizontal' | 'grid';

/** Max extra panes beside the primary, indexed by layout. */
const SPLIT_CAPACITY: Record<SplitLayout, number> = {
  single: 0,
  vertical: 1,
  horizontal: 1,
  grid: 3
};

interface UiState {
  nav: NavId;
  /** When true, column 3 shows the workspaces overview instead of the
   *  per-project Workspace. Cleared when the user selects a project. */
  overviewOpen: boolean;
  setOverviewOpen: (open: boolean) => void;
  selectedProjectId: string | null;
  // tabs grouped by project — selected ids per project
  selectedTabId: Record<string, string | undefined>;
  paletteOpen: boolean;
  quickOpenOpen: boolean;
  shortcutsOpen: boolean;
  resumeOpen: boolean;
  searchOpen: boolean;
  findOpen: boolean;
  toasts: Toast[];
  // unread tabs (received output while not active)
  unread: Record<string, boolean>;
  // workspace mode per project (default: terminals)
  workspaceMode: Record<string, WorkspaceMode>;
  // explorer: file path open in viewer per project
  explorerFile: Record<string, string | undefined>;
  // explorer: pending goto request per project (consumed by ExplorerView)
  explorerGoto: Record<string, { line: number; column: number; nonce: number } | undefined>;
  // preview: pending navigation request per project (consumed by PreviewPane).
  // Nonce-bumped so the same URL can be re-requested.
  previewNav: Record<string, { url: string; nonce: number } | undefined>;
  // explorer: per-project MRU of opened file paths (most recent at index 0)
  recentFiles: Record<string, string[]>;
  // explorer: per-project diff-vs-HEAD toggle for the open file
  explorerDiff: Record<string, boolean>;
  // explorer: per-project tree mode (file tree vs flat changes list)
  explorerTreeMode: Record<string, 'files' | 'changes'>;
  // sidebar: per-project expansion of the inline terminal sub-list
  projectExpanded: Record<string, boolean>;
  toggleProjectExpanded: (projectId: string) => void;
  // workspace: per-project split layout + the extra tab ids that occupy the
  // non-primary panes. The primary pane is always `selectedTabId[projectId]`.
  // - vertical:  [right]
  // - horizontal:[bottom]
  // - grid 2x2:  [top-right, bottom-left, bottom-right]
  // Slots may be undefined; render skips them and the layout collapses
  // gracefully (CSS grid handles empty cells).
  splitLayout: Record<string, SplitLayout | undefined>;
  splitTabIds: Record<string, Array<string | undefined>>;
  setSplitLayout: (projectId: string, layout: SplitLayout) => void;
  /** Place a tab in the next free split slot, or replace if already present. */
  openInSplit: (projectId: string, tabId: string) => void;
  /** Remove a tab id from the split slots (e.g. when the tab is closed). */
  removeFromSplit: (projectId: string, tabId: string) => void;
  /** Reset to single-pane (clears layout and slot ids). */
  closeSplit: (projectId: string) => void;
  setExplorerDiff: (projectId: string, on: boolean) => void;
  toggleExplorerDiff: (projectId: string) => void;
  setExplorerTreeMode: (projectId: string, mode: 'files' | 'changes') => void;
  toggleExplorerTreeMode: (projectId: string) => void;
  // experimental: when true, ExplorerView renders the monaco-vscode-api
  // workbench instead of the homegrown tree+monaco split. Persisted in
  // localStorage so a crash on boot can be recovered by toggling off.
  workbenchEnabled: boolean;
  setWorkbenchEnabled: (on: boolean) => void;
  // sidebar: collapsed to an icon rail (labels hidden) to save horizontal
  // space. Persisted in localStorage so it survives reloads.
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setNav: (n: NavId) => void;
  /** Cross-panel deep-link prefilter: a Plugin row's "4 skills" chip writes
   *  `catalogueFilter.skills = pluginName`, then navs to skills. The skills
   *  panel reads it on mount, applies it as a search prefill, and clears
   *  the slot. Same for `catalogueFilter.mcp`. */
  catalogueFilter: { skills?: string; mcp?: string };
  setCatalogueFilter: (key: 'skills' | 'mcp', value: string | undefined) => void;
  selectProject: (id: string | null) => void;
  selectTab: (projectId: string, tabId: string | undefined) => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setResumeOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFindOpen: (open: boolean) => void;
  /** Which tab is active in the Settings panel. */
  settingsTab: 'global' | 'project';
  setSettingsTab: (tab: 'global' | 'project') => void;
  /**
   * Which tab is active in the Scheduler panel.
   *  - 'overview'  — dashboard
   *  - 'group'     — a user-defined group (see `selectedGroupId`)
   *  - 'global'    — Ungrouped global schedules (no/unresolved group)
   *  - 'project'   — a project's checked-in schedules (see `selectedProjectId`)
   */
  schedulerTab: 'overview' | 'group' | 'global' | 'project';
  setSchedulerTab: (tab: 'overview' | 'group' | 'global' | 'project') => void;
  /** Which group the 'group' tab is showing. */
  selectedGroupId: string | null;
  /** Select a group tab and remember which group. */
  selectGroup: (groupId: string) => void;
  /**
   * A schedule the user asked to reveal (from the menu-bar tray). The panel
   * scrolls to and briefly highlights it, then clears this. Null when nothing
   * is pending.
   */
  revealScheduleId: string | null;
  /** Jump the Scheduler to the scope owning `taskId` and reveal that row. */
  revealSchedule: (taskId: string) => void;
  clearRevealSchedule: () => void;
  pushToast: (message: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: string) => void;
  markUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;
  setWorkspaceMode: (projectId: string, mode: WorkspaceMode) => void;
  toggleWorkspaceMode: (projectId: string) => void;
  setExplorerFile: (projectId: string, path: string | undefined) => void;
  requestExplorerGoto: (projectId: string, line: number, column: number) => void;
  /** Switch the project to preview mode and load the given URL. */
  requestPreviewNav: (projectId: string, url: string) => void;
}

export const LIST_PANE_MIN = 200;
export const LIST_PANE_MAX = 600;

export function applyListPaneWidth(px: number) {
  const clamped = Math.max(LIST_PANE_MIN, Math.min(LIST_PANE_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--col-list', `${clamped}px`);
}

export function applyTheme(theme: 'dark' | 'light' | undefined) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
}

// Debounced write of workspaceMode -> AppConfig.workspaceModes.
let persistTimer: number | null = null;
function persistWorkspaceModes() {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const map = useUi.getState().workspaceMode;
    // 'preview' is intentionally not persisted — landing in an empty preview
    // pane after relaunch is jarring; restart should drop back to terminals.
    const persisted: Record<string, 'terminals' | 'explorer'> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v === 'terminals' || v === 'explorer') persisted[k] = v;
    }
    window.cc.config.set({ workspaceModes: persisted }).catch(() => {});
  }, 200);
}

// Per-project debounced git refresh. Terminal output is high-frequency, so
// we coalesce bursts (build logs, scrolling output) into one git call after
// activity quiets down for a moment.
const gitRefreshTimers = new Map<string, number>();
export function scheduleGitRefresh(projectId: string, delay = 1500) {
  const existing = gitRefreshTimers.get(projectId);
  if (existing !== undefined) window.clearTimeout(existing);
  const t = window.setTimeout(() => {
    gitRefreshTimers.delete(projectId);
    useData.getState().loadGitStatus(projectId);
  }, delay);
  gitRefreshTimers.set(projectId, t);
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

function pushErrorToast(message: string) {
  useUi.getState().pushToast(message, 'error');
}

export const useUi = create<UiState>((set, get) => ({
  nav: 'projects',
  overviewOpen: false,
  setOverviewOpen: (overviewOpen) => set({ overviewOpen }),
  revealScheduleId: null,
  selectedProjectId: null,
  selectedTabId: {},
  paletteOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  resumeOpen: false,
  searchOpen: false,
  findOpen: false,
  settingsTab: 'global',
  schedulerTab: 'overview',
  selectedGroupId: null,
  toasts: [],
  unread: {},
  workspaceMode: {},
  explorerFile: {},
  explorerGoto: {},
  previewNav: {},
  recentFiles: {},
  explorerDiff: {},
  explorerTreeMode: {},
  projectExpanded: {},
  splitLayout: {},
  splitTabIds: {},
  workbenchEnabled:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('cc.workbenchEnabled') === '1',
  setWorkbenchEnabled: (on) => {
    try {
      localStorage.setItem('cc.workbenchEnabled', on ? '1' : '0');
    } catch {
      // ignore quota errors
    }
    set({ workbenchEnabled: on });
    // Both editor surfaces (monaco-editor + monaco-vscode-api) install
    // singletons into a shared global RegistryImpl on first import; switching
    // mid-session triggers "There is already an extension with this id" when
    // the second one tries to register. A full reload guarantees only the
    // chosen surface ever loads in a given page lifetime.
    queueMicrotask(() => window.location.reload());
  },
  sidebarCollapsed:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('cc.sidebarCollapsed') === '1',
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        localStorage.setItem('cc.sidebarCollapsed', next ? '1' : '0');
      } catch {
        // ignore quota errors
      }
      return { sidebarCollapsed: next };
    }),
  // Entering the scheduler always lands on Overview — the cross-scope summary
  // is the right "home" when you click in. Switching to global/project scope
  // happens inside the panel via setSchedulerTab, so this only resets on
  // re-entry, not when the user navigates the scope rail.
  setNav: (nav) =>
    set(nav === 'scheduler' ? { nav, schedulerTab: 'overview' } : { nav }),
  catalogueFilter: {},
  setCatalogueFilter: (key, value) =>
    set((s) => ({
      catalogueFilter:
        value === undefined
          ? Object.fromEntries(Object.entries(s.catalogueFilter).filter(([k]) => k !== key))
          : { ...s.catalogueFilter, [key]: value }
    })),
  selectProject: (id) => {
    set({ selectedProjectId: id, overviewOpen: false });
    if (!id) {
      // Tell main no project is active so the per-project skills watcher
      // is torn down. touch() with a falsy id is a no-op for state but is
      // the canonical "selected changed" signal.
      window.cc.projects.touch('').catch(() => {});
      return;
    }
    window.cc.config.set({ lastProjectId: id }).catch(() => {});
    // Persist the touch to disk so the next launch's auto-sort reflects
    // recent use, but DON'T merge the updated lastActiveAt back into the
    // in-memory projects list — that causes the just-clicked project to
    // jump to the top of the sidebar mid-session, which is jarring.
    window.cc.projects.touch(id).catch(() => {});
    useData.getState().loadGitStatus(id);
  },
  selectTab: (projectId, tabId) => {
    set((s) => {
      const unread = { ...s.unread };
      if (tabId) delete unread[tabId];
      return { selectedTabId: { ...s.selectedTabId, [projectId]: tabId }, unread };
    });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setQuickOpenOpen: (quickOpenOpen) => set({ quickOpenOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setResumeOpen: (resumeOpen) => set({ resumeOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setFindOpen: (findOpen) => set({ findOpen }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setSchedulerTab: (schedulerTab) => set({ schedulerTab }),
  selectGroup: (groupId) => set({ schedulerTab: 'group', selectedGroupId: groupId }),
  revealSchedule: (taskId) => {
    const task = useScheduler.getState().tasks.find((t) => t.id === taskId);
    // setNav('scheduler') forces schedulerTab back to 'overview', so set the
    // scope tab AFTER it. A project-scoped task also needs its project selected
    // so the project scope renders the right list.
    set({ nav: 'scheduler', revealScheduleId: taskId });
    if (task?.source && task.source !== 'global') {
      get().selectProject((task.source as { projectId: string }).projectId);
      set({ schedulerTab: 'project' });
    } else if (task?.group && useScheduleGroups.getState().groups.some((g) => g.id === task.group)) {
      // Global + resolvable group → land on that group's tab; otherwise the
      // task lives in the Ungrouped (global) bucket.
      set({ schedulerTab: 'group', selectedGroupId: task.group });
    } else {
      set({ schedulerTab: 'global' });
    }
  },
  clearRevealSchedule: () => set({ revealScheduleId: null }),
  pushToast: (message, kind = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  markUnread: (sessionId) =>
    set((s) => (s.unread[sessionId] ? s : { unread: { ...s.unread, [sessionId]: true } })),
  clearUnread: (sessionId) =>
    set((s) => {
      if (!s.unread[sessionId]) return s;
      const next = { ...s.unread };
      delete next[sessionId];
      return { unread: next };
    }),
  setWorkspaceMode: (projectId, mode) => {
    set((s) => ({ workspaceMode: { ...s.workspaceMode, [projectId]: mode } }));
    persistWorkspaceModes();
  },
  toggleWorkspaceMode: (projectId) => {
    set((s) => {
      const cur = s.workspaceMode[projectId] ?? 'terminals';
      return {
        workspaceMode: {
          ...s.workspaceMode,
          [projectId]: cur === 'terminals' ? 'explorer' : 'terminals'
        }
      };
    });
    persistWorkspaceModes();
  },
  setExplorerFile: (projectId, path) =>
    set((s) => {
      const next: Partial<UiState> = {
        explorerFile: { ...s.explorerFile, [projectId]: path }
      };
      if (path) {
        const prev = s.recentFiles[projectId] ?? [];
        const filtered = prev.filter((p) => p !== path);
        filtered.unshift(path);
        if (filtered.length > 30) filtered.length = 30;
        next.recentFiles = { ...s.recentFiles, [projectId]: filtered };
      }
      return next;
    }),
  setExplorerDiff: (projectId, on) =>
    set((s) => ({ explorerDiff: { ...s.explorerDiff, [projectId]: on } })),
  toggleExplorerDiff: (projectId) =>
    set((s) => ({
      explorerDiff: { ...s.explorerDiff, [projectId]: !s.explorerDiff[projectId] }
    })),
  setExplorerTreeMode: (projectId, mode) =>
    set((s) => ({ explorerTreeMode: { ...s.explorerTreeMode, [projectId]: mode } })),
  toggleExplorerTreeMode: (projectId) =>
    set((s) => {
      const cur = s.explorerTreeMode[projectId] ?? 'files';
      return {
        explorerTreeMode: {
          ...s.explorerTreeMode,
          [projectId]: cur === 'files' ? 'changes' : 'files'
        }
      };
    }),
  requestExplorerGoto: (projectId, line, column) =>
    set((s) => ({
      explorerGoto: {
        ...s.explorerGoto,
        [projectId]: { line, column, nonce: Date.now() + Math.random() }
      }
    })),
  requestPreviewNav: (projectId, url) => {
    set((s) => ({
      workspaceMode: { ...s.workspaceMode, [projectId]: 'preview' },
      previewNav: {
        ...s.previewNav,
        [projectId]: { url, nonce: Date.now() + Math.random() }
      }
    }));
    persistWorkspaceModes();
  },
  toggleProjectExpanded: (projectId) =>
    set((s) => ({
      projectExpanded: { ...s.projectExpanded, [projectId]: !s.projectExpanded[projectId] }
    })),
  setSplitLayout: (projectId, layout) =>
    set((s) => {
      const cap = SPLIT_CAPACITY[layout];
      const cur = s.splitTabIds[projectId] ?? [];
      // Truncate or pad to the new layout's capacity (preserve existing ids).
      const slots = cur.slice(0, cap);
      while (slots.length < cap) slots.push(undefined);
      const layouts = { ...s.splitLayout, [projectId]: layout };
      const ids = { ...s.splitTabIds, [projectId]: slots };
      if (layout === 'single') delete layouts[projectId];
      return { splitLayout: layouts, splitTabIds: ids };
    }),
  openInSplit: (projectId, tabId) =>
    set((s) => {
      // Splitting a tab against itself is a no-op. The user invokes "Open in
      // split" from the *non-active* tab's context menu, so this branch
      // should never fire in practice — guard anyway.
      if (s.selectedTabId[projectId] === tabId) return s;
      const layout = s.splitLayout[projectId] ?? 'single';
      // If we're still single-pane, default to a vertical split when the
      // user picks "Open in split" from the menu — preserves the prior
      // one-shortcut behavior.
      const targetLayout: SplitLayout = layout === 'single' ? 'vertical' : layout;
      const cap = SPLIT_CAPACITY[targetLayout];
      const prev = s.splitTabIds[projectId] ?? [];
      const slots = prev.slice(0, cap);
      while (slots.length < cap) slots.push(undefined);
      // If the tab is already in a slot, leave it (idempotent).
      if (slots.includes(tabId)) {
        return {
          splitLayout: { ...s.splitLayout, [projectId]: targetLayout },
          splitTabIds: { ...s.splitTabIds, [projectId]: slots }
        };
      }
      // Drop into the first free slot, else replace the last one.
      const free = slots.findIndex((x) => x === undefined);
      const idx = free === -1 ? slots.length - 1 : free;
      slots[idx] = tabId;
      return {
        splitLayout: { ...s.splitLayout, [projectId]: targetLayout },
        splitTabIds: { ...s.splitTabIds, [projectId]: slots }
      };
    }),
  removeFromSplit: (projectId, tabId) =>
    set((s) => {
      const slots = s.splitTabIds[projectId];
      if (!slots || !slots.includes(tabId)) return s;
      const next = slots.map((x) => (x === tabId ? undefined : x));
      return { splitTabIds: { ...s.splitTabIds, [projectId]: next } };
    }),
  closeSplit: (projectId) =>
    set((s) => {
      const layouts = { ...s.splitLayout };
      const ids = { ...s.splitTabIds };
      delete layouts[projectId];
      delete ids[projectId];
      return { splitLayout: layouts, splitTabIds: ids };
    })
}));

export interface ClosedTab {
  profile: LaunchProfileId;
  title: string;
  extraArgs?: string[];
  /** Reopen in the same directory the closed tab ran in (else project root). */
  cwd?: string;
  /** Re-pin on reopen if the closed tab was pinned. */
  pinned?: boolean;
}

interface DataState {
  projects: Project[];
  terminals: Record<string, TerminalSession[]>; // by project id
  claudeSessions: Record<string, ClaudeSessionSummary[]>; // by project id
  closedTabs: Record<string, ClosedTab[]>; // by project id, most recent at end
  /**
   * Session ids detached to the background, per project, most recent last.
   * Renderer-only ordering used to resume the newest-detached session first
   * (⌘⇧T). Kept separate from the session objects so main's onUpdated pushes
   * can't clobber the order.
   */
  detachedStack: Record<string, string[]>;
  gitStatus: Record<string, GitStatus | null>; // by project id
  fontSize: number;
  inboxGuidanceEnabled: boolean;
  init: () => Promise<void>;
  loadGitStatus: (projectId: string) => Promise<void>;
  refreshAllGitStatus: () => Promise<void>;
  setFontSize: (n: number) => void;
  setInboxGuidanceEnabled: (on: boolean) => void;
  reopenLastClosed: (projectId: string) => Promise<TerminalSession | null>;
  loadProjects: () => Promise<void>;
  loadClaudeSessions: (projectId: string) => Promise<void>;
  addProject: () => Promise<Project | null>;
  addProjectByPath: (path: string) => Promise<Project | null>;
  addRemoteProject: (input: {
    host: string;
    user?: string;
    remotePath?: string;
    name?: string;
  }) => Promise<Project | null>;
  updateProject: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  createTerminal: (
    projectId: string,
    profile: LaunchProfileId,
    cols: number,
    rows: number,
    opts?: { extraArgs?: string[]; title?: string; cwd?: string }
  ) => Promise<TerminalSession | null>;
  /**
   * Terminate a session: kills the pty and removes the tab. Pushes a
   * restorable snapshot onto closedTabs so ⌘⇧T can reopen a fresh tab
   * with the same profile/cwd/pinned/extraArgs. Wired to the tab's X
   * button, ⌘W, middle-click, and the sidebar row X.
   */
  closeTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /**
   * Detach a tab to the background without killing its pty. The session
   * stays alive as a headless runner; it's surfaced by the Background (N)
   * affordance and can be resumed via restoreTerminal (which re-attaches
   * the SAME live pty, preserving scrollback). This is the explicit
   * "Send to background" action — distinct from closeTerminal.
   */
  hideTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /** Resume a detached (background) session back into the tab strip. */
  restoreTerminal: (sessionId: string, projectId: string) => Promise<void>;
  /**
   * Resume the most-recently-detached background session, if any. Returns
   * the resumed session id or null when nothing is detached. Backs ⌘⇧T's
   * "prefer un-detach over reopen-closed" behavior.
   */
  restoreLastDetached: (projectId: string) => Promise<string | null>;
  restartTerminal: (sessionId: string, projectId: string) => Promise<TerminalSession | null>;
  reorderTerminal: (projectId: string, fromId: string, toId: string) => void;
  renameTerminal: (projectId: string, sessionId: string, title: string) => void;
  setPinned: (projectId: string, sessionId: string, pinned: boolean) => void;
  markExited: (sessionId: string, exitCode?: number) => void;
}

/**
 * Filter out hidden (headless) terminals from a project's tab strip. Hidden
 * sessions still have a live pty — they're just not shown in the UI. The
 * scheduler creates them this way; the user also produces them by detaching
 * a tab ("Send to background" / ⌘⇧W → `hideTerminal`). The tab's X button
 * closes (terminates) instead — see `closeTerminal`.
 */
export function visibleTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return (list ?? []).filter((t) => !t.headless);
}

/**
 * Detached (background) sessions for a project: headless and still live.
 * These are the sessions surfaced by the Background (N) affordance — the
 * user sent them to the background with the explicit Detach action and can
 * resume them (re-attaching the same live pty). Exited-while-detached
 * sessions are reaped in markExited, so anything here has a running pty.
 */
export function backgroundTerminals(list: TerminalSession[] | undefined): TerminalSession[] {
  return (list ?? []).filter((t) => t.headless);
}

export function sortProjectsForDisplay(projects: Project[]): Project[] {
  const anyManual = projects.some((p) => typeof p.sortIndex === 'number');
  return projects.slice().sort((a, b) => {
    if (anyManual) {
      const ai = typeof a.sortIndex === 'number' ? a.sortIndex : Number.POSITIVE_INFINITY;
      const bi = typeof b.sortIndex === 'number' ? b.sortIndex : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
    }
    return b.lastActiveAt - a.lastActiveAt;
  });
}

export const useData = create<DataState>((set, get) => ({
  projects: [],
  terminals: {},
  claudeSessions: {},
  closedTabs: {},
  detachedStack: {},
  gitStatus: {},
  fontSize: 13,
  inboxGuidanceEnabled: true,

  setFontSize(n) {
    set({ fontSize: n });
  },

  setInboxGuidanceEnabled(on) {
    set({ inboxGuidanceEnabled: on });
  },

  async init() {
    try {
      const [projects, config] = await Promise.all([
        window.cc.projects.list(),
        window.cc.config.get()
      ]);
      set({
        projects,
        fontSize: config.fontSize,
        inboxGuidanceEnabled: config.inboxGuidanceEnabled ?? true
      });
      applyTheme(config.theme);
      if (typeof config.listPaneWidth === 'number') {
        applyListPaneWidth(config.listPaneWidth);
      }
      if (config.workspaceModes) {
        useUi.setState({ workspaceMode: config.workspaceModes });
      }
      if (config.lastProjectId && projects.find((p) => p.id === config.lastProjectId)) {
        useUi.getState().selectProject(config.lastProjectId);
      }
      get().refreshAllGitStatus();

      // Hydrate live terminals from main. Sessions otherwise only reach the
      // renderer via `sessionUpdated` pushes, so any pty already running before
      // this renderer mounted (a scheduler-spawned tab, or a session that
      // outlived a renderer reload) would be invisible here. That divergence
      // made "Running now" read 0 while the scheduler kept skipping fires with
      // "previous run still active". Pull the current list per project so the
      // store reflects what main actually has alive.
      await Promise.all(
        projects.map(async (p) => {
          try {
            const sessions = await window.cc.terminals.list(p.id);
            if (sessions.length > 0) {
              set((s) => ({ terminals: { ...s.terminals, [p.id]: sessions } }));
            }
          } catch {
            /* ignore — a missing project's terminals just stay empty */
          }
        })
      );
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to initialize app state'));
    }

    // Inbox: one-shot history load + push subscriptions. We get pushes for
    // appended/removed entries, so no polling. Optimistic deletes filter
    // locally before the IPC round-trip — the onRemoved push reconciles.
    try {
      const { entries } = await window.cc.inbox.history({ limit: 100 });
      useInbox.setState({ entries, loading: false });
    } catch {
      useInbox.setState({ loading: false });
    }
    window.cc.inbox.onAppended((entry) => {
      useInbox.getState().prepend(entry);
    });
    window.cc.inbox.onRemoved((id) => {
      useInbox.getState().removeLocal(id);
    });

    // Scheduler: one-shot list + push subscription. The main process emits
    // `scheduler:onChanged` after every fire and after every CRUD action,
    // so the panel never needs to poll.
    try {
      const tasks = await window.cc.scheduler.list();
      useScheduler.setState({ tasks, loading: false });
    } catch {
      useScheduler.setState({ loading: false });
    }
    window.cc.scheduler.onChanged((tasks) => {
      useScheduler.setState({ tasks });
    });

    // Templates: same one-shot + push pattern. Main watches the user dir +
    // per-project dirs for hand-edited files and pushes refreshed lists.
    try {
      const templates = await window.cc.scheduler.listTemplates();
      useScheduleTemplates.setState({ templates, loading: false });
    } catch {
      useScheduleTemplates.setState({ loading: false });
    }
    window.cc.scheduler.onTemplatesChanged((templates) => {
      useScheduleTemplates.setState({ templates });
    });

    // Schedule groups: one-shot + push. Main seeds Personal/Work on first run
    // and watches ~/.cc-center/groups.json for hand edits.
    try {
      const groups = await window.cc.scheduler.groups.list();
      useScheduleGroups.setState({ groups, loading: false });
    } catch {
      useScheduleGroups.setState({ loading: false });
    }
    window.cc.scheduler.groups.onChanged((groups) => {
      useScheduleGroups.setState({ groups });
    });

    // Plugins + MCP catalogues: same one-shot + push pattern. Main fans out
    // a single debounced fs.watch into `plugins:onChanged` and `mcp:onChanged`
    // so we never poll.
    try {
      const entries = await window.cc.plugins.list();
      usePlugins.setState({ entries, loading: false });
    } catch {
      usePlugins.setState({ loading: false });
    }
    window.cc.plugins.onChanged((entries) => {
      usePlugins.setState({ entries });
    });

    try {
      const entries = await window.cc.mcp.listAll();
      useMcpCatalogue.setState({ entries, loading: false });
    } catch {
      useMcpCatalogue.setState({ loading: false });
    }
    window.cc.mcp.onChanged((entries) => {
      useMcpCatalogue.setState({ entries });
    });

    // Session metadata changes (e.g. title/headless changes, exit transitions,
    // or a scheduler-spawned tab being broadcast) come in via this push so the
    // tab strip re-renders without polling.
    window.cc.terminals.onUpdated((session) => {
      set((s) => {
        const list = s.terminals[session.projectId];
        if (!list) {
          return { terminals: { ...s.terminals, [session.projectId]: [session] } };
        }
        const idx = list.findIndex((t) => t.id === session.id);
        if (idx === -1) {
          return {
            terminals: { ...s.terminals, [session.projectId]: [...list, session] }
          };
        }
        const next = list.slice();
        next[idx] = { ...next[idx], ...session };
        return { terminals: { ...s.terminals, [session.projectId]: next } };
      });
    });
  },

  async loadProjects() {
    try {
      const projects = await window.cc.projects.list();
      set({ projects });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load projects'));
    }
  },

  async loadClaudeSessions(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const sessions = await window.cc.claude.listSessions(project.path);
      set((s) => ({ claudeSessions: { ...s.claudeSessions, [projectId]: sessions } }));
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to load Claude sessions'));
    }
  },

  async addProject() {
    try {
      const path = await window.cc.projects.pickDirectory();
      if (!path) return null;
      const result = await window.cc.projects.add(path);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add project'));
      return null;
    }
  },

  async addProjectByPath(path) {
    try {
      const result = await window.cc.projects.add(path);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add project'));
      return null;
    }
  },

  async addRemoteProject(input) {
    try {
      const result = await window.cc.projects.addRemote(input);
      if (!result.ok) {
        pushErrorToast(result.message);
        return null;
      }
      await get().loadProjects();
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to add remote project'));
      return null;
    }
  },

  async updateProject(id, patch) {
    try {
      const updated = await window.cc.projects.update(id, patch);
      if (!updated) return;
      // Preserve the in-memory lastActiveAt (and sortIndex). Disk may have a
      // newer lastActiveAt from an earlier `touch`, but adopting it here would
      // re-sort the sidebar mid-session — same reason selectProject doesn't.
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === id
            ? { ...updated, lastActiveAt: p.lastActiveAt, sortIndex: p.sortIndex }
            : p
        )
      }));
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to update project'));
    }
  },

  async reorderProjects(orderedIds) {
    // Optimistically reorder locally to avoid drag flicker.
    set((s) => {
      const byId = new Map(s.projects.map((p) => [p.id, p]));
      const next: Project[] = [];
      let i = 0;
      for (const id of orderedIds) {
        const p = byId.get(id);
        if (!p) continue;
        next.push({ ...p, sortIndex: i++ });
        byId.delete(id);
      }
      for (const leftover of byId.values()) next.push({ ...leftover, sortIndex: i++ });
      return { projects: next };
    });
    try {
      const persisted = await window.cc.projects.reorder(orderedIds);
      set({ projects: persisted });
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to reorder projects'));
      await get().loadProjects();
    }
  },

  async removeProject(id) {
    try {
      await window.cc.projects.remove(id);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to remove project'));
      return;
    }
    set((s) => {
      const terminals = { ...s.terminals };
      const claudeSessions = { ...s.claudeSessions };
      const closedTabs = { ...s.closedTabs };
      const gitStatus = { ...s.gitStatus };
      delete terminals[id];
      delete claudeSessions[id];
      delete closedTabs[id];
      delete gitStatus[id];
      return {
        projects: s.projects.filter((p) => p.id !== id),
        terminals,
        claudeSessions,
        closedTabs,
        gitStatus
      };
    });
    useUi.setState((s) => {
      const patch: Partial<UiState> = {};
      const drop = <K extends keyof UiState>(key: K) => {
        const cur = s[key] as Record<string, unknown> | undefined;
        if (cur && id in cur) {
          const next = { ...cur };
          delete next[id];
          (patch as Record<string, unknown>)[key as string] = next;
        }
      };
      drop('workspaceMode');
      drop('splitLayout');
      drop('splitTabIds');
      drop('selectedTabId');
      drop('projectExpanded');
      drop('recentFiles');
      drop('explorerFile');
      drop('explorerGoto');
      drop('previewNav');
      drop('explorerDiff');
      drop('explorerTreeMode');
      return patch;
    });
    persistWorkspaceModes();
  },

  async createTerminal(projectId, profile, cols, rows, opts) {
    try {
      const result = await window.cc.terminals.create({
        projectId,
        profile,
        cols,
        rows,
        extraArgs: opts?.extraArgs,
        title: opts?.title,
        cwd: opts?.cwd
      });
      if (!result.ok) {
        pushErrorToast(result.message);
        console.error('terminal create failed', result);
        return null;
      }
      // Idempotent append: ptys.create() emits `sessionUpdated` synchronously,
      // which the onUpdated handler may have already appended before this IPC
      // promise resolves (the two messages race). Dedupe by id so a click
      // never yields two tabs for the same session.
      set((s) => {
        const list = s.terminals[projectId] || [];
        if (list.some((t) => t.id === result.value.id)) return s;
        return {
          terminals: { ...s.terminals, [projectId]: [...list, result.value] }
        };
      });
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to create terminal'));
      return null;
    }
  },

  async closeTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const closing = list.find((t) => t.id === sessionId);
    // Index within the VISIBLE strip so selection advances to the visual
    // neighbor, not a hidden background session. Matches hideTerminal.
    const closingIdx = visibleTerminals(list).findIndex((t) => t.id === sessionId);
    try {
      await window.cc.terminals.close(sessionId);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to close terminal'));
    }
    useUi.getState().clearUnread(sessionId);
    // If the closed tab occupied any split slot, drop it from the slots.
    useUi.getState().removeFromSplit(projectId, sessionId);
    if (closing) get().loadGitStatus(projectId);
    set((s) => {
      const remaining = (s.terminals[projectId] || []).filter((t) => t.id !== sessionId);
      const stack = (s.closedTabs[projectId] || []).slice();
      if (closing) {
        // Capture enough to reopen faithfully: cwd + pinned so a warm reopen
        // lands in the same directory and re-pins. Resume-picker tabs already
        // carry `--resume <id>` in extraArgs, so those reopen as a continued
        // conversation for free.
        stack.push({
          profile: closing.profile,
          title: closing.title,
          extraArgs: closing.extraArgs,
          cwd: closing.cwd,
          pinned: closing.pinned
        });
        if (stack.length > 10) stack.splice(0, stack.length - 10);
      }
      // A closed tab is also no longer detached (covers closing a background
      // session straight from the Background list).
      const detached = (s.detachedStack[projectId] || []).filter((id) => id !== sessionId);
      return {
        terminals: { ...s.terminals, [projectId]: remaining },
        closedTabs: { ...s.closedTabs, [projectId]: stack },
        detachedStack: { ...s.detachedStack, [projectId]: detached }
      };
    });
    // Advance selection: if the closed tab was active, pick the neighbor to
    // its right (else its left, else nothing). Without this, selectedTabId
    // dangles on a removed id and the workspace renders blank.
    const ui = useUi.getState();
    if (ui.selectedTabId[projectId] === sessionId) {
      const next = visibleTerminals(get().terminals[projectId]);
      const targetIdx = Math.min(closingIdx, next.length - 1);
      const target = targetIdx >= 0 ? next[targetIdx]?.id : undefined;
      ui.selectTab(projectId, target);
    }
  },

  async hideTerminal(sessionId, projectId) {
    // Flip the session's headless flag in main; visibleTerminals() filters
    // headless out so it disappears from the tab strip without killing the
    // pty. The session keeps running and can be restored via the headless
    // picker. We optimistically update the local copy so the UI reacts
    // before the IPC round-trip resolves.
    const list = get().terminals[projectId] || [];
    const target = list.find((t) => t.id === sessionId);
    if (!target) return;
    const targetIdx = list.findIndex((t) => t.id === sessionId);
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId ? { ...t, headless: true } : t
        )
      }
    }));
    useUi.getState().clearUnread(sessionId);
    useUi.getState().removeFromSplit(projectId, sessionId);
    try {
      await window.cc.terminals.setHeadless(sessionId, true);
    } catch (err) {
      // Revert on failure so the tab reappears rather than vanishing
      // silently. Failure is rare (only if the pty is already gone).
      pushErrorToast(errorMessage(err, 'Failed to send tab to background'));
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).map((t) =>
            t.id === sessionId ? { ...t, headless: undefined } : t
          )
        }
      }));
      return;
    }
    // Record detach order (newest last) so ⌘⇧T resumes the most recent one.
    set((s) => {
      const cur = (s.detachedStack[projectId] || []).filter((id) => id !== sessionId);
      cur.push(sessionId);
      return { detachedStack: { ...s.detachedStack, [projectId]: cur } };
    });
    // Same selection-advance logic as closeTerminal: if the hidden tab was
    // active, pick the right neighbor (or left, or none).
    const ui = useUi.getState();
    if (ui.selectedTabId[projectId] === sessionId) {
      const next = visibleTerminals(get().terminals[projectId]);
      const advanceIdx = Math.min(targetIdx, next.length - 1);
      const advance = advanceIdx >= 0 ? next[advanceIdx]?.id : undefined;
      ui.selectTab(projectId, advance);
    }
  },

  async restoreTerminal(sessionId, projectId) {
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] ?? []).map((t) =>
          t.id === sessionId ? { ...t, headless: undefined } : t
        )
      },
      detachedStack: {
        ...s.detachedStack,
        [projectId]: (s.detachedStack[projectId] || []).filter((id) => id !== sessionId)
      }
    }));
    let updated: TerminalSession | null = null;
    try {
      updated = await window.cc.terminals.setHeadless(sessionId, false);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to resume session'));
      // Re-hide on failure to keep state consistent.
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).map((t) =>
            t.id === sessionId ? { ...t, headless: true } : t
          )
        },
        detachedStack: {
          ...s.detachedStack,
          [projectId]: [...(s.detachedStack[projectId] || []), sessionId]
        }
      }));
      return;
    }
    // setHeadless returns null when the pty is already gone (the session
    // exited while detached). Don't surface a hollow, dead tab — drop the
    // record and tell the user, mirroring the zombie reap in markExited.
    if (updated === null) {
      const dead = (get().terminals[projectId] || []).find((t) => t.id === sessionId);
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: (s.terminals[projectId] ?? []).filter((t) => t.id !== sessionId)
        }
      }));
      useUi.getState().clearUnread(sessionId);
      useUi
        .getState()
        .pushToast(
          `“${dead?.title ?? 'Session'}” ended while in the background`,
          'info'
        );
      return;
    }
    useUi.getState().selectTab(projectId, sessionId);
  },

  async restoreLastDetached(projectId) {
    const stack = get().detachedStack[projectId] || [];
    if (stack.length === 0) return null;
    const sessionId = stack[stack.length - 1];
    await get().restoreTerminal(sessionId, projectId);
    // restoreTerminal drops the id from the stack on both success and
    // dead-pty; return it only if the session is actually visible now.
    const alive = (get().terminals[projectId] || []).some(
      (t) => t.id === sessionId && !t.headless
    );
    return alive ? sessionId : null;
  },

  async restartTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const idx = list.findIndex((t) => t.id === sessionId);
    if (idx === -1) return null;
    const src = list[idx];
    // Snapshot what we need before kill/reset — once we close the pty the
    // session may be removed from the live map and we lose pinned/title.
    const snapshot = {
      profile: src.profile,
      title: src.title,
      extraArgs: src.extraArgs,
      pinned: src.pinned,
      cwd: src.cwd
    };
    try {
      await window.cc.terminals.close(sessionId);
    } catch {
      /* exited tabs already have a dead pty; close is a no-op */
    }
    useUi.getState().clearUnread(sessionId);
    useUi.getState().removeFromSplit(projectId, sessionId);
    set((s) => ({
      terminals: {
        ...s.terminals,
        [projectId]: (s.terminals[projectId] || []).filter((t) => t.id !== sessionId)
      }
    }));
    const created = await get().createTerminal(projectId, snapshot.profile, 80, 24, {
      extraArgs: snapshot.extraArgs,
      title: snapshot.title,
      cwd: snapshot.cwd
    });
    if (!created) return null;
    // Re-insert at the original slot so the tab order doesn't jump to the end,
    // and re-apply pin if the source was pinned.
    set((s) => {
      const cur = s.terminals[projectId] || [];
      const created2 = cur.find((t) => t.id === created.id);
      if (!created2) return s;
      const without = cur.filter((t) => t.id !== created.id);
      const target = Math.min(idx, without.length);
      const restored = { ...created2, pinned: snapshot.pinned };
      const next = without.slice(0, target).concat(restored, without.slice(target));
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
    useUi.getState().selectTab(projectId, created.id);
    return created;
  },

  async reopenLastClosed(projectId) {
    const stack = get().closedTabs[projectId] || [];
    if (stack.length === 0) return null;
    const top = stack[stack.length - 1];
    set((s) => ({
      closedTabs: {
        ...s.closedTabs,
        [projectId]: (s.closedTabs[projectId] || []).slice(0, -1)
      }
    }));
    const created = await get().createTerminal(projectId, top.profile, 80, 24, {
      extraArgs: top.extraArgs,
      title: top.title,
      cwd: top.cwd
    });
    // Re-pin if the closed tab was pinned, so reopen restores tab placement.
    if (created && top.pinned) {
      get().setPinned(projectId, created.id, true);
    }
    return created;
  },

  reorderTerminal(projectId, fromId, toId) {
    if (fromId === toId) return;
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      const fromIdx = list.findIndex((t) => t.id === fromId);
      const toIdx = list.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return s;
      // Pinned and unpinned tabs can't cross — they live in separate zones.
      if (list[fromIdx].pinned !== list[toIdx].pinned) return s;
      const next = list.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
  },

  setPinned(projectId, sessionId, pinned) {
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      const idx = list.findIndex((t) => t.id === sessionId);
      if (idx === -1) return s;
      const updated = { ...list[idx], pinned: pinned || undefined };
      const without = list.slice(0, idx).concat(list.slice(idx + 1));
      // Insert at the boundary: end of pinned zone (= start of unpinned zone).
      let insertAt = without.findIndex((t) => !t.pinned);
      if (insertAt === -1) insertAt = without.length;
      // When unpinning, drop at the start of the unpinned zone (= same boundary).
      const next = without.slice(0, insertAt).concat(updated, without.slice(insertAt));
      return { terminals: { ...s.terminals, [projectId]: next } };
    });
  },

  renameTerminal(projectId, sessionId, title) {
    set((s) => {
      const list = s.terminals[projectId];
      if (!list) return s;
      return {
        terminals: {
          ...s.terminals,
          [projectId]: list.map((t) => (t.id === sessionId ? { ...t, title } : t))
        }
      };
    });
  },

  markExited(sessionId, exitCode) {
    set((s) => {
      const terminals = { ...s.terminals };
      const detachedStack = { ...s.detachedStack };
      for (const pid of Object.keys(terminals)) {
        const tab = terminals[pid].find((t) => t.id === sessionId);
        if (!tab) continue;
        // Reap zombies: a session that exits while detached (headless) would
        // otherwise linger forever as a dead record in the Background list —
        // its pty is already gone, so it can be neither resumed nor killed.
        // Drop it outright and surface the exit so the user isn't surprised.
        if (tab.headless) {
          terminals[pid] = terminals[pid].filter((t) => t.id !== sessionId);
          detachedStack[pid] = (detachedStack[pid] || []).filter((id) => id !== sessionId);
          const code = exitCode ?? tab.exitCode;
          queueMicrotask(() => {
            // Drop the orphaned unread key too (mirrors restoreTerminal's
            // dead-pty path) so it doesn't linger in the unread map.
            useUi.getState().clearUnread(sessionId);
            useUi
              .getState()
              .pushToast(
                `Background session “${tab.title}” ended${
                  code != null && code !== 0 ? ` (exit ${code})` : ''
                }`,
                code != null && code !== 0 ? 'error' : 'info'
              );
          });
        } else {
          terminals[pid] = terminals[pid].map((t) =>
            t.id === sessionId
              ? { ...t, status: 'exited' as const, exitCode: exitCode ?? t.exitCode }
              : t
          );
        }
      }
      return { terminals, detachedStack };
    });
  },

  async loadGitStatus(projectId) {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const status = await window.cc.git.status(project.path);
      set((s) => ({ gitStatus: { ...s.gitStatus, [projectId]: status } }));
    } catch {
      set((s) => ({ gitStatus: { ...s.gitStatus, [projectId]: null } }));
    }
  },

  async refreshAllGitStatus() {
    const projects = get().projects;
    // Sequential to avoid spawning N git processes at once.
    for (const p of projects) {
      try {
        const status = await window.cc.git.status(p.path);
        set((s) => ({ gitStatus: { ...s.gitStatus, [p.id]: status } }));
      } catch {
        /* ignore */
      }
    }
  }
}));

// ============================================================================
// Inbox — entries feed, selection, per-entry read tracking.
//
// Adapted from OpenAlice's three live stores (`ui/src/live/inbox*.ts`):
// - feed: push-driven (onAppended/onRemoved), no polling. Initial load is
//   one history call from useData.init().
// - selection: ephemeral, not persisted.
// - read: per-entry, persisted to localStorage. SELECTION marks read —
//   never bulk-on-visibility. See OpenAlice's inbox-read.ts for the
//   rationale: bulk-on-view destroys triage in an inbox-flow product.
// ============================================================================

interface InboxLiveState {
  entries: InboxEntry[];
  loading: boolean;
  /** Replace the current list (used by initial load + reconciliation). */
  setEntries: (entries: InboxEntry[]) => void;
  /** Push a freshly-appended entry to the front. */
  prepend: (entry: InboxEntry) => void;
  /** Remove an entry from local state (optimistic delete or push echo). */
  removeLocal: (id: string) => void;
}

export const useInbox = create<InboxLiveState>((set) => ({
  entries: [],
  loading: true,
  setEntries: (entries) => set({ entries, loading: false }),
  prepend: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  removeLocal: (id) =>
    set((s) => {
      if (!s.entries.some((e) => e.id === id)) return s;
      return { entries: s.entries.filter((e) => e.id !== id) };
    })
}));

interface InboxSelectionState {
  selectedEntryId: string | null;
  select: (id: string | null) => void;
}

export const useInboxSelection = create<InboxSelectionState>((set) => ({
  selectedEntryId: null,
  select: (id) => set({ selectedEntryId: id })
}));

interface InboxReadState {
  /** Object-shaped (not Set) so Zustand `persist` can JSON-serialise it. */
  readIds: Record<string, true>;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  /** Reserved for an explicit "Mark all read" affordance — not auto-fired. */
  markAllRead: (ids: string[]) => void;
}

export const useInboxRead = create<InboxReadState>()(
  persist(
    (set) => ({
      readIds: {},
      markRead: (id) =>
        set((s) => (s.readIds[id] ? s : { readIds: { ...s.readIds, [id]: true } })),
      markUnread: (id) =>
        set((s) => {
          if (!s.readIds[id]) return s;
          const next = { ...s.readIds };
          delete next[id];
          return { readIds: next };
        }),
      markAllRead: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const next = { ...s.readIds };
          for (const id of ids) next[id] = true;
          return { readIds: next };
        })
    }),
    { name: 'cc.inbox-read.v1', version: 1 }
  )
);

interface InboxAnsweredState {
  /**
   * Entries the user has replied to via the inbox reply box. Object-shaped
   * (not Set) so Zustand `persist` can JSON-serialise it. Mirrors
   * `useInboxRead` — read and answered are independent axes (an entry can be
   * read but unanswered, or answered which implies read).
   */
  answeredIds: Record<string, true>;
  markAnswered: (id: string) => void;
}

export const useInboxAnswered = create<InboxAnsweredState>()(
  persist(
    (set) => ({
      answeredIds: {},
      markAnswered: (id) =>
        set((s) =>
          s.answeredIds[id] ? s : { answeredIds: { ...s.answeredIds, [id]: true } }
        )
    }),
    { name: 'cc.inbox-answered.v1', version: 1 }
  )
);

interface SchedulerLiveState {
  tasks: ScheduledTask[];
  loading: boolean;
}

export const useScheduler = create<SchedulerLiveState>(() => ({
  tasks: [],
  loading: true
}));

interface ScheduleTemplatesState {
  templates: ScheduleTemplate[];
  loading: boolean;
}

export const useScheduleTemplates = create<ScheduleTemplatesState>(() => ({
  templates: [],
  loading: true
}));

interface ScheduleGroupsState {
  groups: ScheduleGroup[];
  loading: boolean;
}

export const useScheduleGroups = create<ScheduleGroupsState>(() => ({
  groups: [],
  loading: true
}));

interface PluginsLiveState {
  entries: PluginEntry[];
  loading: boolean;
}

export const usePlugins = create<PluginsLiveState>(() => ({
  entries: [],
  loading: true
}));

interface McpLiveState {
  entries: McpServerEntry[];
  loading: boolean;
}

export const useMcpCatalogue = create<McpLiveState>(() => ({
  entries: [],
  loading: true
}));

/** Sidebar-badge count: entries whose id isn't in the read set. */
export function useUnreadInboxCount(): number {
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  let n = 0;
  for (const e of entries) if (!readIds[e.id]) n += 1;
  return n;
}

/** Sidebar-badge count: scheduled tasks that are enabled (armed to fire). */
export function useEnabledSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  let n = 0;
  for (const t of tasks) if (t.enabled) n += 1;
  return n;
}

/**
 * Sidebar-badge count: scheduled tasks with a live terminal session right
 * now. Mirrors the "Running now" computation in SchedulerOverview — a task
 * counts as running when any of its run-history records points at a session
 * that is still `running`/`starting` in the project's terminals.
 */
export function useRunningSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  const terminals = useData((s) => s.terminals);
  const live = new Set<string>();
  for (const [pid, list] of Object.entries(terminals)) {
    for (const s of list) {
      if (s.status === 'running' || s.status === 'starting') {
        live.add(`${pid}:${s.id}`);
      }
    }
  }
  let n = 0;
  for (const t of tasks) {
    for (const r of t.status?.runs ?? []) {
      if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/**
 * Optimistic delete + IPC. Called from the detail view's trash button and
 * the Delete/Backspace shortcut. Removes locally first so the UI doesn't
 * lag the IPC round-trip; the main process's onRemoved push echoes back
 * and is a no-op (already filtered out).
 */
export async function deleteInboxEntry(id: string): Promise<void> {
  useInbox.getState().removeLocal(id);
  try {
    await window.cc.inbox.delete(id);
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to delete inbox entry'));
  }
}

/**
 * Reply to an inbox entry's originating terminal — the write-back half of the
 * inbox question/answer loop. The agent pushes a question via `inbox_push`
 * (stamped with its sessionId); this sends the user's answer straight to that
 * pty's stdin, so the conversation continues without leaving the inbox.
 *
 * If the session is headless (e.g. a background scheduled run), we DON'T
 * promote it to a visible tab — replying in place is the whole point. The
 * "Open in session" button remains the explicit promotion path. We mark the
 * entry answered (localStorage, mirrors read-state) and toast confirmation.
 *
 * Returns true on success. A dead session (pty already exited) is reported as
 * an error toast and returns false — the caller's UI already shows a tombstone
 * in that case, so this is the belt-and-braces path for a race.
 */
export async function replyToInboxEntry(
  entryId: string,
  sessionId: string,
  text: string
): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  try {
    await window.cc.terminals.reply(sessionId, body);
    useInboxAnswered.getState().markAnswered(entryId);
    useUi.getState().pushToast('Reply sent', 'info');
    return true;
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to send reply'));
    return false;
  }
}
