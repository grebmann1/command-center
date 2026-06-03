import { useEffect, useState } from 'react';
import { Plus, Search, Trash2, X, Check, Pencil, MousePointer, Code2, FolderOpen, TerminalSquare } from 'lucide-react';
import {
  useData,
  useUi,
  sortProjectsForDisplay,
  applyListPaneWidth,
  LIST_PANE_MIN,
  LIST_PANE_MAX
} from '../store';
import type { OpenTarget } from '@shared/types';

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

export function ListPane() {
  const nav = useUi((s) => s.nav);

  if (nav === 'settings') return <SettingsPane />;
  return <ProjectsList />;
}

function ProjectsList() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const addProject = useData((s) => s.addProject);
  const addProjectByPath = useData((s) => s.addProjectByPath);
  const removeProject = useData((s) => s.removeProject);
  const updateProject = useData((s) => s.updateProject);
  const reorderProjects = useData((s) => s.reorderProjects);
  const selectedId = useUi((s) => s.selectedProjectId);
  const selectProject = useUi((s) => s.selectProject);
  const pushToast = useUi((s) => s.pushToast);
  const unread = useUi((s) => s.unread);
  const gitStatus = useData((s) => s.gitStatus);

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
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const visibleProjects = (() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter(
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

  return (
    <section
      className={`list-pane ${dropOver ? 'drop-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="list-header">
        <h2>Projects</h2>
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
        {projects.length === 0 ? (
          <div className="list-empty">
            No projects yet.
            <br />
            Click <strong>+</strong> or drop a folder here.
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="list-empty">No projects match &ldquo;{filter}&rdquo;.</div>
        ) : (
          visibleProjects.map((p) => (
            <div
              key={p.id}
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
                const list = terminals[p.id] || [];
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
              </div>
              {(() => {
                const list = terminals[p.id] || [];
                const running = list.filter((t) => t.status !== 'exited').length;
                const exited = list.filter((t) => t.status === 'exited').length;
                if (list.length === 0) return null;
                return (
                  <span className="project-badge" title={`${running} running, ${exited} exited`}>
                    {running}
                    {exited > 0 && <span className="project-badge-exited">·{exited}</span>}
                  </span>
                );
              })()}
              {(() => {
                const armed = confirmDeleteId === p.id;
                const list = terminals[p.id] || [];
                const running = list.filter((t) => t.status !== 'exited').length;
                const title = armed
                  ? running > 0
                    ? `Click to remove ${p.name} (${running} running)`
                    : `Click to remove ${p.name}`
                  : `Remove ${p.name}`;
                return (
                  <button
                    className={`icon-btn danger ${armed ? 'project-delete-armed' : ''}`}
                    aria-label={title}
                    title={title}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armed) {
                        setConfirmDeleteId(null);
                        removeProject(p.id);
                      } else {
                        setConfirmDeleteId(p.id);
                      }
                    }}
                  >
                    {armed ? <Check size={14} /> : <Trash2 size={14} />}
                  </button>
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
                <MousePointer size={12} />
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
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => startRename(p.id, p.name)}
              >
                <Pencil size={12} />
                <span>Rename</span>
              </button>
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
    </section>
  );
}

function SettingsPane() {
  return (
    <section className="list-pane">
      <header className="list-header">
        <h2>Settings</h2>
      </header>
      <div className="list-body">
        <div className="list-empty">
          Configure shell, Claude binary, and appearance in the main pane.
        </div>
      </div>
    </section>
  );
}
