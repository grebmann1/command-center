import { useEffect, useRef, useState } from 'react';
import { Plus, X, Pin } from 'lucide-react';
import type { LaunchProfileId, TerminalSession } from '@shared/types';
import { useUi } from '../store';
import { getTerminal } from '../util/findRegistry';
import { profileIcon } from '../util/profileIcon';

interface Props {
  tabs: TerminalSession[];
  activeTabId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
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

export function TabBar({ tabs, activeTabId, onSelect, onClose, onNew, onReorder, onRename, onDuplicate, onRestart, onPin, defaultProfile, splitTabIds, splitActive, onOpenInSplit, onRemoveFromSplit, onCloseSplit }: Props) {
  const splitSet = new Set((splitTabIds ?? []).filter((x): x is string => !!x));
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tabMenu, setTabMenu] = useState<TabContextMenu | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const unread = useUi((s) => s.unread);

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

  const closeOthers = (id: string) => {
    for (const t of tabs) if (t.id !== id && !t.pinned) onClose(t.id);
  };
  const closeToRight = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    for (const t of tabs.slice(idx + 1)) if (!t.pinned) onClose(t.id);
  };
  const closeExited = () => {
    for (const t of tabs) if (t.status === 'exited' && !t.pinned) onClose(t.id);
  };

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => (
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
            if (!t.pinned) onClose(t.id);
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
              className="tab-close"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
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
              onClick={() => { setTabMenu(null); onClose(t.id); }}
              disabled={!!t.pinned}
            >
              Close
            </button>
            <button
              onClick={() => { setTabMenu(null); closeOthers(t.id); }}
              disabled={!hasOthers}
            >
              Close others
            </button>
            <button
              onClick={() => { setTabMenu(null); closeToRight(t.id); }}
              disabled={!hasRight}
            >
              Close to the right
            </button>
            <button
              onClick={() => { setTabMenu(null); closeExited(); }}
              disabled={!hasExited}
            >
              Close exited
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
        </div>
      )}
    </div>
  );
}
