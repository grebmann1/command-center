import { create } from 'zustand';
import type {
  Project,
  TerminalSession,
  LaunchProfileId,
  ClaudeSessionSummary,
  GitStatus
} from '@shared/types';

export type NavId = 'projects' | 'settings';

export interface Toast {
  id: string;
  message: string;
  kind?: 'info' | 'error';
}

export type WorkspaceMode = 'terminals' | 'explorer';

interface UiState {
  nav: NavId;
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
  // explorer: per-project MRU of opened file paths (most recent at index 0)
  recentFiles: Record<string, string[]>;
  // explorer: per-project diff-vs-HEAD toggle for the open file
  explorerDiff: Record<string, boolean>;
  // explorer: per-project tree mode (file tree vs flat changes list)
  explorerTreeMode: Record<string, 'files' | 'changes'>;
  setExplorerDiff: (projectId: string, on: boolean) => void;
  toggleExplorerDiff: (projectId: string) => void;
  setExplorerTreeMode: (projectId: string, mode: 'files' | 'changes') => void;
  toggleExplorerTreeMode: (projectId: string) => void;
  // experimental: when true, ExplorerView renders the monaco-vscode-api
  // workbench instead of the homegrown tree+monaco split. Persisted in
  // localStorage so a crash on boot can be recovered by toggling off.
  workbenchEnabled: boolean;
  setWorkbenchEnabled: (on: boolean) => void;
  setNav: (n: NavId) => void;
  selectProject: (id: string | null) => void;
  selectTab: (projectId: string, tabId: string | undefined) => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setResumeOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFindOpen: (open: boolean) => void;
  pushToast: (message: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: string) => void;
  markUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;
  setWorkspaceMode: (projectId: string, mode: WorkspaceMode) => void;
  toggleWorkspaceMode: (projectId: string) => void;
  setExplorerFile: (projectId: string, path: string | undefined) => void;
  requestExplorerGoto: (projectId: string, line: number, column: number) => void;
}

export const LIST_PANE_MIN = 200;
export const LIST_PANE_MAX = 600;

export function applyListPaneWidth(px: number) {
  const clamped = Math.max(LIST_PANE_MIN, Math.min(LIST_PANE_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--col-list', `${clamped}px`);
}

// Debounced write of workspaceMode -> AppConfig.workspaceModes.
let persistTimer: number | null = null;
function persistWorkspaceModes() {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const map = useUi.getState().workspaceMode;
    window.cc.config.set({ workspaceModes: map }).catch(() => {});
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

export const useUi = create<UiState>((set) => ({
  nav: 'projects',
  selectedProjectId: null,
  selectedTabId: {},
  paletteOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  resumeOpen: false,
  searchOpen: false,
  findOpen: false,
  toasts: [],
  unread: {},
  workspaceMode: {},
  explorerFile: {},
  explorerGoto: {},
  recentFiles: {},
  explorerDiff: {},
  explorerTreeMode: {},
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
  setNav: (nav) => set({ nav }),
  selectProject: (id) => {
    set({ selectedProjectId: id });
    if (!id) return;
    window.cc.config.set({ lastProjectId: id }).catch(() => {});
    // Persist the touch to disk so the next launch's auto-sort reflects
    // recent use, but DON'T merge the updated lastActiveAt back into the
    // in-memory projects list — that causes the just-clicked project to
    // jump to the top of the sidebar mid-session, which is jarring.
    window.cc.projects.touch(id).catch(() => {});
    useData.getState().loadGitStatus(id);
  },
  selectTab: (projectId, tabId) =>
    set((s) => {
      const unread = { ...s.unread };
      if (tabId) delete unread[tabId];
      return { selectedTabId: { ...s.selectedTabId, [projectId]: tabId }, unread };
    }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setQuickOpenOpen: (quickOpenOpen) => set({ quickOpenOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setResumeOpen: (resumeOpen) => set({ resumeOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setFindOpen: (findOpen) => set({ findOpen }),
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
    }))
}));

export interface ClosedTab {
  profile: LaunchProfileId;
  title: string;
  extraArgs?: string[];
}

interface DataState {
  projects: Project[];
  terminals: Record<string, TerminalSession[]>; // by project id
  claudeSessions: Record<string, ClaudeSessionSummary[]>; // by project id
  closedTabs: Record<string, ClosedTab[]>; // by project id, most recent at end
  gitStatus: Record<string, GitStatus | null>; // by project id
  fontSize: number;
  init: () => Promise<void>;
  loadGitStatus: (projectId: string) => Promise<void>;
  refreshAllGitStatus: () => Promise<void>;
  setFontSize: (n: number) => void;
  reopenLastClosed: (projectId: string) => Promise<TerminalSession | null>;
  loadProjects: () => Promise<void>;
  loadClaudeSessions: (projectId: string) => Promise<void>;
  addProject: () => Promise<Project | null>;
  addProjectByPath: (path: string) => Promise<Project | null>;
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
  closeTerminal: (sessionId: string, projectId: string) => Promise<void>;
  reorderTerminal: (projectId: string, fromId: string, toId: string) => void;
  renameTerminal: (projectId: string, sessionId: string, title: string) => void;
  setPinned: (projectId: string, sessionId: string, pinned: boolean) => void;
  markExited: (sessionId: string) => void;
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
  gitStatus: {},
  fontSize: 13,

  setFontSize(n) {
    set({ fontSize: n });
  },

  async init() {
    try {
      const [projects, config] = await Promise.all([
        window.cc.projects.list(),
        window.cc.config.get()
      ]);
      set({ projects, fontSize: config.fontSize });
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
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to initialize app state'));
    }
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

  async updateProject(id, patch) {
    try {
      const updated = await window.cc.projects.update(id, patch);
      if (!updated) return;
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? updated : p))
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
      delete terminals[id];
      return {
        projects: s.projects.filter((p) => p.id !== id),
        terminals
      };
    });
    useUi.setState((s) => {
      if (!(id in s.workspaceMode)) return s;
      const next = { ...s.workspaceMode };
      delete next[id];
      return { workspaceMode: next };
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
      set((s) => ({
        terminals: {
          ...s.terminals,
          [projectId]: [...(s.terminals[projectId] || []), result.value]
        }
      }));
      return result.value;
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to create terminal'));
      return null;
    }
  },

  async closeTerminal(sessionId, projectId) {
    const list = get().terminals[projectId] || [];
    const closing = list.find((t) => t.id === sessionId);
    try {
      await window.cc.terminals.close(sessionId);
    } catch (err) {
      pushErrorToast(errorMessage(err, 'Failed to close terminal'));
    }
    useUi.getState().clearUnread(sessionId);
    if (closing) get().loadGitStatus(projectId);
    set((s) => {
      const remaining = (s.terminals[projectId] || []).filter((t) => t.id !== sessionId);
      const stack = (s.closedTabs[projectId] || []).slice();
      if (closing) {
        stack.push({
          profile: closing.profile,
          title: closing.title,
          extraArgs: closing.extraArgs
        });
        if (stack.length > 10) stack.splice(0, stack.length - 10);
      }
      return {
        terminals: { ...s.terminals, [projectId]: remaining },
        closedTabs: { ...s.closedTabs, [projectId]: stack }
      };
    });
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
    return get().createTerminal(projectId, top.profile, 80, 24, {
      extraArgs: top.extraArgs,
      title: top.title
    });
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

  markExited(sessionId) {
    set((s) => {
      const terminals = { ...s.terminals };
      for (const pid of Object.keys(terminals)) {
        terminals[pid] = terminals[pid].map((t) =>
          t.id === sessionId ? { ...t, status: 'exited' as const } : t
        );
      }
      return { terminals };
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
