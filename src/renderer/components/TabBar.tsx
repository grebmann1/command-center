import { useEffect, useRef, useState } from 'react';
import { Plus, X, Pin, Trash2, ChevronLeft, Moon } from 'lucide-react';
import type { LaunchProfileId, TerminalSession } from '@shared/types';
import { useUi, useAgentStatus } from '../store';
import { getTerminal } from '../util/findRegistry';
import { profileIcon } from '../util/profileIcon';
import type { AgentState } from '@shared/types';

/** Human label for the status dot's tooltip + aria. */
const AGENT_STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Blocked — needs you',
  working: 'Working',
  done: 'Done — unseen',
  idle: 'Idle',
  unknown: ''
};

/**
 * Live agent-state dot for a tab. Subscribes by id to a PRIMITIVE (the state
 * string), so one session's transition repaints only its own dot — never the
 * tab strip (BC 8). Renders nothing for `unknown` (plain shells, no signal yet)
 * so non-agent tabs stay clean.
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

/** Persisted, app-global preference for whether the in-strip background tray is
 *  expanded. A plain UI pref (not per-project), so it lives in localStorage
 *  rather than IPC config — same pattern as cc.sidebarCollapsed. */
const BG_EXPANDED_KEY = 'cc.bgTrayExpanded';
function readBgExpanded(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(BG_EXPANDED_KEY) === '1';
}

interface Props {
  tabs: TerminalSession[];
  activeTabId: string | undefined;
  onSelect: (id: string) => void;
  /**
   * Terminate a session: kills the pty and removes the tab. A restorable
   * snapshot is kept so ⌘⇧T can reopen. Only the context-menu "Delete" item
   * routes here for live sessions (with a confirm); exited tombstones also
   * route here from the X button / middle-click to dismiss without friction.
   */
  onClose: (id: string) => void;
  /**
   * Send a session to the background without killing it (detach). The pty
   * keeps running headless and is surfaced by the Background (N) list, from
   * which it can be resumed (re-attaching the same live pty). This is what the
   * X button, middle-click, ⌘W, and the context-menu "Hide" items do for live
   * sessions — closing is non-destructive; only "Delete" terminates.
   */
  onDetach?: (id: string) => void;
  /**
   * Detached (background) sessions for this project — shown in the new-tab
   * popover's "Background" section so the user can resume or kill one.
   */
  backgroundTabs?: TerminalSession[];
  /** Resume a background session back into the tab strip (same live pty). */
  onResumeBackground?: (id: string) => void;
  /** Kill a background session outright from the Background list. */
  onKillBackground?: (id: string) => void;
  onNew: (profile: LaunchProfileId) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onRename?: (id: string, title: string) => void;
  onDuplicate?: (id: string) => void;
  onRestart?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  /**
   * If set, a plain click on the "+" button spawns this profile directly
   * (one-click semantics). Cmd/Ctrl/Alt-click or right-click still opens
   * the picker menu so users can override per-spawn.
   */
  defaultProfile?: LaunchProfileId;
  /** Tab ids currently mounted in non-primary split panes. */
  splitTabIds?: ReadonlyArray<string | undefined>;
  /** Whether a split layout is active (any layout != single). */
  splitActive?: boolean;
  onOpenInSplit?: (id: string) => void;
  onRemoveFromSplit?: (id: string) => void;
  onCloseSplit?: () => void;
}

interface TabContextMenu {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onDetach, backgroundTabs, onResumeBackground, onKillBackground, onNew, onReorder, onRename, onDuplicate, onRestart, onPin, defaultProfile, splitTabIds, splitActive, onOpenInSplit, onRemoveFromSplit, onCloseSplit }: Props) {
  const splitSet = new Set((splitTabIds ?? []).filter((x): x is string => !!x));
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tabMenu, setTabMenu] = useState<TabContextMenu | null>(null);
  // Whether the in-strip background tray is expanded (persisted, app-global).
  const [bgExpanded, setBgExpanded] = useState(readBgExpanded);
  const anchor = useRef<HTMLButtonElement>(null);
  const unread = useUi((s) => s.unread);

  const bg = backgroundTabs ?? [];
  const hasBg = bg.length > 0;
  const toggleBgTray = () => {
    setBgExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(BG_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  const startRename = (t: TerminalSession) => {
    if (!onRename) return;
    setRenamingId(t.id);
    setRenameValue(t.title);
  };

  const commitRename = () => {
    if (renamingId && onRename) {
      const v = renameValue.trim();
      if (v) onRename(renamingId, v);
    }
    setRenamingId(null);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [tabMenu]);

  // Close one tab = HIDE it, not destroy it. A live session detaches to the
  // background (its pty keeps running, resumable from the Background list); an
  // exited tab has no process left, so it's just dismissed. The process is
  // only ever terminated via the context-menu "Delete" or the project-list
  // row's X — see `deleteOne`. No confirm here: hiding is non-destructive.
  const closeOne = (t: TerminalSession) => {
    if (t.status === 'exited' || !onDetach) {
      onClose(t.id); // dead tombstone (or no detach wired) — just remove it
      return;
    }
    onDetach(t.id); // live — send to background, keep the process alive
  };

  // Destroy one tab: terminate the process and remove the tab. Live sessions
  // get a confirm so a stray Delete can't silently kill a running agent;
  // exited tabs are already dead, so they drop without friction. ⌘⇧T reopens.
  const deleteOne = (t: TerminalSession) => {
    if (
      t.status === 'exited' ||
      window.confirm(`Delete “${t.title}”? The process will be terminated.`)
    ) {
      onClose(t.id);
    }
  };

  // Bulk close = bulk hide: detach every live, non-pinned target to the
  // background and dismiss any exited tombstones. Non-destructive, so no
  // confirm — matches the single-tab close gesture.
  const bulkClose = (targets: TerminalSession[]) => {
    for (const t of targets) {
      if (t.pinned) continue;
      if (t.status === 'exited' || !onDetach) onClose(t.id);
      else onDetach(t.id);
    }
  };

  const closeOthers = (id: string) => bulkClose(tabs.filter((t) => t.id !== id));
  const closeToRight = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    bulkClose(tabs.slice(idx + 1));
  };
  // Exited tabs have no live process — drop them all with no prompt.
  const dismissExited = () => {
    for (const t of tabs) if (t.status === 'exited' && !t.pinned) onClose(t.id);
  };

  // The chip toggles the strip between two views: live tabs (default) and the
  // background sessions. We never show both at once — easier to scan and to
  // maintain. If the tray is "open" but there's nothing in the background, fall
  // back to the live view so the strip is never empty-by-accident.
  const showBackground = bgExpanded && hasBg;

  return (
    <div className="tabbar" role="tablist">
      {!showBackground && tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${activeTabId === t.id ? 'active' : ''} ${
            draggingId === t.id ? 'dragging' : ''
          } ${dragOverId === t.id && draggingId && draggingId !== t.id ? 'drag-over' : ''} ${
            t.pinned ? 'pinned' : ''
          } ${splitSet.has(t.id) ? 'split' : ''} ${t.status === 'exited' ? 'exited' : ''} ${
            t.status === 'exited' && (t.exitCode ?? 0) !== 0 ? 'exited-bad' : ''
          }`}
          role="tab"
          aria-selected={activeTabId === t.id}
          title={
            t.status === 'exited'
              ? `${t.title} · exited${t.exitCode != null ? ` (code ${t.exitCode})` : ''}`
              : undefined
          }
          onClick={() => onSelect(t.id)}
          onAuxClick={(e) => {
            // Middle-click closes the tab (skipping pinned ones).
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            if (!t.pinned) closeOne(t);
          }}
          onMouseDown={(e) => {
            // Suppress browser-default autoscroll on middle-click.
            if (e.button === 1) e.preventDefault();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTabMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
          }}
          draggable={!!onReorder}
          onDragStart={(e) => {
            setDraggingId(t.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
          }}
          onDragEnter={(e) => {
            if (!draggingId || draggingId === t.id) return;
            e.preventDefault();
            setDragOverId(t.id);
          }}
          onDragOver={(e) => {
            if (!draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = draggingId;
            setDraggingId(null);
            setDragOverId(null);
            if (from && from !== t.id) onReorder?.(from, t.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDragOverId(null);
          }}
        >
          {unread[t.id] && activeTabId !== t.id && <span className="tab-unread" />}
          <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
            {profileIcon(t.profile)}
          </span>
          <AgentStatusDot sessionId={t.id} />
          {renamingId === t.id ? (
            <input
              className="tab-rename"
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
            <span className="tab-title" onDoubleClick={() => startRename(t)}>
              {t.title}
              {t.status === 'exited' && (
                <span className="tab-exit-marker">
                  {(t.exitCode ?? 0) !== 0 ? ` ✗${t.exitCode}` : ' ·exited'}
                </span>
              )}
            </span>
          )}
          {t.pinned ? (
            <span className="tab-pin-marker" title="Pinned" aria-label="Pinned">
              <Pin size={11} />
            </span>
          ) : (
            <button
              type="button"
              className="tab-close"
              aria-label={t.status === 'exited' ? `Dismiss ${t.title}` : `Hide ${t.title}`}
              title={
                t.status === 'exited'
                  ? 'Dismiss tab'
                  : 'Hide tab — keeps the process running in the background. Right-click → Delete to end it.'
              }
              onClick={(e) => {
                e.stopPropagation();
                // Drop focus before triggering close so the button doesn't
                // stay :focus-visible when the next tab takes its place
                // under the cursor.
                e.currentTarget.blur();
                closeOne(t);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {hasBg && (
        <>
          <button
            type="button"
            className={`tab-bg-chip ${showBackground ? 'is-open' : ''}`}
            aria-pressed={showBackground}
            title={
              showBackground
                ? 'Showing background sessions — click to return to live tabs'
                : `${bg.length} session${bg.length > 1 ? 's' : ''} running in the background — click to view`
            }
            onClick={(e) => {
              e.stopPropagation();
              toggleBgTray();
            }}
          >
            {showBackground ? (
              <>
                <ChevronLeft size={12} aria-hidden />
                <span className="tab-bg-chip-label">live tabs</span>
              </>
            ) : (
              <>
                <Moon size={11} aria-hidden />
                <span className="tab-bg-chip-count">{bg.length}</span>
                <span className="tab-bg-chip-label">background</span>
              </>
            )}
          </button>
          {showBackground &&
            bg.map((t) => (
              <div
                key={t.id}
                className="tab tab-ghost"
                role="tab"
                aria-selected={false}
                title={`${t.title} · ${t.profile} — running in the background. Click to open it.`}
                onClick={() => onResumeBackground?.(t.id)}
              >
                <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
                  {profileIcon(t.profile)}
                </span>
                <span className="tab-title">{t.title}</span>
                {onKillBackground && (
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`Close ${t.title}`}
                    title="Terminate this background session"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.currentTarget.blur();
                      onKillBackground(t.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
        </>
      )}
      <button
        ref={anchor}
        className="tab-add"
        aria-label="New tab"
        title={defaultProfile ? `New ${defaultProfile} tab (hold ⌥/⌘ or right-click for picker)` : 'New tab'}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        onClick={(e) => {
          e.stopPropagation();
          // One-click default: if the project has a configured default agent
          // and the user clicked plainly (no modifier), spawn that profile
          // directly. Modifier-click or right-click falls through to the
          // picker so users can still pick a different profile.
          if (defaultProfile && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            onNew(defaultProfile);
            return;
          }
          setMenuOpen((v) => !v);
        }}
      >
        <Plus size={14} />
      </button>
      {tabMenu && (() => {
        const t = tabs.find((tt) => tt.id === tabMenu.tabId);
        if (!t) return null;
        const idx = tabs.findIndex((tt) => tt.id === t.id);
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const hasOthers = tabs.length > 1;
        const hasExited = tabs.some((tt) => tt.status === 'exited');
        return (
          <div
            className="tab-context-menu"
            style={{ top: tabMenu.y, left: tabMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setTabMenu(null);
                onSelect(t.id);
                startRename(t);
              }}
              disabled={!onRename}
            >
              Rename…
            </button>
            {onDuplicate && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onDuplicate(t.id);
                }}
              >
                Duplicate
              </button>
            )}
            {onRestart && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onRestart(t.id);
                }}
                title={
                  t.status === 'exited'
                    ? 'Restart this session'
                    : 'Kill and restart this session with the same profile and args'
                }
              >
                {t.status === 'exited' ? 'Restart' : 'Restart…'}
              </button>
            )}
            {onPin && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onPin(t.id, !t.pinned);
                }}
              >
                {t.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}
            <button
              onClick={() => {
                setTabMenu(null);
                getTerminal(t.id)?.clear();
              }}
            >
              Clear scrollback
            </button>
            {onOpenInSplit && !splitSet.has(t.id) && t.id !== activeTabId && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onOpenInSplit(t.id);
                }}
                title="Open this tab in the next free split pane"
              >
                Open in split
              </button>
            )}
            {onRemoveFromSplit && splitSet.has(t.id) && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onRemoveFromSplit(t.id);
                }}
              >
                Remove from split
              </button>
            )}
            {onCloseSplit && splitActive && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onCloseSplit();
                }}
              >
                Close split (single pane)
              </button>
            )}
            <div className="tab-context-sep" />
            <button
              onClick={() => { setTabMenu(null); closeOne(t); }}
              disabled={!!t.pinned}
              title="Hide this tab. The process keeps running in the background; resume it from the + menu or with ⌘⇧T."
            >
              {t.status === 'exited' ? 'Dismiss' : 'Hide'}
            </button>
            <button
              onClick={() => { setTabMenu(null); closeOthers(t.id); }}
              disabled={!hasOthers}
              title="Hide all other tabs (their processes keep running in the background)."
            >
              Hide others
            </button>
            <button
              onClick={() => { setTabMenu(null); closeToRight(t.id); }}
              disabled={!hasRight}
              title="Hide tabs to the right (their processes keep running in the background)."
            >
              Hide to the right
            </button>
            <div className="tab-context-sep" />
            <button
              className="tab-context-danger"
              onClick={() => { setTabMenu(null); deleteOne(t); }}
              disabled={!!t.pinned}
              title="Terminate this session and remove the tab. Reopen with ⌘⇧T."
            >
              {t.status === 'exited' ? 'Dismiss' : 'Delete'}
            </button>
            <button
              onClick={() => { setTabMenu(null); dismissExited(); }}
              disabled={!hasExited}
              title="Dismiss every exited tab (their processes are already gone)."
            >
              Dismiss exited
            </button>
          </div>
        );
      })()}
      {menuOpen && (
        <div
          className="tab-menu"
          style={{ top: 'var(--tab-h)', left: 'calc(var(--col-nav) + var(--col-list) + 6px)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              onNew('claude');
            }}
          >
            claude
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              onNew('claude-resume');
            }}
          >
            claude --resume
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              onNew('claude-yolo');
            }}
            title="claude --dangerously-skip-permissions"
          >
            claude --yolo
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              onNew('shell');
            }}
          >
            shell
          </button>
          {backgroundTabs && backgroundTabs.length > 0 && onResumeBackground && (
            <>
              <div className="tab-context-sep" />
              <div className="tab-menu-section-label">
                Background ({backgroundTabs.length}) · running
              </div>
              {backgroundTabs.map((t) => (
                <div key={t.id} className="tab-menu-bg-row">
                  <button
                    className="tab-menu-hidden"
                    title={`Resume ${t.title} · ${t.profile}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onResumeBackground(t.id);
                    }}
                  >
                    <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden>
                      {profileIcon(t.profile)}
                    </span>
                    <span className="tab-menu-hidden-title">{t.title}</span>
                  </button>
                  {onKillBackground && (
                    <button
                      className="tab-menu-bg-kill"
                      aria-label={`Close ${t.title}`}
                      title="Terminate this background session"
                      onClick={(e) => {
                        e.stopPropagation();
                        onKillBackground(t.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
