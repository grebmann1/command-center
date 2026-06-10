/**
 * GUS module — renderer panel. A kanban board of the current user's GUS
 * work items, grouped into columns that mirror the team's GUS board (each
 * column = one exact `Status__c`). Left rail holds search + a sprint picker
 * with a "Current sprint" quick-filter. Cards are drag/droppable between
 * columns to update their status in GUS (optimistic, with an undo toast).
 *
 * Decoupling: this component talks to the host only through the injected
 * `ModuleHost` (`host.call`, `host.storage`, `host.openExternal`, …). It
 * imports no core stores or IPC. Styling uses the shared `gus-*` classes in
 * global.css plus the app's existing design tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Search,
  Bug,
  BookOpen,
  CircleDot,
  Layers,
  CalendarClock,
  Users,
  UserCheck,
  X
} from 'lucide-react';
import type { ModuleHost } from '../../../src/shared/module-api';
import { GusDetailModal } from './GusDetailModal';
import {
  BOARD_COLUMNS,
  BACKLOG_COLUMNS,
  OTHER_COLUMN,
  OTHER_COLUMN_KEY,
  columnKeyForStatus,
  backlogColumnKeyForPriority,
  type BoardColumn,
  type GusIdentity,
  type GusSprint,
  type GusTeam,
  type GusWorkItem
} from '../shared/types';

const STORAGE_SPRINT_KEY = 'selectedSprintId';
const STORAGE_MODE_KEY = 'boardMode';
const STORAGE_TEAM_KEY = 'selectedTeamId';

/** Which board the panel shows: the user's own work, or a team's backlog. */
type BoardMode = 'work' | 'backlog';
/** How long the undo toast stays actionable before the write is committed. */
const UNDO_WINDOW_MS = 6000;

/** Sentinel sprint selections. Real sprint ids are Salesforce a0l… ids. */
type SprintSel = 'all' | 'current' | string;

/** Is `today` within the sprint's [start, end] (inclusive)? */
function isCurrentSprint(s: GusSprint, today: string): boolean {
  if (!s.startDate || !s.endDate) return false;
  return s.startDate <= today && today <= s.endDate;
}

export default function GusPanel({ host }: { host: ModuleHost }) {
  const [identity, setIdentity] = useState<GusIdentity | null>(null);
  const [items, setItems] = useState<GusWorkItem[]>([]);
  const [sprints, setSprints] = useState<GusSprint[]>([]);
  const [sprintSel, setSprintSel] = useState<SprintSel>('all');
  const [mode, setMode] = useState<BoardMode>('work');
  const [teams, setTeams] = useState<GusTeam[]>([]);
  const [teamSel, setTeamSel] = useState<string | null>(null);
  // Backlog-only: restrict to one record type (Bug / User Story / …). null = all.
  const [typeSel, setTypeSel] = useState<string | null>(null);
  // Backlog-only: show only items assigned to the current user.
  const [mineOnly, setMineOnly] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The card whose detail modal is open (null = closed).
  const [selected, setSelected] = useState<GusWorkItem | null>(null);
  // Column key currently being dragged over (for drop-target highlight).
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Id of the card being dragged (dimmed at its origin while in flight).
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Pending undo timers keyed by work id, so a re-drop cancels the prior one.
  const undoTimers = useRef<Map<string, number>>(new Map());
  // The scrolling board element + a rAF loop that scrolls it while the cursor
  // hovers near an edge during a drag (so you can reach far-off columns).
  const boardRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef<{ raf: number; dir: number; speed: number }>({
    raf: 0,
    dir: 0,
    speed: 0
  });

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current.raf) {
      cancelAnimationFrame(autoScroll.current.raf);
      autoScroll.current.raf = 0;
    }
    autoScroll.current.dir = 0;
  }, []);

  /**
   * On dragover within the board, scroll horizontally when the cursor is in
   * the outer ~80px edge zone. Speed ramps with proximity to the edge. A rAF
   * loop keeps scrolling even if the cursor holds still inside the zone.
   */
  const handleBoardDragOver = useCallback((e: React.DragEvent) => {
    const el = boardRef.current;
    if (!el || !e.dataTransfer.types.includes('text/gus-id')) return;
    const EDGE = 80;
    const MAX_SPEED = 22;
    const rect = el.getBoundingClientRect();
    const x = e.clientX;
    let dir = 0;
    let speed = 0;
    if (x < rect.left + EDGE) {
      dir = -1;
      speed = ((rect.left + EDGE - x) / EDGE) * MAX_SPEED;
    } else if (x > rect.right - EDGE) {
      dir = 1;
      speed = ((x - (rect.right - EDGE)) / EDGE) * MAX_SPEED;
    }
    autoScroll.current.dir = dir;
    autoScroll.current.speed = Math.min(MAX_SPEED, Math.max(0, speed));
    if (dir === 0) {
      if (autoScroll.current.raf) {
        cancelAnimationFrame(autoScroll.current.raf);
        autoScroll.current.raf = 0;
      }
      return;
    }
    if (!autoScroll.current.raf) {
      const step = () => {
        const s = autoScroll.current;
        if (s.dir === 0 || !boardRef.current) {
          s.raf = 0;
          return;
        }
        boardRef.current.scrollLeft += s.dir * s.speed;
        s.raf = requestAnimationFrame(step);
      };
      autoScroll.current.raf = requestAnimationFrame(step);
    }
  }, []);

  // Today as an ISO date (YYYY-MM-DD) for sprint-range comparison.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentSprint = useMemo(
    () => sprints.find((s) => isCurrentSprint(s, today)) ?? null,
    [sprints, today]
  );

  // Restore the last mode + sprint + team before the first fetch.
  useEffect(() => {
    let live = true;
    Promise.all([
      host.storage.get<string>(STORAGE_MODE_KEY),
      host.storage.get<string>(STORAGE_SPRINT_KEY),
      host.storage.get<string>(STORAGE_TEAM_KEY)
    ]).then(([savedMode, savedSprint, savedTeam]) => {
      if (!live) return;
      if (savedMode === 'backlog') setMode('backlog');
      if (savedSprint) setSprintSel(savedSprint as SprintSel);
      if (savedTeam) setTeamSel(savedTeam);
    });
    return () => {
      live = false;
    };
  }, [host]);

  // Resolve the active selection to a concrete sprint id for the query.
  // 'current' resolves once sprints load; until then it falls back to all.
  const effectiveSprintId = useMemo(() => {
    if (sprintSel === 'all') return undefined;
    if (sprintSel === 'current') return currentSprint?.id;
    return sprintSel;
  }, [sprintSel, currentSprint]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Identity + the two pickers' option lists are needed in both modes;
      // fetch them once. The board items themselves depend on the mode.
      const [who, sp, tm] = await Promise.all([
        host.call<GusIdentity>('whoami'),
        host.call<GusSprint[]>('listSprints'),
        host.call<GusTeam[]>('listTeams')
      ]);
      setIdentity(who);
      setSprints(sp);
      setTeams(tm);

      if (mode === 'backlog') {
        // Resolve the team to query: the saved/selected one if it's still in
        // the list, else fall back to the user's busiest team (first by count).
        const team = tm.find((t) => t.id === teamSel) ?? tm[0] ?? null;
        if (!team) {
          setItems([]);
          setError(null);
          return;
        }
        if (team.id !== teamSel) setTeamSel(team.id);
        const backlog = await host.call<GusWorkItem[]>('listBacklog', {
          teamId: team.id,
          includeClosed
        });
        setItems(backlog);
      } else {
        const work = await host.call<GusWorkItem[]>('listWork', {
          includeClosed,
          sprintId: effectiveSprintId
        });
        setItems(work);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host, mode, teamSel, includeClosed, effectiveSprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectSprint = (value: SprintSel) => {
    setSprintSel(value);
    void host.storage.set(STORAGE_SPRINT_KEY, value === 'all' ? '' : value);
  };

  const selectMode = (value: BoardMode) => {
    setMode(value);
    setTypeSel(null); // type filter is backlog-only; don't carry it across modes
    setMineOnly(false); // ditto the "mine only" cut
    void host.storage.set(STORAGE_MODE_KEY, value);
  };

  const selectTeam = (id: string) => {
    setTeamSel(id);
    setTypeSel(null); // a type from the prior team may not exist on this one
    void host.storage.set(STORAGE_TEAM_KEY, id);
  };

  const instanceUrl = identity?.instanceUrl ?? 'https://gus.my.salesforce.com';
  // Card click opens the detail modal; the modal offers "Open in GUS".
  const openItem = (item: GusWorkItem) => setSelected(item);

  /** Apply a status patch to one item in local state. */
  const patchStatus = useCallback((id: string, status: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)));
  }, []);

  /**
   * Commit a status change to GUS after the undo window elapses. If the write
   * fails, roll the card back to its previous status and toast the error.
   */
  const commitStatus = useCallback(
    (id: string, name: string, fromStatus: string, toStatus: string) => {
      const timer = window.setTimeout(() => {
        undoTimers.current.delete(id);
        host
          .call<{ ok: true }>('setStatus', id, toStatus)
          .catch((err) => {
            patchStatus(id, fromStatus); // roll back
            host.toast(
              `${name}: couldn't set status — ${err instanceof Error ? err.message : String(err)}`,
              'error'
            );
          });
      }, UNDO_WINDOW_MS);
      undoTimers.current.set(id, timer);
    },
    [host, patchStatus]
  );

  /** Undo a not-yet-committed move: cancel the pending write + restore status. */
  const undoMove = useCallback(
    (id: string, fromStatus: string) => {
      const t = undoTimers.current.get(id);
      if (t) {
        window.clearTimeout(t);
        undoTimers.current.delete(id);
      }
      patchStatus(id, fromStatus);
    },
    [patchStatus]
  );

  /** Drop a card on a column: optimistic move + undo toast + deferred write. */
  const handleDrop = useCallback(
    (col: BoardColumn, id: string) => {
      setDragOverKey(null);
      setDraggingId(null);
      if (!col.droppable || !col.status) return;
      const item = items.find((it) => it.id === id);
      if (!item || item.status === col.status) return;
      const fromStatus = item.status;
      const toStatus = col.status;
      patchStatus(id, toStatus); // optimistic
      commitStatus(id, item.name, fromStatus, toStatus);
      // The undo banner (rendered below) both announces the move and offers
      // a window to revert before the deferred write fires.
      setUndo({ id, name: item.name, fromStatus, toStatus });
    },
    [items, patchStatus, commitStatus]
  );

  // Transient undo banner state (cleared when the window passes or on undo).
  const [undo, setUndo] = useState<{
    id: string;
    name: string;
    fromStatus: string;
    toStatus: string;
  } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [undo]);

  // Clear any pending timers on unmount (avoid writes after the panel is gone).
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  // The set the backlog filters operate over: all team items, optionally
  // narrowed to the current user's. The "mine" cut comes first so the type
  // counts below reflect exactly what's on the board.
  const backlogBase = useMemo(() => {
    if (mode !== 'backlog' || !mineOnly || !identity) return items;
    return items.filter((it) => it.assigneeId === identity.userId);
  }, [items, mode, mineOnly, identity]);

  // Record types present in the (mine-filtered) backlog, with counts, for the
  // type filter. Derived before the type/text filters so counts don't shift.
  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of backlogBase) {
      const t = it.type ?? 'Other';
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [backlogBase]);

  // Client-side text + type filter over the base set.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byType = mode === 'backlog' && typeSel;
    if (!q && !byType) return backlogBase;
    return backlogBase.filter((it) => {
      if (byType && (it.type ?? 'Other') !== typeSel) return false;
      if (!q) return true;
      return (
        it.subject.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        (it.epicName ?? '').toLowerCase().includes(q) ||
        (it.productTag ?? '').toLowerCase().includes(q)
      );
    });
  }, [backlogBase, query, mode, typeSel]);

  // Group filtered items by column key. In work mode columns are statuses;
  // in backlog mode they're priorities (backlog is almost all `New`, so a
  // status board would collapse into one column).
  const byColumn = useMemo(() => {
    const map: Record<string, GusWorkItem[]> = {};
    for (const it of filtered) {
      const key =
        mode === 'backlog'
          ? backlogColumnKeyForPriority(it.priority)
          : columnKeyForStatus(it.status);
      (map[key] ??= []).push(it);
    }
    return map;
  }, [filtered, mode]);

  // Which columns to render. Backlog: the fixed priority columns. Work: the
  // status board (Closed only when opted in) plus the catch-all "Other"
  // column when it actually has items.
  const columns = useMemo(() => {
    if (mode === 'backlog') return BACKLOG_COLUMNS;
    const base = BOARD_COLUMNS.filter((c) => c.key !== 'closed' || includeClosed);
    const otherCount = (byColumn[OTHER_COLUMN_KEY] ?? []).length;
    return otherCount > 0 ? [...base, OTHER_COLUMN] : base;
  }, [mode, includeClosed, byColumn]);

  const totalShown = filtered.length;
  const activeTeam = useMemo(
    () => (mode === 'backlog' ? teams.find((t) => t.id === teamSel) ?? null : null),
    [mode, teams, teamSel]
  );

  return (
    <section className="gus-panel">
      <header className="gus-header">
        <div className="gus-header-title">
          <Layers size={16} className="gus-header-icon" aria-hidden />
          <h2>GUS</h2>
          {mode === 'backlog' ? (
            activeTeam && <span className="gus-user">{activeTeam.name} backlog</span>
          ) : (
            identity && <span className="gus-user">{identity.username}</span>
          )}
        </div>
        <div className="gus-header-actions">
          <span className="gus-count-pill">
            {totalShown} {totalShown === 1 ? 'item' : 'items'}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'gus-spin' : undefined} />
          </button>
        </div>
      </header>

      <div className="gus-body">
        <aside className="gus-rail">
          <div className="gus-search">
            <Search size={13} className="gus-search-icon" aria-hidden />
            <input
              type="text"
              placeholder="Filter work…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="gus-search-clear"
                aria-label="Clear filter"
                onClick={() => setQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="gus-mode-switch" role="tablist" aria-label="Board mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'work'}
              className={`gus-mode-tab ${mode === 'work' ? 'active' : ''}`}
              onClick={() => selectMode('work')}
            >
              My work
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'backlog'}
              className={`gus-mode-tab ${mode === 'backlog' ? 'active' : ''}`}
              onClick={() => selectMode('backlog')}
            >
              Backlog
            </button>
          </div>

          {mode === 'work' ? (
            <div className="gus-rail-section">
              <div className="gus-rail-label">Sprint</div>
              <button
                type="button"
                className={`gus-rail-item ${sprintSel === 'all' ? 'active' : ''}`}
                onClick={() => selectSprint('all')}
              >
                <span className="gus-rail-item-name">All sprints</span>
              </button>
              <button
                type="button"
                className={`gus-rail-item ${sprintSel === 'current' ? 'active' : ''}`}
                onClick={() => selectSprint('current')}
                disabled={!currentSprint}
                title={currentSprint ? currentSprint.name : 'No sprint covers today'}
              >
                <CalendarClock size={13} aria-hidden />
                <span className="gus-rail-item-name">Current sprint</span>
                {currentSprint && <span className="gus-rail-count">{currentSprint.openCount}</span>}
              </button>

              <div className="gus-rail-divider" />

              {sprints.map((s) => {
                const isCurrent = currentSprint?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`gus-rail-item ${sprintSel === s.id ? 'active' : ''}`}
                    onClick={() => selectSprint(s.id)}
                    title={s.startDate && s.endDate ? `${s.startDate} → ${s.endDate}` : s.name}
                  >
                    <span className="gus-rail-item-name">
                      {s.name}
                      {isCurrent && <span className="gus-now-dot" title="Current sprint" />}
                    </span>
                    <span className="gus-rail-count">{s.openCount}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="gus-rail-section">
              <div className="gus-rail-label">Team</div>
              {teams.length === 0 && !loading && (
                <div className="gus-rail-hint">No teams found on your work.</div>
              )}
              {teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`gus-rail-item ${teamSel === t.id ? 'active' : ''}`}
                  onClick={() => selectTeam(t.id)}
                  title={t.name}
                >
                  <Users size={13} aria-hidden />
                  <span className="gus-rail-item-name">{t.name}</span>
                  <span className="gus-rail-count" title="Your open work on this team">
                    {t.openCount}
                  </span>
                </button>
              ))}

              <div className="gus-rail-divider" />
              <button
                type="button"
                className={`gus-rail-item ${mineOnly ? 'active' : ''}`}
                onClick={() => {
                  setMineOnly((v) => !v);
                  setTypeSel(null); // the prior type may not exist in the new set
                }}
                title="Show only backlog items assigned to you"
              >
                <UserCheck size={13} aria-hidden />
                <span className="gus-rail-item-name">Assigned to me</span>
              </button>

              {typeCounts.length > 1 && (
                <>
                  <div className="gus-rail-divider" />
                  <div className="gus-rail-label">Type</div>
                  <button
                    type="button"
                    className={`gus-rail-item ${typeSel === null ? 'active' : ''}`}
                    onClick={() => setTypeSel(null)}
                  >
                    <span className="gus-rail-item-name">All types</span>
                    <span className="gus-rail-count">{backlogBase.length}</span>
                  </button>
                  {typeCounts.map(({ type, count }) => (
                    <button
                      key={type}
                      type="button"
                      className={`gus-rail-item ${typeSel === type ? 'active' : ''}`}
                      onClick={() => setTypeSel((cur) => (cur === type ? null : type))}
                      title={type}
                    >
                      <span className="gus-rail-item-name">{type}</span>
                      <span className="gus-rail-count">{count}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <label className="gus-toggle" title="Include closed / rejected work">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
            />
            <span>Show closed</span>
          </label>
        </aside>

        <div className="gus-content">
          {error && (
            <div className="gus-error" role="alert">
              <AlertCircle size={16} />
              <div>
                <strong>Couldn't load GUS work.</strong>
                <p>{error}</p>
                <p className="gus-error-hint">
                  Make sure the Salesforce CLI is authed:{' '}
                  <code>
                    sf org login web --alias gus --instance-url https://gus.my.salesforce.com
                  </code>
                </p>
              </div>
            </div>
          )}

          {!error && (
            <div
              className="gus-board"
              ref={boardRef}
              onDragOver={handleBoardDragOver}
              onDrop={stopAutoScroll}
            >
              {columns.map((col) => {
                const colItems = byColumn[col.key] ?? [];
                const isOver = dragOverKey === col.key;
                return (
                  <div
                    key={col.key}
                    className={[
                      'gus-column',
                      `gus-column--${col.key}`,
                      col.droppable ? 'is-droppable' : '',
                      isOver ? 'is-over' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={(e) => {
                      if (!col.droppable || !draggingId) return;
                      e.preventDefault(); // allow drop
                      if (dragOverKey !== col.key) setDragOverKey(col.key);
                    }}
                    onDragLeave={(e) => {
                      // Only clear when leaving the column, not its children.
                      if (e.currentTarget === e.target && dragOverKey === col.key) {
                        setDragOverKey(null);
                      }
                    }}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData('text/gus-id');
                      if (id) handleDrop(col, id);
                    }}
                  >
                    <div className="gus-column-head">
                      <span className="gus-column-title">{col.title}</span>
                      <span className="gus-column-count">{colItems.length}</span>
                    </div>
                    <div className="gus-column-body">
                      {colItems.map((item) => (
                        <GusCard
                          key={item.id}
                          item={item}
                          draggable={col.droppable}
                          dragging={draggingId === item.id}
                          subjectFirst={mode === 'backlog'}
                          onOpen={() => openItem(item)}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/gus-id', item.id);
                            e.dataTransfer.effectAllowed = 'move';
                            // Defer the state flip one tick: the browser
                            // snapshots the drag image synchronously here, so
                            // collapsing the origin card now would also blank
                            // the floating image. Flip after the snapshot.
                            const id = item.id;
                            setTimeout(() => setDraggingId(id), 0);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDragOverKey(null);
                            stopAutoScroll();
                          }}
                        />
                      ))}
                      {colItems.length === 0 && !loading && (
                        <div className="gus-column-empty">
                          {col.droppable && draggingId ? 'Drop here' : 'Nothing here'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {loading && items.length === 0 && !error && (
            <div className="gus-loading">
              {mode === 'backlog' ? 'Loading the team backlog…' : 'Loading your GUS work…'}
            </div>
          )}
        </div>
      </div>

      {undo && (
        <div className="gus-undo" role="status">
          <span>
            {undo.name} → <strong>{undo.toStatus}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              undoMove(undo.id, undo.fromStatus);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      {selected && (
        <GusDetailModal
          host={host}
          item={selected}
          instanceUrl={instanceUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function typeIcon(type?: string) {
  const t = (type ?? '').toLowerCase();
  if (t === 'bug') return <Bug size={12} aria-hidden />;
  if (t.includes('story')) return <BookOpen size={12} aria-hidden />;
  return <CircleDot size={12} aria-hidden />;
}

/**
 * Compact relative age from an ISO timestamp, e.g. `3d`, `5mo`, `2y`. The
 * staleness cue on backlog cards — how long an item has sat untouched. Returns
 * null for missing/future dates so the caller can omit the badge.
 */
function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 0) return null;
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

interface CardProps {
  item: GusWorkItem;
  draggable: boolean;
  dragging: boolean;
  /**
   * Backlog cards lead with the subject (the only thing that distinguishes
   * one of 200+ near-identical rows) and demote the W-number/type/age to a
   * quiet footer. They also drop the priority badge — in the backlog board the
   * column already *is* the priority, so the badge is pure noise.
   */
  subjectFirst: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function GusCard({
  item,
  draggable,
  dragging,
  subjectFirst,
  onOpen,
  onDragStart,
  onDragEnd
}: CardProps) {
  const typeClass = (item.type ?? 'other').toLowerCase().replace(/\s+/g, '-');

  if (subjectFirst) {
    const age = timeAgo(item.lastModified);
    return (
      <div
        className={`gus-card gus-card--backlog ${dragging ? 'is-dragging' : ''}`}
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        title={`${item.name} — click for details`}
      >
        <div className="gus-card-subject gus-card-subject--lead">{item.subject}</div>
        <div className="gus-card-foot">
          <span className={`gus-card-type gus-card-type--${typeClass}`}>
            {typeIcon(item.type)}
            <span>{item.name}</span>
          </span>
          {age && (
            <span className="gus-card-age" title={`Last modified ${item.lastModified ?? ''}`}>
              {age}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`gus-card ${dragging ? 'is-dragging' : ''} ${draggable ? 'is-draggable' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${item.name} — click for details`}
    >
      <div className="gus-card-top">
        <span className={`gus-card-type gus-card-type--${typeClass}`}>
          {typeIcon(item.type)}
          <span>{item.name}</span>
        </span>
        {item.priority && (
          <span className={`gus-prio gus-prio--${item.priority.toLowerCase()}`}>
            {item.priority}
          </span>
        )}
      </div>
      <div className="gus-card-subject">{item.subject}</div>
      {(item.sprintName || typeof item.storyPoints === 'number') && (
        <div className="gus-card-meta">
          {item.sprintName && <span className="gus-chip">{item.sprintName}</span>}
          {typeof item.storyPoints === 'number' && (
            <span className="gus-chip gus-chip--pts">{item.storyPoints} pts</span>
          )}
          <ExternalLink size={11} className="gus-card-open" aria-hidden />
        </div>
      )}
    </div>
  );
}
