/**
 * Zana module — renderer panel. A read-only dashboard over a project's (or the
 * global `~/.zana/`) Zana work-tracking data. A vertical project rail on the
 * LEFT scopes the whole dashboard to a data source (Global ~/.zana, or any open
 * project that has a `.zana/`). To the right: a KPI strip on top, then a tab bar
 * switching between Tickets (a read-only kanban grouped by status), Sprints (a
 * list with derived counts) and Docs (generated artifacts). Clicking any card
 * opens a detail modal.
 *
 * On first open the rail auto-selects the persisted source if it still exists,
 * else the app's active project when it has a `.zana/`, else Global. The active
 * tab and selected source persist via `host.storage`.
 *
 * Decoupling: this component talks to the host only through the injected
 * `ModuleHost` (`host.call`, `host.storage`, `host.getActiveProject`, …). It
 * imports no core stores or IPC. Styling uses shared `zana-*` classes in
 * global.css plus the app's existing design tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  RefreshCw,
  RefreshCcwDot,
  Search,
  X,
  CircleDot,
  CheckCircle2,
  Ban,
  Activity,
  CalendarRange,
  FileText,
  BookOpen,
  Link2,
  Users,
  Tag,
  Folder,
  User,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import type {
  ZanaArtifact,
  ZanaProfile,
  ZanaProjectSource,
  ZanaSnapshot,
  ZanaSprint,
  ZanaTicket
} from '../shared/types';
import { isClosedZanaStatus } from '../shared/types';
import {
  CardAssignee,
  buildProfileMap,
  type AssignChoice,
  type ProfileMap
} from './ZanaAssign';
import { ZanaDetailModal, type ZanaSelection } from './ZanaDetailModal';

const STORAGE_TAB_KEY = 'activeTab';
/** Persisted selected source: '' = Global, otherwise a project id. */
const STORAGE_SOURCE_KEY = 'selectedSourceId';
/** Persisted auto-refresh on/off choice. */
const STORAGE_AUTOREFRESH_KEY = 'autoRefresh';
/**
 * Persisted per-status column collapse overrides. A status key present here
 * pins that column's collapsed state (true/false), overriding the default
 * (terminal columns start collapsed, active columns expanded).
 */
const STORAGE_COLLAPSED_KEY = 'collapsedColumns';
/** Auto-refresh cadence — hardcoded per product decision. */
const AUTO_REFRESH_MS = 30_000;
/** How long the assignment undo banner stays actionable before the write commits. */
const UNDO_WINDOW_MS = 6000;

type TabId = 'tickets' | 'sprints' | 'docs' | 'profiles';

/** Canonical ordering for kanban columns; unknown statuses sort after these. */
const STATUS_ORDER = [
  'backlog',
  'todo',
  'to do',
  'in-progress',
  'in progress',
  'doing',
  'review',
  'in review',
  'blocked',
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
];

function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status.trim().toLowerCase());
  return i === -1 ? STATUS_ORDER.length : i;
}

/**
 * Statuses whose columns are terminal (done/cancelled/etc). These hold the
 * least-actionable tickets — usually the bulk of the board — so their columns
 * start collapsed and, when expanded, render as dense one-line rows rather than
 * full cards. A user can still pin them open (persisted).
 */
const TERMINAL_STATUSES = new Set([
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
]);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Mirror of the modal's date formatting, for doc metadata rows. */
function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Derive a short plain-text preview from a markdown doc body: strip the common
 * markdown syntax (headings, emphasis, code fences/spans, link syntax, images,
 * blockquotes, list bullets), collapse whitespace, and clip to ~180 chars. This
 * is intentionally lightweight — it gives docs a readable excerpt, not a faithful
 * render (the modal does the real rendering).
 */
function excerptFromMarkdown(md: string, max = 180): string {
  if (!md) return '';
  let text = md;
  // Drop fenced code blocks entirely (their contents make poor previews).
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
  // Images: ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Inline code, emphasis, strikethrough markers.
  text = text.replace(/[`*_~]+/g, '');
  // Leading heading hashes, blockquote markers, list bullets, table pipes.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, '');
  text = text.replace(/\|/g, ' ');
  // Collapse all runs of whitespace to single spaces.
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Resolve a sprint id to a REAL display name, or undefined. The main module
 * synthesises `Sprint <hash>` for unnamed sprints; we treat that as "no real
 * name" so the card doesn't show a mystery hash chip.
 */
function resolveSprintName(
  sprintId: string | undefined,
  sprints: ZanaSprint[]
): string | undefined {
  if (!sprintId) return undefined;
  const name = sprints.find((s) => s.id === sprintId)?.name;
  if (!name) return undefined;
  if (name === `Sprint ${sprintId.slice(0, 8)}`) return undefined; // synthetic fallback
  return name;
}

/**
 * Titles Zana's own integration tests leave behind (e.g. `test-1778…-claim`,
 * `Test ticket`, bare `Updated`/`blocked`). These carry no real content, so we
 * rank them below substantive tickets within a column rather than hide them.
 */
const TEST_TITLE_RE = /^(test-\d+|test ticket|updated|blocked|round-trip test)\b/i;

/**
 * A rough "substance" score so meaningful tickets surface above bare test
 * fixtures within each kanban column. Higher = more real content. Purely a
 * display sort — nothing is filtered out or mutated.
 */
function substanceScore(t: ZanaTicket): number {
  let score = 0;
  if ((t.description ?? '').trim().length > 0) score += 3;
  if (t.sprintId) score += 1;
  if (t.labels.length > 0) score += 1;
  if (t.assigneeName) score += 1;
  if (TEST_TITLE_RE.test(t.title.trim())) score -= 4;
  return score;
}

export default function ZanaPanel({ host }: { host: ModuleHost }) {
  const activeProject = useMemo(() => host.getActiveProject(), [host]);

  // The set of selectable sources for the rail (Global + projects with .zana).
  const [railSources, setRailSources] = useState<ZanaProjectSource[]>([]);
  // Selected source: '' = Global, otherwise a project id present in railSources.
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<ZanaSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('tickets');
  const [query, setQuery] = useState('');
  const [sprintFilter, setSprintFilter] = useState<string | null>(null);
  // Per-status collapse overrides keyed by lowercased status. A key's presence
  // pins that column's state; absent statuses fall back to the default (terminal
  // columns collapsed, active columns expanded). Restored from storage on mount.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<ZanaSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Both prefs + the source probe must resolve before the first data load.
  const [ready, setReady] = useState(false);
  // Auto-refresh on/off (default ON; restored from storage). Paused while a
  // detail modal is open so data isn't yanked out from under the user.
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Workspace profiles, fetched once on mount; drives the assignment picker
  // and the card profile chip. Soft-fails to [].
  const [profiles, setProfiles] = useState<ZanaProfile[]>([]);
  // Which card's assign menu is open (ticket id), or null.
  const [assignMenuFor, setAssignMenuFor] = useState<string | null>(null);
  // Transient undo banner for an in-flight assignment.
  const [assignUndo, setAssignUndo] = useState<{ id: string; label: string } | null>(null);

  // The resolved source row for the current selection (falls back to Global).
  const selectedSource = useMemo(
    () =>
      railSources.find((s) => s.id === selectedSourceId && s.kind === 'project') ??
      railSources.find((s) => s.kind === 'global') ??
      null,
    [railSources, selectedSourceId]
  );
  // Derive the legacy snapshot params from the selection: Global → useGlobal,
  // a project → that project's path (NOT necessarily the app's active project).
  const useGlobal = !selectedSource || selectedSource.kind === 'global';
  const projectPath = useGlobal ? undefined : selectedSource?.path;

  // Probe the rail (Global + projects with .zana) and pick an initial source.
  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const sources = await host.call<ZanaProjectSource[]>('probeProjects', {
        projects: host.listProjects()
      });
      setRailSources(sources);
      return sources;
    } catch (err) {
      // A probe failure shouldn't blank the panel — fall back to a Global-only
      // rail so the dashboard still works against ~/.zana.
      host.toast(
        `Zana: couldn't list project sources — ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
      const fallback: ZanaProjectSource[] = [
        { id: '', name: 'Global', path: '', kind: 'global', hasZana: true, openTickets: 0 }
      ];
      setRailSources(fallback);
      return fallback;
    } finally {
      setProbing(false);
    }
  }, [host]);

  // One-time bootstrap: restore prefs + probe sources, then resolve the
  // initial selection (persisted → active project → Global) before loading.
  useEffect(() => {
    let live = true;
    (async () => {
      const [tab, savedSourceId, savedAuto, savedCollapsed, sources] = await Promise.all([
        host.storage.get<TabId>(STORAGE_TAB_KEY),
        host.storage.get<string>(STORAGE_SOURCE_KEY),
        host.storage.get<boolean>(STORAGE_AUTOREFRESH_KEY),
        host.storage.get<Record<string, boolean>>(STORAGE_COLLAPSED_KEY),
        probe()
      ]);
      if (!live) return;
      if (tab === 'tickets' || tab === 'sprints' || tab === 'docs' || tab === 'profiles')
        setActiveTab(tab);
      // Default ON; only an explicit stored `false` disables it.
      if (savedAuto === false) setAutoRefresh(false);
      if (savedCollapsed && typeof savedCollapsed === 'object') setCollapsedOverrides(savedCollapsed);

      // Global is no longer a selectable source: default to a project. Prefer
      // the persisted one, then the app's active project, then the first
      // project with a `.zana/`. Empty string only when none exist — that
      // leaves the dashboard on a silent global fallback so it never blanks.
      const projectSources = sources.filter((s) => s.kind === 'project');
      const hasProject = (id: string) => projectSources.some((s) => s.id === id);
      let initial = '';
      if (typeof savedSourceId === 'string' && savedSourceId && hasProject(savedSourceId)) {
        initial = savedSourceId;
      } else if (activeProject && hasProject(activeProject.id)) {
        initial = activeProject.id;
      } else if (projectSources.length > 0) {
        initial = projectSources[0].id;
      }
      setSelectedSourceId(initial);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [host, probe, activeProject]);

  /**
   * Reload the snapshot. `background: true` (used by the auto-refresh timer and
   * the post-assignment refresh) keeps the board on screen — it skips the
   * full-screen `loading` flicker and only spins the header icon.
   */
  const load = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      if (!background) setLoading(true);
      setError(null);
      try {
        const snap = await host.call<ZanaSnapshot>('getSnapshot', { projectPath, useGlobal });
        setSnapshot(snap);
      } catch (err) {
        // A failed background refresh shouldn't blow away a good board.
        if (!background) {
          setError(err instanceof Error ? err.message : String(err));
          setSnapshot(null);
        }
      } finally {
        if (!background) setLoading(false);
      }
    },
    [host, projectPath, useGlobal]
  );

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // Fetch workspace profiles once on mount (soft-fail to []).
  useEffect(() => {
    let live = true;
    host
      .call<ZanaProfile[]>('listProfiles')
      .then((list) => {
        if (live && Array.isArray(list)) setProfiles(list);
      })
      .catch(() => {
        /* no profiles available — picker still offers free-text + clear */
      });
    return () => {
      live = false;
    };
  }, [host]);

  // A ref so the auto-refresh interval always calls the freshest `load`
  // without being torn down + rebuilt every render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Auto-refresh: fire a quiet background reload every AUTO_REFRESH_MS, but
  // only while enabled, ready, and no detail modal is open (so the user's view
  // isn't disturbed mid-read). Leak-free: cleared on unmount + when deps change.
  useEffect(() => {
    if (!autoRefresh || !ready || selected !== null) return;
    const timer = window.setInterval(() => {
      void loadRef.current({ background: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, ready, selected]);

  const toggleAutoRefresh = () => {
    setAutoRefresh((prev) => {
      const next = !prev;
      void host.storage.set(STORAGE_AUTOREFRESH_KEY, next);
      return next;
    });
  };

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    void host.storage.set(STORAGE_TAB_KEY, tab);
  };

  /** Resolve a column's collapsed state: explicit override, else default by status. */
  const isColumnCollapsed = useCallback(
    (status: string) => {
      const key = status.trim().toLowerCase();
      return collapsedOverrides[key] ?? isTerminalStatus(status);
    },
    [collapsedOverrides]
  );

  /** Toggle (and persist) a column's collapsed state, pinning the override. */
  const toggleColumnCollapsed = useCallback(
    (status: string) => {
      const key = status.trim().toLowerCase();
      setCollapsedOverrides((prev) => {
        const next = { ...prev, [key]: !(prev[key] ?? isTerminalStatus(status)) };
        void host.storage.set(STORAGE_COLLAPSED_KEY, next);
        return next;
      });
    },
    [host]
  );

  const switchSource = (id: string) => {
    if (id === selectedSourceId) return;
    setSelectedSourceId(id);
    setSprintFilter(null);
    void host.storage.set(STORAGE_SOURCE_KEY, id);
    // Mirror the core Projects sidebar: selecting a project source here also
    // makes it the app's globally-selected project, so the rest of the shell
    // follows along. A project source's rail id IS the app project id; Global
    // ('') leaves the app selection untouched.
    if (id) host.selectProject(id);
  };

  const profileMap = useMemo(() => buildProfileMap(profiles), [profiles]);

  // ── Assignment: optimistic patch + deferred write + undo ──────────────────
  // Pending commit timers keyed by ticket id, so a re-assign cancels the prior.
  const assignTimers = useRef<Map<string, number>>(new Map());
  // The pre-assignment snapshot of each ticket's assignee fields, for rollback
  // / undo, keyed by ticket id.
  const assignPrev = useRef<
    Map<string, Pick<ZanaTicket, 'assigneeName' | 'assigneeId' | 'assigneeProfileId'>>
  >(new Map());

  /** Patch one ticket's assignee fields in local snapshot state. */
  const patchAssignee = useCallback(
    (id: string, patch: Partial<Pick<ZanaTicket, 'assigneeName' | 'assigneeId' | 'assigneeProfileId'>>) => {
      setSnapshot((prev) =>
        prev
          ? { ...prev, tickets: prev.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
          : prev
      );
    },
    []
  );

  /** Commit the assignment write after the undo window; roll back on failure. */
  const commitAssign = useCallback(
    (id: string, args: Record<string, unknown>, label: string) => {
      const timer = window.setTimeout(() => {
        assignTimers.current.delete(id);
        host
          .call<unknown>('assignTicket', { projectPath, useGlobal, id, ...args })
          .then(() => {
            assignPrev.current.delete(id);
            // Quietly refresh to pick up the fresh audit entry.
            void loadRef.current({ background: true });
          })
          .catch((err) => {
            const prev = assignPrev.current.get(id);
            if (prev) patchAssignee(id, prev); // roll back
            assignPrev.current.delete(id);
            host.toast(
              `Couldn't assign ${label} — ${err instanceof Error ? err.message : String(err)}`,
              'error'
            );
          });
      }, UNDO_WINDOW_MS);
      assignTimers.current.set(id, timer);
    },
    [host, projectPath, useGlobal, patchAssignee]
  );

  /**
   * Apply an assignment choice: snapshot prior fields (once per pending write),
   * optimistically patch, defer the write, and raise the undo banner. Guards
   * against double-fires by cancelling any prior pending timer for this ticket.
   */
  const applyAssign = useCallback(
    (ticket: ZanaTicket, choice: AssignChoice) => {
      setAssignMenuFor(null);
      // Cancel a still-pending write for this ticket (re-assign before commit).
      const pending = assignTimers.current.get(ticket.id);
      if (pending) {
        window.clearTimeout(pending);
        assignTimers.current.delete(ticket.id);
      }
      // Record the rollback baseline only the first time (so undo restores the
      // true pre-edit state even across rapid re-assigns).
      if (!assignPrev.current.has(ticket.id)) {
        assignPrev.current.set(ticket.id, {
          assigneeName: ticket.assigneeName,
          assigneeId: ticket.assigneeId,
          assigneeProfileId: ticket.assigneeProfileId
        });
      }

      let patch: Partial<Pick<ZanaTicket, 'assigneeName' | 'assigneeId' | 'assigneeProfileId'>>;
      let args: Record<string, unknown>;
      let label: string;
      if (choice.kind === 'clear') {
        patch = { assigneeName: undefined, assigneeId: undefined, assigneeProfileId: undefined };
        args = { profileId: null };
        label = 'Unassigned';
      } else if (choice.kind === 'profile') {
        patch = { assigneeName: choice.displayName, assigneeProfileId: choice.profileId };
        args = { profileId: choice.profileId };
        label = choice.displayName;
      } else {
        patch = { assigneeName: choice.assigneeName, assigneeProfileId: undefined };
        args = { assigneeName: choice.assigneeName };
        label = choice.assigneeName;
      }

      patchAssignee(ticket.id, patch); // optimistic
      commitAssign(ticket.id, args, label);
      setAssignUndo({ id: ticket.id, label });
    },
    [patchAssignee, commitAssign]
  );

  /** Undo a not-yet-committed assignment: cancel the write + restore fields. */
  const undoAssign = useCallback((id: string) => {
    const timer = assignTimers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      assignTimers.current.delete(id);
    }
    const prev = assignPrev.current.get(id);
    if (prev) {
      setSnapshot((s) =>
        s ? { ...s, tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...prev } : t)) } : s
      );
      assignPrev.current.delete(id);
    }
    setAssignUndo(null);
  }, []);

  // Auto-dismiss the undo banner after the window passes.
  useEffect(() => {
    if (!assignUndo) return;
    const t = window.setTimeout(() => setAssignUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [assignUndo]);

  // Flush any pending assignment timers on unmount (no writes after teardown).
  useEffect(() => {
    const timers = assignTimers.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const kpis = snapshot?.kpis;
  const tickets = snapshot?.tickets ?? [];
  const sprints = snapshot?.sprints ?? [];
  const artifacts = snapshot?.artifacts ?? [];

  const sourceLabel = selectedSource?.name ?? (useGlobal ? 'No project' : 'Project');

  // Client-side text filter over tickets (title + labels), plus an optional
  // sprint filter set by clicking a sprint in the Sprints tab.
  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (sprintFilter && t.sprintId !== sprintFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.labels.some((l) => l.toLowerCase().includes(q)) ||
        (t.assigneeName ?? '').toLowerCase().includes(q)
      );
    });
  }, [tickets, query, sprintFilter]);

  // Group filtered tickets into kanban columns keyed by raw status, ordered by
  // the canonical sequence with unknown statuses trailing alphabetically. Within
  // each column, rank substantive tickets above bare test fixtures, keeping the
  // snapshot's updatedAt-desc order as the tiebreaker (filteredTickets already
  // arrives sorted by updatedAt, so a stable sort on score alone preserves it).
  const columns = useMemo(() => {
    const map = new Map<string, ZanaTicket[]>();
    for (const t of filteredTickets) {
      const key = t.status || 'unknown';
      (map.get(key) ?? map.set(key, []).get(key)!).push(t);
    }
    for (const items of map.values()) {
      items.sort((a, b) => substanceScore(b) - substanceScore(a));
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ra = statusRank(a);
      const rb = statusRank(b);
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  }, [filteredTickets]);

  const countPill =
    activeTab === 'tickets'
      ? `${filteredTickets.length} ${filteredTickets.length === 1 ? 'ticket' : 'tickets'}`
      : activeTab === 'sprints'
        ? `${sprints.length} ${sprints.length === 1 ? 'sprint' : 'sprints'}`
        : activeTab === 'docs'
          ? `${artifacts.length} ${artifacts.length === 1 ? 'doc' : 'docs'}`
          : `${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`;

  // Empty when the source resolved but holds no data of any kind.
  const isEmpty =
    !loading &&
    !error &&
    snapshot !== null &&
    tickets.length === 0 &&
    sprints.length === 0 &&
    artifacts.length === 0;

  // True first-run case: no open project has a `.zana/` at all, so there is
  // nothing for the panel to show. We surface a welcome/explainer instead of a
  // bare empty board so an unfamiliar user isn't surprised by a blank section.
  // (`ready` gates it so we don't flash the welcome before the probe resolves.)
  const noProjectSource =
    ready && !probing && railSources.filter((s) => s.kind === 'project').length === 0;

  return (
    <section className="gus-panel zana-panel">
      <header className="gus-header zana-header">
        <div className="gus-header-title">
          <Activity size={16} className="gus-header-icon" aria-hidden />
          <h2>Zana</h2>
          <span className="gus-user zana-source-label">
            <Folder size={11} aria-hidden />
            {sourceLabel}
          </span>
        </div>
        <div className="gus-header-actions">
          <span className="gus-count-pill">{countPill}</span>
          <button
            type="button"
            className={`icon-btn zana-autorefresh-btn ${autoRefresh ? 'is-active' : 'is-idle'}`}
            onClick={toggleAutoRefresh}
            title={autoRefresh ? 'Auto-refresh on (every 30s) — click to pause' : 'Auto-refresh off — click to resume (every 30s)'}
            aria-label="Toggle auto-refresh"
            aria-pressed={autoRefresh}
          >
            <RefreshCcwDot size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              void probe();
              void load();
            }}
            disabled={loading || probing}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading || probing ? 'gus-spin' : undefined} />
          </button>
        </div>
      </header>

      <div className="zana-shell">
        {/* Primary source rail: every open project with a .zana/. Scopes the
            whole dashboard. Always visible across all tabs. */}
        <aside className="gus-rail zana-source-rail" aria-label="Data source">
          <div className="gus-rail-section">
            <div className="gus-rail-label">Projects</div>
            {railSources.filter((s) => s.kind === 'project').length === 0 && (
              <div className="zana-rail-hint">No open project has a <code>.zana/</code>.</div>
            )}
            {railSources
              .filter((s) => s.kind === 'project')
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`gus-rail-item ${!useGlobal && selectedSource?.id === s.id ? 'active' : ''}`}
                  onClick={() => switchSource(s.id)}
                  title={s.path}
                >
                  <Folder size={13} aria-hidden />
                  <span className="gus-rail-item-name">{s.name}</span>
                  {s.openTickets > 0 && <span className="gus-rail-count">{s.openTickets}</span>}
                </button>
              ))}
          </div>
        </aside>

        <div className="zana-main">
      {/* First-run welcome: shown when no open project has a `.zana/` at all, so
          a new user understands what this section is and why it's empty, rather
          than seeing a blank board. Takes over the whole main column. */}
      {noProjectSource ? (
        <div className="zana-welcome" role="status">
          <div className="zana-welcome-icon" aria-hidden>
            <Activity size={28} />
          </div>
          <h3 className="zana-welcome-title">Welcome to Zana</h3>
          <p className="zana-welcome-lead">
            This section visualizes your <strong>Zana</strong> work-tracking — tickets, sprints,
            generated docs and agent profiles — for whichever project you're in.
          </p>
          <p className="zana-welcome-empty">
            None of your open projects has Zana data yet, so there's nothing to show.
          </p>
          <div className="zana-welcome-how">
            <div className="zana-welcome-how-title">To get started</div>
            <ul>
              <li>
                Run Zana inside a project — it stores everything under a{' '}
                <code>.zana/</code> folder in that project.
              </li>
              <li>
                Open that project here, and it'll appear in the <strong>Projects</strong> rail on
                the left.
              </li>
              <li>Select it to see KPIs, the ticket board, sprints, docs and profiles.</li>
            </ul>
          </div>
          <button
            type="button"
            className="zana-welcome-refresh"
            onClick={() => {
              void probe();
              void load();
            }}
            disabled={probing || loading}
          >
            <RefreshCw size={13} className={probing || loading ? 'gus-spin' : undefined} />
            Re-check for projects
          </button>
        </div>
      ) : (
      <>
      {/* KPI strip — always visible (zeros when empty). */}
      {kpis && (
        <div className="zana-kpi-strip">
          <KpiCard icon={<CircleDot size={15} />} label="Open" value={kpis.openTickets} tone="open" />
          <KpiCard icon={<CheckCircle2 size={15} />} label="Closed" value={kpis.closedTickets} tone="done" />
          <KpiCard icon={<Ban size={15} />} label="Blocked" value={kpis.blockedTickets} tone="blocked" />
          <KpiCard
            icon={<Activity size={15} />}
            label="Throughput 7d"
            value={kpis.throughput7d ?? 0}
          />
          <KpiCard icon={<CalendarRange size={15} />} label="Sprints" value={kpis.sprintCount} />
          <KpiCard icon={<FileText size={15} />} label="Docs" value={kpis.artifactCount} />

          {/* Compact status + priority breakdowns as chips/bars. */}
          <div className="zana-kpi-breakdowns">
            <Breakdown title="By status" counts={kpis.byStatus} />
            <Breakdown title="By priority" counts={kpis.byPriority} />
          </div>
        </div>
      )}

      {/* Tab bar. */}
      <div className="zana-tabs" role="tablist">
        {(['tickets', 'sprints', 'docs', 'profiles'] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`zana-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => selectTab(tab)}
          >
            {tab === 'profiles' && <Users size={13} aria-hidden />}
            {tab === 'tickets'
              ? 'Tickets'
              : tab === 'sprints'
                ? 'Sprints'
                : tab === 'docs'
                  ? 'Docs'
                  : 'Profiles'}
          </button>
        ))}
        {sprintFilter && activeTab === 'tickets' && (
          <button
            type="button"
            className="zana-sprint-filter-clear"
            onClick={() => setSprintFilter(null)}
          >
            Sprint: {sprints.find((s) => s.id === sprintFilter)?.name ?? shortId(sprintFilter)}
            <X size={11} />
          </button>
        )}
      </div>

      {error && (
        <div className="gus-error" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>Couldn't load Zana data.</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {isEmpty && activeTab !== 'profiles' && (
        <div className="gus-error zana-empty" role="status">
          <AlertCircle size={16} />
          <div>
            <strong>No Zana data for this project.</strong>
            <p>
              Zana stores tickets, sprints and docs under <code>.zana/</code> — run Zana in this
              project, or pick another project from the rail.
            </p>
          </div>
        </div>
      )}

      {loading && !snapshot && !error && (
        <div className="gus-loading">Loading Zana data…</div>
      )}

      {!error && !isEmpty && snapshot && (
        <div className="zana-content">
          {activeTab === 'tickets' && (
            <div className="gus-body zana-tickets-body">
              <aside className="gus-rail zana-rail">
                <div className="gus-search">
                  <Search size={13} className="gus-search-icon" aria-hidden />
                  <input
                    type="text"
                    placeholder="Filter tickets…"
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
                <div className="zana-rail-hint">
                  Filters by title, labels &amp; assignee.
                </div>
              </aside>

              <div className="gus-content">
                <div className="gus-board zana-board">
                  {columns.length === 0 && (
                    <div className="gus-column-empty">No tickets match.</div>
                  )}
                  {columns.map(([status, items]) => {
                    const collapsed = isColumnCollapsed(status);
                    const terminal = isTerminalStatus(status);
                    return (
                      <div
                        key={status}
                        className={`gus-column zana-column ${collapsed ? 'is-collapsed' : ''} ${
                          terminal ? 'zana-column--terminal' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="gus-column-head zana-column-head-btn"
                          onClick={() => toggleColumnCollapsed(status)}
                          aria-expanded={!collapsed}
                          title={collapsed ? `Expand ${status}` : `Collapse ${status}`}
                        >
                          <span className="zana-column-head-left">
                            {collapsed ? (
                              <ChevronRight size={13} aria-hidden />
                            ) : (
                              <ChevronDown size={13} aria-hidden />
                            )}
                            <span className="gus-column-title">{status}</span>
                          </span>
                          <span className="gus-column-count">{items.length}</span>
                        </button>
                        {!collapsed &&
                          (terminal ? (
                            // Terminal columns expand into a dense one-line list:
                            // far more tickets fit, and they're the least-actionable.
                            <div className="gus-column-body zana-column-body--dense">
                              {items.map((t) => (
                                <CompactTicketRow
                                  key={t.id}
                                  ticket={t}
                                  onOpen={() => setSelected({ kind: 'ticket', ticket: t })}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="gus-column-body">
                              {items.map((t) => (
                                <TicketCard
                                  key={t.id}
                                  ticket={t}
                                  sprintName={resolveSprintName(t.sprintId, sprints)}
                                  profiles={profiles}
                                  profileMap={profileMap}
                                  assignMenuOpen={assignMenuFor === t.id}
                                  onToggleAssignMenu={() =>
                                    setAssignMenuFor((cur) => (cur === t.id ? null : t.id))
                                  }
                                  onCloseAssignMenu={() => setAssignMenuFor(null)}
                                  onAssign={(choice) => applyAssign(t, choice)}
                                  onOpen={() => setSelected({ kind: 'ticket', ticket: t })}
                                />
                              ))}
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sprints' && (
            <div className="zana-list">
              {sprints.length === 0 && <div className="gus-column-empty">No sprints.</div>}
              {sprints.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="zana-sprint-row"
                  onClick={() => {
                    setSprintFilter(s.id);
                    selectTab('tickets');
                  }}
                  title="View this sprint's tickets"
                >
                  <div className="zana-sprint-main">
                    <span className="zana-sprint-name">{s.name ?? shortId(s.id)}</span>
                    {s.status && <span className="gus-chip">{s.status}</span>}
                  </div>
                  <div className="zana-sprint-counts">
                    <span className="zana-sprint-count">
                      <CircleDot size={12} aria-hidden /> {s.openCount ?? 0} open
                    </span>
                    <span className="zana-sprint-count">
                      {s.ticketCount ?? 0} total
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="zana-doc-list">
              {artifacts.length === 0 && <div className="gus-column-empty">No docs.</div>}
              {artifacts.map((a) => (
                <ArtifactCard
                  key={a.id}
                  artifact={a}
                  onOpen={() => setSelected({ kind: 'artifact', artifact: a })}
                />
              ))}
            </div>
          )}

          {activeTab === 'profiles' && (
            <ProfilesView
              profiles={profiles}
              tickets={tickets}
              onOpen={(p) => setSelected({ kind: 'profile', profile: p })}
            />
          )}
        </div>
      )}

      {/* Profiles are independent of the ticket snapshot, so they stay viewable
          even when the selected source has no tickets/sprints/docs. */}
      {!error && isEmpty && activeTab === 'profiles' && (
        <div className="zana-content">
          <ProfilesView
            profiles={profiles}
            tickets={tickets}
            onOpen={(p) => setSelected({ kind: 'profile', profile: p })}
          />
        </div>
      )}
      </>
      )}
        </div>
      </div>

      {assignUndo && (
        <div className="gus-undo zana-undo" role="status">
          <span>
            Assigned → <strong>{assignUndo.label}</strong>
          </span>
          <button type="button" onClick={() => undoAssign(assignUndo.id)}>
            Undo
          </button>
        </div>
      )}

      {selected && (
        <ZanaDetailModal
          host={host}
          selection={selected}
          sprints={sprints}
          tickets={tickets}
          profiles={profiles}
          profileMap={profileMap}
          projectPath={projectPath}
          useGlobal={useGlobal}
          onAssign={(choice) => {
            if (selected.kind === 'ticket') applyAssign(selected.ticket, choice);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

// ── KPI strip pieces ───────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'open' | 'done' | 'blocked';
}) {
  return (
    <div className={`zana-kpi-card ${tone ? `zana-kpi-card--${tone}` : ''}`}>
      <span className="zana-kpi-icon" aria-hidden>
        {icon}
      </span>
      <span className="zana-kpi-value">{value}</span>
      <span className="zana-kpi-label">{label}</span>
    </div>
  );
}

/** A compact breakdown: a labelled row of proportional bars per key. */
function Breakdown({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div className="zana-breakdown">
      <div className="zana-breakdown-title">{title}</div>
      <div className="zana-breakdown-rows">
        {entries.map(([key, n]) => (
          <div key={key} className="zana-breakdown-row" title={`${key}: ${n}`}>
            <span className="zana-breakdown-key">{key}</span>
            <span className="zana-breakdown-bar">
              <span
                className="zana-breakdown-fill"
                style={{ width: `${Math.round((n / max) * 100)}%` }}
              />
            </span>
            <span className="zana-breakdown-num">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────

function TicketCard({
  ticket,
  sprintName,
  profiles,
  profileMap,
  assignMenuOpen,
  onToggleAssignMenu,
  onCloseAssignMenu,
  onAssign,
  onOpen
}: {
  ticket: ZanaTicket;
  sprintName?: string;
  profiles: ZanaProfile[];
  profileMap: ProfileMap;
  assignMenuOpen: boolean;
  onToggleAssignMenu: () => void;
  onCloseAssignMenu: () => void;
  onAssign: (choice: AssignChoice) => void;
  onOpen: () => void;
}) {
  const closed = isClosedZanaStatus(ticket.status, ticket.closedAt);
  return (
    <div
      className={`gus-card zana-card ${closed ? 'is-closed' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${ticket.title} — click for details`}
    >
      {/* Title leads — the most important thing on the card. */}
      <div className="gus-card-top zana-card-top">
        <div className="gus-card-subject zana-card-title">{ticket.title}</div>
        {ticket.priority && (
          <span className={`zana-prio zana-prio--${ticket.priority.toLowerCase()}`}>
            {ticket.priority}
          </span>
        )}
      </div>
      <div className="gus-card-meta zana-card-meta">
        <CardAssignee
          assigneeName={ticket.assigneeName}
          profileId={ticket.assigneeProfileId}
          profiles={profiles}
          profileMap={profileMap}
          menuOpen={assignMenuOpen}
          onToggleMenu={onToggleAssignMenu}
          onPick={onAssign}
          onCloseMenu={onCloseAssignMenu}
        />
        {ticket.type && <span className="zana-type-badge">{ticket.type}</span>}
        {ticket.blockedBy.length > 0 && (
          <span className="zana-blocked-tag" title={`Blocked by ${ticket.blockedBy.length}`}>
            <Ban size={11} aria-hidden /> Blocked
          </span>
        )}
        {sprintName && <span className="gus-chip">{sprintName}</span>}
        {ticket.labels.slice(0, 3).map((l) => (
          <span key={l} className="zana-label-chip">
            <Tag size={9} aria-hidden /> {l}
          </span>
        ))}
        {ticket.labels.length > 3 && (
          <span className="gus-chip">+{ticket.labels.length - 3}</span>
        )}
        {/* Demoted: the short id lives dim in the footer, not as the headline. */}
        <span className="zana-card-id" title={ticket.id}>
          {shortId(ticket.id)}
        </span>
      </div>
    </div>
  );
}

/**
 * A dense, single-line ticket row used inside expanded terminal columns
 * (done/cancelled/…). These tickets are the least-actionable and usually the
 * most numerous, so they trade the full card for a compact row: a small
 * priority dot, the title (clipped to one line), and the short id. Clicking
 * still opens the full detail modal.
 */
function CompactTicketRow({ ticket, onOpen }: { ticket: ZanaTicket; onOpen: () => void }) {
  return (
    <div
      className="zana-compact-row"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${ticket.title} — click for details`}
    >
      {ticket.priority && (
        <span
          className={`zana-compact-prio zana-prio--${ticket.priority.toLowerCase()}`}
          title={ticket.priority}
          aria-hidden
        />
      )}
      <span className="zana-compact-title">{ticket.title}</span>
      <span className="zana-compact-id" title={ticket.id}>
        {shortId(ticket.id)}
      </span>
    </div>
  );
}

/**
 * A document reading-list entry. Unlike the ticket kanban card, this reads like
 * a library item: a doc icon + prominent wrapping title, a type label, a
 * plain-text excerpt derived from the markdown body, and a metadata row
 * (created date · author · linked-ticket count). Tags trail as subtle chips.
 */
function ArtifactCard({ artifact, onOpen }: { artifact: ZanaArtifact; onOpen: () => void }) {
  const created = fmtDateTime(artifact.createdAt);
  const excerpt = excerptFromMarkdown(artifact.content);
  const linked = artifact.linkedTickets.length;
  return (
    <article
      className="zana-doc-item"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${artifact.title} — click to read`}
    >
      <div className="zana-doc-icon" aria-hidden>
        <BookOpen size={18} />
      </div>
      <div className="zana-doc-body">
        <div className="zana-doc-head">
          <h3 className="zana-doc-title">{artifact.title}</h3>
          {artifact.type && <span className="zana-doc-type">{artifact.type}</span>}
        </div>
        {excerpt && <p className="zana-doc-excerpt">{excerpt}</p>}
        <div className="zana-doc-meta">
          {created && (
            <span className="zana-doc-meta-item">
              <CalendarRange size={11} aria-hidden /> {created}
            </span>
          )}
          {artifact.createdBy && (
            <span className="zana-doc-meta-item">
              <User size={11} aria-hidden /> {artifact.createdBy}
            </span>
          )}
          {linked > 0 && (
            <span className="zana-doc-meta-item zana-doc-linked" title="Linked tickets">
              <Link2 size={11} aria-hidden /> {linked} linked {linked === 1 ? 'ticket' : 'tickets'}
            </span>
          )}
        </div>
        {artifact.tags.length > 0 && (
          <div className="zana-doc-tags">
            {artifact.tags.slice(0, 5).map((t) => (
              <span key={t} className="zana-label-chip">
                <Tag size={9} aria-hidden /> {t}
              </span>
            ))}
            {artifact.tags.length > 5 && (
              <span className="gus-chip">+{artifact.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ── Profiles gallery ───────────────────────────────────────────────────────

/**
 * The Profiles view: a count summary (total · built-in · workspace) above a
 * gallery of profile cards, grouped by category with section headers. The
 * backend returns ALL profiles (workspace + built-in) already sorted, so we keep
 * that order and just bucket by category for the headers. Clicking a card opens
 * the profile detail. Read-only.
 */
function ProfilesView({
  profiles,
  tickets,
  onOpen
}: {
  profiles: ZanaProfile[];
  tickets: ZanaTicket[];
  onOpen: (profile: ZanaProfile) => void;
}) {
  // How many tickets each profile is assigned, for a card badge.
  const assignedByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets) {
      if (t.assigneeProfileId) m.set(t.assigneeProfileId, (m.get(t.assigneeProfileId) ?? 0) + 1);
    }
    return m;
  }, [tickets]);

  const builtinCount = profiles.filter((p) => p.origin === 'builtin').length;
  const workspaceCount = profiles.filter((p) => p.origin === 'workspace').length;

  // Group into category buckets, preserving the backend's sort order both for
  // the categories (first-seen order) and the profiles within each.
  const groups = useMemo(() => {
    const map = new Map<string, ZanaProfile[]>();
    for (const p of profiles) {
      const key = p.category && p.category.trim() ? p.category : 'Uncategorized';
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return [...map.entries()];
  }, [profiles]);

  if (profiles.length === 0) {
    return (
      <div className="zana-profiles-view">
        <div className="gus-column-empty">
          No profiles found. Profiles live in <code>~/.zana/profiles/</code> plus Zana's built-ins.
        </div>
      </div>
    );
  }

  return (
    <div className="zana-profiles-view">
      <div className="zana-profiles-summary">
        <strong>{profiles.length}</strong> {profiles.length === 1 ? 'profile' : 'profiles'}
        {builtinCount > 0 && (
          <>
            {' · '}
            {builtinCount} built-in
          </>
        )}
        {workspaceCount > 0 && (
          <>
            {' · '}
            <span className="zana-profiles-summary-ws">{workspaceCount} workspace</span>
          </>
        )}
      </div>

      {groups.map(([category, items]) => (
        <section key={category} className="zana-profile-group">
          {groups.length > 1 && (
            <div className="zana-profile-group-head">
              <span className="zana-profile-group-title">{category}</span>
              <span className="zana-profile-group-count">{items.length}</span>
            </div>
          )}
          <div className="zana-profile-grid">
            {items.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                assignedCount={assignedByProfile.get(p.id) ?? 0}
                onOpen={() => onOpen(p)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One profile card in the gallery: icon, name, category chip, origin badge, clamped description. */
function ProfileCard({
  profile,
  assignedCount,
  onOpen
}: {
  profile: ZanaProfile;
  assignedCount: number;
  onOpen: () => void;
}) {
  const isWorkspace = profile.origin === 'workspace';
  return (
    <article
      className="zana-profile-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${profile.displayName} — click for details`}
    >
      <div className="zana-profile-card-top">
        <span className="zana-profile-card-icon" aria-hidden>
          {profile.icon ?? '🤖'}
        </span>
        <div className="zana-profile-card-id">
          <h3 className="zana-profile-card-name">{profile.displayName}</h3>
          {profile.category && <span className="zana-profile-cat">{profile.category}</span>}
        </div>
        <span
          className={`zana-profile-origin zana-profile-origin--${profile.origin}`}
          title={isWorkspace ? 'Workspace profile' : 'Zana built-in profile'}
        >
          {isWorkspace ? 'Workspace' : 'Built-in'}
        </span>
      </div>
      {profile.description && (
        <p className="zana-profile-card-desc">{profile.description}</p>
      )}
      <div className="zana-profile-card-meta">
        {profile.model && (
          <span className="zana-label-chip">{profile.model}</span>
        )}
        {assignedCount > 0 && (
          <span className="gus-chip" title="Tickets assigned to this profile">
            {assignedCount} assigned
          </span>
        )}
      </div>
    </article>
  );
}
