import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, X, Check, Pencil, Code2, FolderOpen, TerminalSquare, LayoutDashboard, Settings2, Network, ClipboardCopy, Inbox as InboxIcon, EyeOff, Layers, Settings, ChevronRight, ArrowLeft, RotateCcw, Activity } from 'lucide-react';
import { CursorIcon } from './icons/CursorIcon';
import {
  useData,
  useUi,
  useAgentStatus,
  useInbox,
  useInboxRead,
  useInboxKeep,
  clearInbox,
  useScheduler,
  useScheduleGroups,
  sortProjectsForDisplay,
  visibleTerminals,
  backgroundTerminals,
  applyListPaneWidth,
  LIST_PANE_MIN,
  LIST_PANE_MAX
} from '../store';
import { groupIcon, GROUP_FALLBACK_COLOR } from './scheduleGroupMeta';
import { ScheduleGroupsModal } from './ScheduleGroupsModal';
import type { OpenTarget, LaunchProfileId, Project, AgentState } from '@shared/types';
import { MODULE_IDS } from '../modules';
import { InboxSidebar } from './InboxSidebar';
import { AddRemoteProjectDialog } from './AddRemoteProjectDialog';
import { profileIcon } from '../util/profileIcon';
import { bucketSessions } from '../util/sessionBuckets';

const PROJECT_COLORS = [
  '#2f81f7', // blue (default)
  '#3fb950', // green
  '#d4a017', // gold
  '#bc8cff', // magenta
  '#39c5cf', // cyan
  '#f85149', // red
  '#ff7b72', // pink
  '#8b949e' // gray
];

interface MenuState {
  projectId: string;
  x: number;
  y: number;
}

/**
 * A collapsible rail section header. Clicking the label toggles `collapsed`
 * (persisted in the store under `sectionKey`); callers render the section body
 * only when not collapsed. An optional `action` renders on the right (e.g. the
 * manage-groups gear) and doesn't trigger the collapse.
 */
function SectionHeader({
  label,
  sectionKey,
  action
}: {
  label: string;
  sectionKey: string;
  action?: React.ReactNode;
}) {
  const collapsed = useUi((s) => !!s.collapsedSections[sectionKey]);
  const toggleSection = useUi((s) => s.toggleSection);
  return (
    <div className={`settings-scope-label settings-scope-label--toggle ${action ? 'settings-scope-label--action' : ''}`}>
      <button
        type="button"
        className="list-section-toggle"
        onClick={() => toggleSection(sectionKey)}
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      >
        <ChevronRight size={11} className={`list-section-chevron ${collapsed ? '' : 'open'}`} />
        <span>{label}</span>
      </button>
      {action}
    </div>
  );
}

/** Human label for the agent status dot's tooltip + aria. Mirrors TabBar. */
const AGENT_STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Blocked — needs you',
  working: 'Working',
  done: 'Done — unseen',
  idle: 'Idle',
  unknown: ''
};

/**
 * Live agent-state dot. Subscribes by id to a PRIMITIVE (the state string), so
 * one session's transition repaints only its own dot. Renders nothing for
 * `unknown` (plain shells, no signal yet). Mirrors TabBar's AgentStatusDot.
 */
function AgentStatusDot({ sessionId }: { sessionId: string }) {
  const state = useAgentStatus((s) => s.byId[sessionId] ?? 'unknown');
  if (state === 'unknown') return null;
  return (
    <span
      className={`tab-agent-dot agent-${state}`}
      title={AGENT_STATE_LABEL[state]}
      aria-label={AGENT_STATE_LABEL[state]}
    />
  );
}

/** Project rollup dot — the most-urgent agent state across the project's live
 *  sessions. Subscribes by project id to a PRIMITIVE so it repaints alone. */
function ProjectRollupDot({ projectId }: { projectId: string }) {
  const state = useAgentStatus((s) => s.rollup[projectId] ?? 'unknown');
  if (state === 'unknown') return null;
  return (
    <span
      className={`tab-agent-dot agent-${state}`}
      title={AGENT_STATE_LABEL[state]}
      aria-label={AGENT_STATE_LABEL[state]}
    />
  );
}

const KNOWN_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

/** Quick-launch profiles offered by the focus-view "+" dropdown, in order. */
const FOCUS_NEW_PROFILES: { profile: LaunchProfileId; label: string }[] = [
  { profile: 'claude', label: 'claude' },
  { profile: 'claude-yolo', label: 'claude --yolo' },
  { profile: 'shell', label: 'shell' }
];

/** First entry in defaultAgents wins for one-click "+" semantics, but only if
 *  it's a known profile id; otherwise default to 'claude'. Mirrors Workspace. */
function projectDefaultProfile(project: Project): LaunchProfileId {
  const first = project.defaultAgents?.[0];
  if (first && (KNOWN_PROFILES as string[]).includes(first)) return first as LaunchProfileId;
  return 'claude';
}

/**
 * Focus mode: the column drills into a single project, showing all its sessions
 * grouped by live status bucket. Replaces the project list while
 * `focusedProjectId` is set. Renderer-only — consumes Sprint-1 store + buckets.
 */
function ProjectFocusView({ project }: { project: Project }) {
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectedId = useUi((s) => s.selectedProjectId);
  const collapsedSections = useUi((s) => s.collapsedSections);
  const unread = useUi((s) => s.unread);
  const createTerminal = useData((s) => s.createTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const restoreTerminal = useData((s) => s.restoreTerminal);

  // Raw, stable slices only — never call bucketSessions() inside an inline
  // selector (it returns a fresh array → infinite render loop, see
  // zustand-selector-stable-ref memory). Subscribe to the project's session
  // list and the whole agent-status map as primitives/stable refs, then derive
  // the buckets in a useMemo keyed on them.
  const sessions = useData((s) => s.terminals[project.id]);
  const agentById = useAgentStatus((s) => s.byId);

  const buckets = useMemo(
    // Pass the FULL list (visible + headless); bucketSessions partitions
    // background itself via the headless flag.
    () => bucketSessions(sessions ?? [], agentById),
    [sessions, agentById]
  );

  const activeTab = selectedId === project.id ? selectedTabId[project.id] : undefined;
  const totalSessions = (sessions ?? []).length;

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);

  const handleNew = (profile: LaunchProfileId) => {
    setNewMenuOpen(false);
    void createTerminal(project.id, profile, 80, 24).then((session) => {
      if (session) {
        selectProject(project.id);
        selectTab(project.id, session.id);
      }
    });
  };

  // Close the "+" launch menu on any outside click or Escape.
  useEffect(() => {
    if (!newMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (newMenuRef.current?.contains(e.target as Node)) return;
      setNewMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [newMenuOpen]);

  return (
    <section className="list-pane">
      <header className="list-header">
        <button
          type="button"
          className="focus-back"
          onClick={() => exitProjectFocus()}
          title="Back to all projects"
        >
          <ArrowLeft size={14} />
          <span>All projects</span>
        </button>
      </header>
      <div className="focus-project-header">
        <span
          className="project-dot"
          style={project.color ? { background: project.color } : undefined}
        />
        <span className="focus-project-name" title={project.path}>
          {project.name}
        </span>
        <ProjectRollupDot projectId={project.id} />
        <div className="focus-new" ref={newMenuRef}>
          <button
            type="button"
            className="focus-new-btn"
            aria-label="New session"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            title="New session"
            onClick={() => setNewMenuOpen((v) => !v)}
          >
            <Plus size={14} />
          </button>
          {newMenuOpen && (
            <div className="focus-new-menu" role="menu">
              {FOCUS_NEW_PROFILES.map(({ profile, label }) => (
                <button
                  key={profile}
                  type="button"
                  role="menuitem"
                  className="focus-new-menu-item"
                  onClick={() => handleNew(profile)}
                >
                  <span className={`tab-profile-icon profile-${profile}`} aria-hidden="true">
                    {profileIcon(profile)}
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="list-body">
        {totalSessions === 0 ? (
          <div className="list-empty">
            No sessions.
            <br />
            Click <strong>+</strong> to start one.
          </div>
        ) : (
          buckets.map((bucket) => {
            const sectionKey = `focus:${project.id}:${bucket.id}`;
            const collapsed = !!collapsedSections[sectionKey];
            const isBackground = bucket.id === 'background';
            return (
              <div key={bucket.id} className="focus-bucket">
                <SectionHeader
                  label={bucket.label}
                  sectionKey={sectionKey}
                  action={<span className="list-count-badge">{bucket.sessions.length}</span>}
                />
                {!collapsed && (
                  <div className="project-terminals" role="list">
                    {bucket.sessions.map((t) => {
                      const exited = t.status === 'exited';
                      const bad = exited && (t.exitCode ?? 0) !== 0;
                      return (
                        <div
                          key={t.id}
                          role="listitem"
                          className={`project-terminal-row ${activeTab === t.id ? 'active' : ''} ${
                            exited ? 'exited' : ''
                          } ${bad ? 'exited-bad' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isBackground) {
                              void restoreTerminal(t.id, project.id);
                            } else {
                              selectProject(project.id);
                              selectTab(project.id, t.id);
                            }
                          }}
                          title={
                            isBackground
                              ? `${t.title} · running in the background — click to resume`
                              : exited && t.exitCode != null
                                ? `${t.title} · exited (code ${t.exitCode})`
                                : t.title
                          }
                        >
                          <span
                            className={`tab-profile-icon profile-${t.profile}`}
                            aria-hidden="true"
                          >
                            {profileIcon(t.profile)}
                          </span>
                          <span className="project-terminal-name">{t.title}</span>
                          <AgentStatusDot sessionId={t.id} />
                          {bad && (
                            <span
                              className="project-terminal-exit-bad"
                              aria-label={`Exit code ${t.exitCode}`}
                            >
                              ✗{t.exitCode}
                            </span>
                          )}
                          {unread[t.id] && activeTab !== t.id && (
                            <span className="project-terminal-unread" aria-label="Unread output" />
                          )}
                          {isBackground && (
                            <button
                              type="button"
                              className="project-terminal-close"
                              aria-label={`Resume ${t.title}`}
                              title="Resume into a tab"
                              onClick={(e) => {
                                e.stopPropagation();
                                void restoreTerminal(t.id, project.id);
                              }}
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="project-terminal-close"
                            aria-label={exited ? `Dismiss ${t.title}` : `Delete ${t.title}`}
                            title={
                              isBackground
                                ? 'Terminate this background session'
                                : exited
                                  ? 'Dismiss'
                                  : 'Delete (ends the process)'
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !exited &&
                                !window.confirm(
                                  `Delete “${t.title}”? The process will be terminated.`
                                )
                              ) {
                                return;
                              }
                              void closeTerminal(t.id, project.id);
                            }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function ListPane() {
  const nav = useUi((s) => s.nav);

  if (nav === 'settings') return <SettingsPane />;
  if (nav === 'scheduler') return <SchedulerPane />;
  if (nav === 'inbox') return <InboxPane />;
  if (nav === 'skills' || nav === 'mcp' || nav === 'plugins') {
    return <CataloguePane nav={nav as 'skills' | 'mcp' | 'plugins'} />;
  }
  // App modules (plugins/*) own the whole content area and bring their own
  // filter rail — they don't want the Projects list column.
  if (MODULE_IDS.includes(nav)) return null;
  return <ProjectsList />;
}

function InboxPane() {
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  const markAllRead = useInboxRead((s) => s.markAllRead);
  const keptIds = useInboxKeep((s) => s.keptIds);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const unreadCount = entries.reduce((n, e) => (readIds[e.id] ? n : n + 1), 0);
  // How many would a Clear remove (everything not flagged Keep).
  const clearableCount = entries.reduce((n, e) => (keptIds[e.id] ? n : n + 1), 0);
  const keptCount = entries.length - clearableCount;

  const onClear = () => {
    if (clearableCount === 0) return;
    const keepNote = keptCount > 0 ? ` ${keptCount} kept ${keptCount === 1 ? 'entry' : 'entries'} will remain.` : '';
    const ok = window.confirm(
      `Clear ${clearableCount} inbox ${clearableCount === 1 ? 'message' : 'messages'}?${keepNote} This can't be undone.`
    );
    if (ok) void clearInbox();
  };

  return (
    <section className="list-pane inbox-list-pane">
      <header className="list-header">
        <h2>Inbox</h2>
        <div className="list-header-actions">
          <button
            type="button"
            className={`icon-btn inbox-unread-toggle ${unreadOnly ? 'on' : ''}`}
            title={unreadOnly ? 'Show all messages' : `Show only unread (${unreadCount})`}
            onClick={() => setUnreadOnly((v) => !v)}
            disabled={unreadCount === 0 && !unreadOnly}
          >
            <InboxIcon size={14} />
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              className="icon-btn inbox-mark-read-all"
              title={`Mark ${unreadCount} as read`}
              onClick={() => markAllRead(entries.map((e) => e.id))}
            >
              <Check size={14} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn inbox-clear-all"
            title={
              clearableCount === 0
                ? 'Nothing to clear (all kept or empty)'
                : `Clear ${clearableCount} ${clearableCount === 1 ? 'message' : 'messages'}${keptCount > 0 ? ` (keeps ${keptCount})` : ''}`
            }
            onClick={onClear}
            disabled={clearableCount === 0}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>
      <div className="inbox-filter-row">
        <Search size={12} className="inbox-filter-icon" aria-hidden />
        <input
          type="text"
          className="inbox-filter-input"
          placeholder="Filter inbox…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="inbox-filter-clear"
            aria-label="Clear filter"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="list-body">
        <InboxSidebar query={query} unreadOnly={unreadOnly} />
      </div>
    </section>
  );
}

function ProjectsList() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const closeTerminal = useData((s) => s.closeTerminal);
  const addProject = useData((s) => s.addProject);
  const addProjectByPath = useData((s) => s.addProjectByPath);
  const addRemoteProject = useData((s) => s.addRemoteProject);
  const removeProject = useData((s) => s.removeProject);
  const updateProject = useData((s) => s.updateProject);
  const reorderProjects = useData((s) => s.reorderProjects);
  const selectedId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const selectTab = useUi((s) => s.selectTab);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const pushToast = useUi((s) => s.pushToast);
  const unread = useUi((s) => s.unread);
  const gitStatus = useData((s) => s.gitStatus);
  const projectExpanded = useUi((s) => s.projectExpanded);
  const toggleProjectExpanded = useUi((s) => s.toggleProjectExpanded);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const setOverviewOpen = useUi((s) => s.setOverviewOpen);
  const hideIdleProjects = useUi((s) => s.hideIdleProjects);
  const toggleHideIdleProjects = useUi((s) => s.toggleHideIdleProjects);

  const openIn = async (target: OpenTarget, path: string) => {
    try {
      const r = await window.cc.openers.openIn(target, path);
      if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Failed to open in ${target}`, 'error');
    }
  };
  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
    setMenu(null);
  };

  const commitRename = () => {
    if (renamingId) {
      const v = renameValue.trim();
      if (v) updateProject(renamingId, { name: v });
    }
    setRenamingId(null);
  };

  const sortedProjects = sortProjectsForDisplay(projects);

  // Focus mode: drill into a single project. If the focused project was
  // deleted/closed while focused, fall back to the list gracefully.
  const focusedProject = focusedProjectId
    ? projects.find((p) => p.id === focusedProjectId) ?? null
    : null;
  useEffect(() => {
    if (focusedProjectId && !focusedProject) exitProjectFocus();
  }, [focusedProjectId, focusedProject, exitProjectFocus]);

  // A project is "active" when it has at least one live session — a non-exited
  // visible terminal or one running in the background. Keeps the selected
  // project visible regardless, so toggling the filter never hides the row the
  // user is currently in.
  const projectHasRunningAgents = (p: Project) =>
    visibleTerminals(terminals[p.id]).some((t) => t.status !== 'exited') ||
    backgroundTerminals(terminals[p.id]).length > 0;

  const visibleProjects = (() => {
    let list = sortedProjects;
    if (hideIdleProjects) {
      list = list.filter((p) => p.id === selectedId || projectHasRunningAgents(p));
    }
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  })();

  const handleProjectDrop = (toId: string) => {
    const fromId = draggingProjectId;
    setDraggingProjectId(null);
    setDragOverProjectId(null);
    if (!fromId || fromId === toId) return;
    // Reorder against the full sorted list, not the filtered view, so
    // dragging while filtering doesn't reshuffle invisible projects.
    const ids = sortedProjects.map((p) => p.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = ids.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    reorderProjects(next);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  // Clamp the context menu into the viewport. It's positioned at the raw click
  // coordinates, so right-clicking low in the list would otherwise push the
  // bottom items (Rename, Remove project) off-screen and out of reach.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [menu]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.project-delete-armed')) return;
      setConfirmDeleteId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null);
    };
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [confirmDeleteId]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const files = Array.from(e.dataTransfer.files);
    const paths = files
      .map((f) => window.cc.files.pathForFile(f))
      .filter(Boolean);
    let lastAdded: { id: string } | null = null;
    for (const path of paths) {
      const p = await addProjectByPath(path);
      if (p) lastAdded = p;
    }
    if (lastAdded) selectProject(lastAdded.id);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const onMove = (ev: MouseEvent) => {
      // Pane sits to the right of the nav column; its left edge equals --col-nav.
      const navW = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--col-nav')
      );
      const next = ev.clientX - (Number.isFinite(navW) ? navW : 0);
      applyListPaneWidth(next);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const w = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--col-list')
      );
      if (Number.isFinite(w)) {
        window.cc.config.set({ listPaneWidth: Math.round(w) }).catch(() => {});
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    applyListPaneWidth(280);
    window.cc.config.set({ listPaneWidth: 280 }).catch(() => {});
  };

  if (focusedProject) return <ProjectFocusView project={focusedProject} />;

  return (
    <section
      className={`list-pane ${dropOver ? 'drop-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="list-header">
        <h2>Projects</h2>
        <button
          className={`icon-btn ${hideIdleProjects ? 'on' : ''}`}
          aria-label={hideIdleProjects ? 'Show all projects' : 'Show only projects with running agents'}
          aria-pressed={hideIdleProjects}
          title={hideIdleProjects ? 'Showing only projects with running agents' : 'Hide projects without running agents'}
          onClick={() => toggleHideIdleProjects()}
        >
          <Activity size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Add remote project"
          title="Add remote (SSH) project"
          onClick={() => setShowRemoteDialog(true)}
        >
          <Network size={16} />
        </button>
        <button className="icon-btn" aria-label="Add project" onClick={() => addProject()}>
          <Plus size={16} />
        </button>
      </header>
      {projects.length > 0 && (
        <div className="list-filter">
          <Search size={12} className="list-filter-icon" />
          <input
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="list-filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="list-body">
        <button
          type="button"
          className={`list-overview ${overviewOpen ? 'active' : ''}`}
          onClick={() => setOverviewOpen(true)}
          aria-pressed={overviewOpen}
        >
          <LayoutDashboard size={14} />
          <span>Overview</span>
        </button>
        {projects.length === 0 ? (
          <div className="list-empty">
            No projects yet.
            <br />
            Click <strong>+</strong> or drop a folder here.
          </div>
        ) : visibleProjects.length === 0 ? (
          filter.trim() ? (
            <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
          ) : (
            <div className="list-empty">
              No projects with running agents.
              <br />
              <button
                type="button"
                className="list-empty-link"
                onClick={() => toggleHideIdleProjects()}
              >
                Show all projects
              </button>
            </div>
          )
        ) : (
          visibleProjects.map((p) => (
            <div key={p.id} className="project-group">
            <div
              className={`project-item ${selectedId === p.id ? 'active' : ''} ${
                draggingProjectId === p.id ? 'dragging' : ''
              } ${
                dragOverProjectId === p.id &&
                draggingProjectId &&
                draggingProjectId !== p.id
                  ? 'drag-over'
                  : ''
              }`}
              onClick={() => selectProject(p.id)}
              onDoubleClick={(e) => {
                // Double-clicking the row enters focus mode. The project NAME
                // has its own onDoubleClick (rename) with stopPropagation, so
                // double-clicking the name renames and never reaches here.
                e.stopPropagation();
                enterProjectFocus(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ projectId: p.id, x: e.clientX, y: e.clientY });
              }}
              draggable={renamingId !== p.id}
              onDragStart={(e) => {
                if (renamingId === p.id) {
                  e.preventDefault();
                  return;
                }
                setDraggingProjectId(p.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-cc-project', p.id);
              }}
              onDragEnter={(e) => {
                if (!draggingProjectId || draggingProjectId === p.id) return;
                e.preventDefault();
                setDragOverProjectId(p.id);
              }}
              onDragOver={(e) => {
                if (!draggingProjectId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (!draggingProjectId) return;
                // Don't let project-reorder drops bubble to the section's
                // file-drop handler (which adds new projects from the OS).
                e.preventDefault();
                e.stopPropagation();
                handleProjectDrop(p.id);
              }}
              onDragEnd={() => {
                setDraggingProjectId(null);
                setDragOverProjectId(null);
              }}
            >
              {(() => {
                const list = visibleTerminals(terminals[p.id]);
                const hasUnread = list.some((t) => unread[t.id]);
                return (
                  <span
                    className={`project-dot ${hasUnread ? 'unread' : ''}`}
                    style={p.color ? { background: p.color } : undefined}
                    title={hasUnread ? 'New activity' : undefined}
                  />
                );
              })()}
              <div className="project-meta">
                {renamingId === p.id ? (
                  <input
                    className="project-rename"
                    value={renameValue}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <div
                    className="project-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(p.id, p.name);
                    }}
                  >
                    {p.name}
                  </div>
                )}
                <div className="project-path">
                  {(() => {
                    const g = gitStatus[p.id];
                    if (!g) return p.path;
                    return (
                      <span className="project-git">
                        <span className="project-git-branch">
                          {g.detached ? '(detached)' : g.branch ?? '?'}
                        </span>
                        {g.dirty && <span className="project-git-dirty" title="Uncommitted changes">●</span>}
                        {g.ahead > 0 && <span className="project-git-ahead" title="Ahead">↑{g.ahead}</span>}
                        {g.behind > 0 && <span className="project-git-behind" title="Behind">↓{g.behind}</span>}
                      </span>
                    );
                  })()}
                </div>
                {p.tag && (
                  <div className="project-tag" title={`Tag: ${p.tag}`}>
                    #{p.tag}
                  </div>
                )}
                {p.remote && (
                  <div
                    className="project-remote-chip"
                    title={`Remote SSH: ${p.remote.user ? `${p.remote.user}@` : ''}${p.remote.host}`}
                  >
                    <Network size={10} strokeWidth={2} />
                    <span>{p.remote.host}</span>
                  </div>
                )}
              </div>
              {/* Live agent rollup: the most-urgent state across the project's
               *  sessions (blocked → working → done → idle). Sits before the
               *  run-count badge so "needs you" reads at a glance. */}
              <ProjectRollupDot projectId={p.id} />
              {(() => {
                const list = visibleTerminals(terminals[p.id]);
                const background = backgroundTerminals(terminals[p.id]);
                const running = list.filter((t) => t.status !== 'exited').length;
                const exited = list.filter((t) => t.status === 'exited').length;
                const crashed = list.filter(
                  (t) => t.status === 'exited' && (t.exitCode ?? 0) !== 0
                ).length;
                if (list.length === 0 && background.length === 0) return null;
                const expanded = !!projectExpanded[p.id];
                const titleParts = [`${running} running`, `${exited} exited`];
                if (background.length > 0) titleParts.push(`${background.length} background`);
                if (crashed > 0) titleParts.push(`${crashed} crashed`);
                return (
                  <button
                    type="button"
                    className={`project-badge ${expanded ? 'expanded' : ''} ${
                      crashed > 0 ? 'has-crashed' : ''
                    }`}
                    title={`${titleParts.join(', ')} — click to ${expanded ? 'collapse' : 'expand'}`}
                    aria-expanded={expanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProjectExpanded(p.id);
                    }}
                  >
                    {running}
                    {exited > 0 && <span className="project-badge-exited">·{exited}</span>}
                    {background.length > 0 && (
                      <span
                        className="project-badge-bg"
                        title={`${background.length} running in the background`}
                      >
                        <EyeOff size={9} strokeWidth={2.5} />
                        {background.length}
                      </span>
                    )}
                    {crashed > 0 && (
                      <span className="project-badge-crashed" aria-hidden="true" />
                    )}
                  </button>
                );
              })()}
            </div>
            {(() => {
              const list = visibleTerminals(terminals[p.id]);
              if (!projectExpanded[p.id] || list.length === 0) return null;
              const activeTab = selectedId === p.id ? selectedTabId[p.id] : undefined;
              return (
                <div className="project-terminals" role="list">
                  {list.map((t) => {
                    const exited = t.status === 'exited';
                    const bad = exited && (t.exitCode ?? 0) !== 0;
                    return (
                    <div
                      key={t.id}
                      role="listitem"
                      className={`project-terminal-row ${activeTab === t.id ? 'active' : ''} ${
                        exited ? 'exited' : ''
                      } ${bad ? 'exited-bad' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectProject(p.id);
                        selectTab(p.id, t.id);
                      }}
                      title={
                        exited && t.exitCode != null
                          ? `${t.title} · exited (code ${t.exitCode})`
                          : t.title
                      }
                    >
                      <span
                        className={`tab-profile-icon profile-${t.profile}`}
                        aria-hidden="true"
                      >
                        {profileIcon(t.profile)}
                      </span>
                      <span className="project-terminal-name">{t.title}</span>
                      <AgentStatusDot sessionId={t.id} />
                      {bad && (
                        <span className="project-terminal-exit-bad" aria-label={`Exit code ${t.exitCode}`}>
                          ✗{t.exitCode}
                        </span>
                      )}
                      {unread[t.id] && activeTab !== t.id && (
                        <span className="project-terminal-unread" aria-label="Unread output" />
                      )}
                      <button
                        type="button"
                        className="project-terminal-close"
                        aria-label={exited ? `Dismiss ${t.title}` : `Delete ${t.title}`}
                        title={exited ? 'Dismiss' : 'Delete (ends the process)'}
                        onClick={(e) => {
                          e.stopPropagation();
                          // This is the explicit DELETE path (unlike the tab
                          // strip's X, which now hides). Confirm before killing
                          // a live process so a stray click can't terminate a
                          // running agent; exited tabs dismiss without a prompt.
                          if (
                            !exited &&
                            !window.confirm(
                              `Delete “${t.title}”? The process will be terminated.`
                            )
                          ) {
                            return;
                          }
                          closeTerminal(t.id, p.id);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    );
                  })}
                </div>
              );
            })()}
            </div>
          ))
        )}
      </div>
      {menu && (() => {
        const p = projects.find((pr) => pr.id === menu.projectId);
        return (
        <div
          ref={menuRef}
          className="project-menu"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {p && (
            <>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('cursor', p.path); }}
              >
                <CursorIcon size={12} />
                <span>Open in Cursor</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('code', p.path); }}
              >
                <Code2 size={12} />
                <span>Open in VS Code</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('finder', p.path); }}
              >
                <FolderOpen size={12} />
                <span>Reveal in Finder</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => { setMenu(null); openIn('terminal', p.path); }}
              >
                <TerminalSquare size={12} />
                <span>Open in external Terminal</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  void navigator.clipboard.writeText(p.path).then(
                    () => pushToast('Path copied', 'info'),
                    () => pushToast('Failed to copy path', 'error')
                  );
                }}
              >
                <ClipboardCopy size={12} />
                <span>Copy path</span>
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenu(null);
                  selectProject(p.id);
                  setSettingsTab('project');
                  setNav('settings');
                }}
              >
                <Settings2 size={12} />
                <span>Project settings…</span>
              </button>
              <button
                className="project-menu-item"
                onClick={() => startRename(p.id, p.name)}
              >
                <Pencil size={12} />
                <span>Rename</span>
              </button>
              {(() => {
                const armed = confirmDeleteId === p.id;
                const running = visibleTerminals(terminals[p.id]).filter((t) => t.status !== 'exited').length;
                return (
                  <button
                    className={`project-menu-item danger ${armed ? 'project-delete-armed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armed) {
                        setConfirmDeleteId(null);
                        setMenu(null);
                        removeProject(p.id);
                      } else {
                        setConfirmDeleteId(p.id);
                      }
                    }}
                  >
                    {armed ? <Check size={12} /> : <Trash2 size={12} />}
                    <span>
                      {armed
                        ? running > 0
                          ? `Click to confirm (${running} running)`
                          : 'Click to confirm'
                        : 'Remove project'}
                    </span>
                  </button>
                );
              })()}
            </>
          )}
          <div className="project-menu-label">Color</div>
          <div className="project-menu-swatches">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                className="project-swatch"
                style={{ background: c }}
                aria-label={`Set color ${c}`}
                onClick={() => {
                  updateProject(menu.projectId, { color: c });
                  setMenu(null);
                }}
              />
            ))}
            <button
              className="project-swatch reset"
              aria-label="Reset color"
              onClick={() => {
                updateProject(menu.projectId, { color: undefined });
                setMenu(null);
              }}
            >
              ×
            </button>
          </div>
        </div>
        );
      })()}
      <div
        className="list-pane-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={LIST_PANE_MIN}
        aria-valuemax={LIST_PANE_MAX}
        title="Drag to resize · double-click to reset"
        onMouseDown={onResizeMouseDown}
        onDoubleClick={onResizeDoubleClick}
      />
      {showRemoteDialog && (
        <AddRemoteProjectDialog
          onClose={() => setShowRemoteDialog(false)}
          onSubmit={async (input) => {
            const p = await addRemoteProject(input);
            setShowRemoteDialog(false);
            if (p) selectProject(p.id);
          }}
        />
      )}
    </section>
  );
}

function SchedulerPane() {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const schedulerTab = useUi((s) => s.schedulerTab);
  const setSchedulerTab = useUi((s) => s.setSchedulerTab);
  const selectedGroupId = useUi((s) => s.selectedGroupId);
  const selectGroup = useUi((s) => s.selectGroup);
  const groups = useScheduleGroups((s) => s.groups);
  const tasks = useScheduler((s) => s.tasks);
  const collapsedSections = useUi((s) => s.collapsedSections);
  const sortedProjects = sortProjectsForDisplay(projects);
  const [filter, setFilter] = useState('');
  const [managingGroups, setManagingGroups] = useState(false);
  const q = filter.trim().toLowerCase();
  const visibleProjects = q
    ? sortedProjects.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      )
    : sortedProjects;

  // Per-group + ungrouped counts of global schedules, for the rail badges.
  const globalTasks = tasks.filter((t) => !t.source || t.source === 'global');
  const knownGroupIds = new Set(groups.map((g) => g.id));
  const countForGroup = (gid: string) => globalTasks.filter((t) => t.group === gid).length;
  const ungroupedCount = globalTasks.filter(
    (t) => !t.group || !knownGroupIds.has(t.group)
  ).length;

  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>Scheduler</h2>
      </header>
      {projects.length > 4 && (
        <div className="list-filter">
          <Search size={12} className="list-filter-icon" />
          <input
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="list-filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="list-body">
        <div className="settings-scope-label">Summary</div>
        <div
          className={`project-item ${schedulerTab === 'overview' ? 'active' : ''}`}
          onClick={() => setSchedulerTab('overview')}
        >
          <LayoutDashboard size={14} className="settings-scope-icon" />
          <div className="project-meta">
            <div className="project-name">Overview</div>
            <div className="project-path">All schedules at a glance</div>
          </div>
        </div>

        <SectionHeader
          label="Groups"
          sectionKey="scheduler:groups"
          action={
            <button
              className="list-section-action"
              onClick={() => setManagingGroups(true)}
              title="Manage groups"
              aria-label="Manage groups"
            >
              <Settings size={12} />
            </button>
          }
        />
        {!collapsedSections['scheduler:groups'] && (
          <>
            {groups.map((g) => {
              const active = schedulerTab === 'group' && selectedGroupId === g.id;
              const Icon = groupIcon(g.icon);
              const count = countForGroup(g.id);
              return (
                <div
                  key={g.id}
                  className={`project-item ${active ? 'active' : ''}`}
                  onClick={() => selectGroup(g.id)}
                  title={g.name}
                >
                  <Icon
                    size={14}
                    className="settings-scope-icon"
                    style={{ color: g.color ?? GROUP_FALLBACK_COLOR }}
                  />
                  <div className="project-meta">
                    <div className="project-name">{g.name}</div>
                  </div>
                  {count > 0 && <span className="list-count-badge">{count}</span>}
                </div>
              );
            })}
            <div
              className={`project-item ${schedulerTab === 'global' ? 'active' : ''}`}
              onClick={() => setSchedulerTab('global')}
              title="Global schedules with no group"
            >
              <Layers size={14} className="settings-scope-icon" />
              <div className="project-meta">
                <div className="project-name">Ungrouped</div>
                <div className="project-path">App-wide, no group</div>
              </div>
              {ungroupedCount > 0 && <span className="list-count-badge">{ungroupedCount}</span>}
            </div>
          </>
        )}

        <SectionHeader label="Project" sectionKey="scheduler:project" />
        {collapsedSections['scheduler:project'] ? null : sortedProjects.length === 0 ? (
          <div className="list-empty">No projects yet.</div>
        ) : visibleProjects.length === 0 ? (
          <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
        ) : (
          visibleProjects.map((p) => {
            const active = schedulerTab === 'project' && selectedProjectId === p.id;
            return (
              <div
                key={p.id}
                className={`project-item ${active ? 'active' : ''}`}
                onClick={() => {
                  selectProject(p.id);
                  setSchedulerTab('project');
                }}
                title={p.path}
              >
                <span
                  className="project-dot"
                  style={p.color ? { background: p.color } : undefined}
                />
                <div className="project-meta">
                  <div className="project-name">{p.name}</div>
                  <div className="project-path">{p.path}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {managingGroups && <ScheduleGroupsModal onClose={() => setManagingGroups(false)} />}
    </section>
  );
}

/**
 * Sidebar rail for the Skills / MCP / Plugins catalogue panels. Looks like the
 * Scheduler rail (a Scope summary row + a collapsible Project list) but without
 * the schedule Groups — these panels only distinguish "global sources" from a
 * single project's `.claude/` scope, which the panels read off `selectedProjectId`.
 *
 * Plugins have no per-project scope (they live under ~/.claude), so for that nav
 * we show only the global row and skip the project list entirely.
 */
function CataloguePane({ nav }: { nav: 'skills' | 'mcp' | 'plugins' }) {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const projectCollapsed = useUi((s) => !!s.collapsedSections['catalogue:project']);
  const sortedProjects = sortProjectsForDisplay(projects);
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const visibleProjects = q
    ? sortedProjects.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      )
    : sortedProjects;

  const title = nav === 'skills' ? 'Skills' : nav === 'mcp' ? 'MCP' : 'Plugins';
  const supportsProjectScope = nav !== 'plugins';
  const globalActive = selectedProjectId === null;

  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>{title}</h2>
      </header>
      {supportsProjectScope && projects.length > 4 && (
        <div className="list-filter">
          <Search size={12} className="list-filter-icon" />
          <input
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="list-filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="list-body">
        <div className="settings-scope-label">Scope</div>
        <div
          className={`project-item ${globalActive ? 'active' : ''}`}
          onClick={() => selectProject(null)}
          title="User and plugin sources (no project)"
        >
          <Layers size={14} className="settings-scope-icon" />
          <div className="project-meta">
            <div className="project-name">Global</div>
            <div className="project-path">User &amp; plugin sources</div>
          </div>
        </div>

        {supportsProjectScope ? (
          <>
            <SectionHeader label="Project" sectionKey="catalogue:project" />
            {projectCollapsed ? null : sortedProjects.length === 0 ? (
              <div className="list-empty">No projects yet.</div>
            ) : visibleProjects.length === 0 ? (
              <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
            ) : (
              visibleProjects.map((p) => {
                const active = selectedProjectId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`project-item ${active ? 'active' : ''}`}
                    onClick={() => selectProject(p.id)}
                    title={p.path}
                  >
                    <span
                      className="project-dot"
                      style={p.color ? { background: p.color } : undefined}
                    />
                    <div className="project-meta">
                      <div className="project-name">{p.name}</div>
                      <div className="project-path">{p.path}</div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <p className="list-scope-note">
            Plugins live under <code>~/.claude</code> and aren&rsquo;t scoped to a
            project.
          </p>
        )}
      </div>
    </section>
  );
}

function SettingsPane() {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const settingsTab = useUi((s) => s.settingsTab);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const projectCollapsed = useUi((s) => !!s.collapsedSections['settings:project']);
  const sortedProjects = sortProjectsForDisplay(projects);
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const visibleProjects = q
    ? sortedProjects.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      )
    : sortedProjects;

  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>Settings</h2>
      </header>
      {projects.length > 4 && (
        <div className="list-filter">
          <Search size={12} className="list-filter-icon" />
          <input
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="list-filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="list-body">
        <div className="settings-scope-label">Scope</div>
        <div
          className={`project-item ${settingsTab === 'global' ? 'active' : ''}`}
          onClick={() => setSettingsTab('global')}
        >
          <Settings2 size={14} className="settings-scope-icon" />
          <div className="project-meta">
            <div className="project-name">Global</div>
            <div className="project-path">App-wide defaults</div>
          </div>
        </div>
        <SectionHeader label="Project" sectionKey="settings:project" />
        {projectCollapsed ? null : sortedProjects.length === 0 ? (
          <div className="list-empty">No projects yet.</div>
        ) : visibleProjects.length === 0 ? (
          <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
        ) : (
          visibleProjects.map((p) => {
            const active = settingsTab === 'project' && selectedProjectId === p.id;
            return (
              <div
                key={p.id}
                className={`project-item ${active ? 'active' : ''}`}
                onClick={() => {
                  selectProject(p.id);
                  setSettingsTab('project');
                }}
                title={p.path}
              >
                <span
                  className="project-dot"
                  style={p.color ? { background: p.color } : undefined}
                />
                <div className="project-meta">
                  <div className="project-name">{p.name}</div>
                  <div className="project-path">{p.path}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
