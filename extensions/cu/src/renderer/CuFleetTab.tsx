/**
 * Fleet tab — the live sessions board. Owns the fetch of `daemonStatus` +
 * `listSessions` + `dashboard`, the Live-poll toggle, grouped session rows with
 * optimistic per-session actions (pause/resume/unstick/kill), the post-mortem
 * modal, and the launch modal. Publishes the running-session count to the host
 * cache for the nav badge.
 *
 * CuPanel mounts this only when the daemon is up and the CLI present — the
 * not-installed / daemon-down / needs-relaunch gating lives one level up. So the
 * states here are just: loading · empty · error · ready.
 *
 * Decoupling: talks to the host ONLY through `ModuleHost`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Rocket,
  Play,
  Pause,
  Square,
  Zap,
  AlertCircle,
  Radio,
  FileText,
  Loader2
} from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { CuPostMortemModal } from './CuPostMortemModal.js';
import { CuLaunchModal } from './CuLaunchModal.js';
import {
  type CuSession,
  type CuDaemonStatus,
  type CuDashboard,
  type CuActionResult,
  isRunning,
  isPaused,
  isTerminal,
  sessionLabel,
  repoBasename,
  RUNNING_COUNT_CACHE_KEY,
  FLEET_CACHE_KEY
} from '../shared/types.js';

const STORAGE_GROUP_KEY = 'groupBy';
const STORAGE_LIVE_KEY = 'livePolling';
const POLL_INTERVAL_MS = 10_000;

type GroupBy = 'repo' | 'status';

/**
 * Module-scoped cache surviving panel unmount (the host only mounts the panel
 * while cu's nav is active). Seeds React state on remount so reopening Fleet is
 * instant rather than flashing empty. Lives outside the component on purpose.
 */
interface FleetSnapshot {
  daemon: CuDaemonStatus | null;
  sessions: CuSession[];
  dashboard: CuDashboard | null;
}
let snapshot: FleetSnapshot | null = null;

interface Props {
  host: ModuleHost;
  /**
   * Called when a capability fails in a way that means the WHOLE panel should
   * re-evaluate its phase (CLI vanished, daemon went down, child not live).
   * CuPanel owns that gating; the Fleet tab just signals "re-check at the top".
   */
  onFatal: (message: string) => void;
}

export function CuFleetTab({ host, onFatal }: Props) {
  const [daemon, setDaemon] = useState<CuDaemonStatus | null>(snapshot?.daemon ?? null);
  const [sessions, setSessions] = useState<CuSession[]>(snapshot?.sessions ?? []);
  const [dashboard, setDashboard] = useState<CuDashboard | null>(snapshot?.dashboard ?? null);
  const [groupBy, setGroupBy] = useState<GroupBy>('repo');
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmKill, setConfirmKill] = useState<string | null>(null);
  const [postMortemFor, setPostMortemFor] = useState<CuSession | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);

  const fetching = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      host.storage.get<GroupBy>(STORAGE_GROUP_KEY),
      host.storage.get<boolean>(STORAGE_LIVE_KEY)
    ]).then(([g, l]) => {
      if (!alive) return;
      if (g === 'status' || g === 'repo') setGroupBy(g);
      if (l) setLive(true);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);

  const publishBadge = useCallback(
    (list: CuSession[]) => {
      const count = list.filter((s) => isRunning(s.status)).length;
      host.cache.set(RUNNING_COUNT_CACHE_KEY, count || null);
    },
    [host]
  );

  /** Does an error mean "kick back up to CuPanel's gating"? */
  const isFatal = (msg: string) => {
    const m = msg.toLowerCase();
    return (
      m.includes('not found') ||
      m.includes('not installed') ||
      m.includes('unexpectedly') ||
      m.includes('unknown module') ||
      m.includes('no such module')
    );
  };

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const status = await host.call<CuDaemonStatus>('daemonStatus');
      setDaemon(status);
      setError(null);

      if (!status.running) {
        // Daemon went down while we were on this tab — bounce to CuPanel gating.
        publishBadge([]);
        onFatal('daemon down');
        return;
      }

      const [list, dash] = await Promise.all([
        host.call<CuSession[]>('listSessions'),
        host.call<CuDashboard>('dashboard').catch(() => null)
      ]);
      setSessions(list);
      setDashboard(dash);
      publishBadge(list);
      host.cache.set(FLEET_CACHE_KEY, list);
      snapshot = { daemon: status, sessions: list, dashboard: dash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isFatal(msg)) {
        publishBadge([]);
        onFatal(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      fetching.current = false;
    }
    // onFatal is stable (useCallback in parent); publishBadge depends on host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, publishBadge]);

  useEffect(() => {
    if (!hydrated) return;
    void load();
  }, [hydrated, load]);

  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [live, load]);

  const toggleLive = () => {
    setLive((v) => {
      const next = !v;
      void host.storage.set(STORAGE_LIVE_KEY, next);
      return next;
    });
  };

  const selectGroupBy = (g: GroupBy) => {
    setGroupBy(g);
    void host.storage.set(STORAGE_GROUP_KEY, g);
  };

  const setRowBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const patchStatus = useCallback((id: string, status: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }, []);

  const runAction = useCallback(
    async (
      session: CuSession,
      capability: 'pause' | 'resume' | 'unstick' | 'kill',
      optimisticStatus?: string
    ) => {
      const { id, status: fromStatus } = session;
      setRowBusy(id, true);
      setConfirmKill(null);
      if (optimisticStatus) patchStatus(id, optimisticStatus);
      try {
        const res = await host.call<CuActionResult>(capability, id);
        if (!res?.ok) {
          if (optimisticStatus && fromStatus) patchStatus(id, fromStatus);
          host.toast(
            `${sessionLabel(session)}: ${capability} failed${res?.message ? ` — ${res.message}` : ''}`,
            'error'
          );
        } else {
          host.toast(`${sessionLabel(session)}: ${capability} ok.`);
          void load();
        }
      } catch (err) {
        if (optimisticStatus && fromStatus) patchStatus(id, fromStatus);
        host.toast(
          `${sessionLabel(session)}: ${capability} failed — ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      } finally {
        setRowBusy(id, false);
      }
    },
    [host, patchStatus, load]
  );

  const groups = useMemo(() => {
    const map = new Map<string, CuSession[]>();
    const rank = (s: CuSession) => (isRunning(s.status) ? 0 : isPaused(s.status) ? 1 : 2);
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b));
    for (const s of sorted) {
      const key = groupBy === 'repo' ? repoBasename(s.repoPath) : s.status ?? 'unknown';
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return Array.from(map.entries());
  }, [sessions, groupBy]);

  const runningCount = useMemo(() => sessions.filter((s) => isRunning(s.status)).length, [sessions]);

  const isEmpty = daemon?.running && sessions.length === 0 && !loading && !error;
  const isLoadingFirst = loading && sessions.length === 0 && !error;

  return (
    <div className="cu-fleet">
      <div className="cu-subbar">
        <div className="cu-subbar-left">
          {dashboard && <DashboardRollup dashboard={dashboard} running={runningCount} />}
        </div>
        <div className="cu-subbar-right">
          <button
            type="button"
            className={`cu-live-toggle ${live ? 'active' : ''}`}
            onClick={toggleLive}
            title={live ? 'Live polling on (every 10s)' : 'Live polling off'}
            aria-pressed={live}
          >
            <Radio size={13} className={live ? 'cu-pulse' : undefined} />
            <span>Live</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'cu-spin' : undefined} />
          </button>
          <button
            type="button"
            className="cu-btn cu-btn--primary cu-launch-cta"
            onClick={() => setLaunchOpen(true)}
            title="Launch a new session"
          >
            <Rocket size={13} />
            <span>Launch</span>
          </button>
        </div>
      </div>

      <div className="cu-fleet-body">
        {error && (
          <div className="cu-error" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>Couldn't reach the fleet.</strong>
              <p>{error}</p>
              <button type="button" className="cu-btn" onClick={() => void load()}>
                <RefreshCw size={13} /> <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {isLoadingFirst && (
          <div className="cu-loading">
            <Loader2 size={16} className="cu-spin" /> Connecting to the fleet…
          </div>
        )}

        {isEmpty && (
          <div className="cu-empty-state">
            <Rocket size={32} aria-hidden />
            <strong>No sessions yet</strong>
            <p>The daemon is up but there are no sessions. Launch one to get started.</p>
            <button type="button" className="cu-btn cu-btn--primary" onClick={() => setLaunchOpen(true)}>
              <Rocket size={13} /> <span>Launch session</span>
            </button>
          </div>
        )}

        {!error && sessions.length > 0 && (
          <>
            <div className="cu-toolbar">
              <div className="cu-group-switch" role="tablist" aria-label="Group sessions by">
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupBy === 'repo'}
                  className={`cu-group-tab ${groupBy === 'repo' ? 'active' : ''}`}
                  onClick={() => selectGroupBy('repo')}
                >
                  By repo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupBy === 'status'}
                  className={`cu-group-tab ${groupBy === 'status' ? 'active' : ''}`}
                  onClick={() => selectGroupBy('status')}
                >
                  By status
                </button>
              </div>
              <span className="cu-count-pill">
                {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>

            <div className="cu-groups">
              {groups.map(([key, rows]) => (
                <div key={key} className="cu-group">
                  <div className="cu-group-head">
                    <span className="cu-group-title">{key}</span>
                    <span className="cu-group-count">{rows.length}</span>
                  </div>
                  <ul className="cu-session-list">
                    {rows.map((s) => (
                      <CuSessionRow
                        key={s.id}
                        session={s}
                        busy={busy.has(s.id)}
                        confirmingKill={confirmKill === s.id}
                        onAction={runAction}
                        onPostMortem={() => setPostMortemFor(s)}
                        onAskKill={() => setConfirmKill(s.id)}
                        onCancelKill={() => setConfirmKill(null)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {postMortemFor && (
        <CuPostMortemModal host={host} session={postMortemFor} onClose={() => setPostMortemFor(null)} />
      )}
      {launchOpen && (
        <CuLaunchModal host={host} onClose={() => setLaunchOpen(false)} onLaunched={() => void load()} />
      )}
    </div>
  );
}

function DashboardRollup({ dashboard, running }: { dashboard: CuDashboard; running: number }) {
  const cost = dashboard.totalCostUsd;
  return (
    <div className="cu-rollup" title="Fleet rollup">
      <span className="cu-rollup-item">
        <Zap size={11} aria-hidden /> {running} running
      </span>
      {typeof dashboard.totalSessions === 'number' && (
        <span className="cu-rollup-item">{dashboard.totalSessions} total</span>
      )}
      {typeof cost === 'number' && <span className="cu-rollup-item">${cost.toFixed(2)}</span>}
    </div>
  );
}

interface RowProps {
  session: CuSession;
  busy: boolean;
  confirmingKill: boolean;
  onAction: (
    session: CuSession,
    capability: 'pause' | 'resume' | 'unstick' | 'kill',
    optimisticStatus?: string
  ) => void;
  onPostMortem: () => void;
  onAskKill: () => void;
  onCancelKill: () => void;
}

function CuSessionRow({
  session,
  busy,
  confirmingKill,
  onAction,
  onPostMortem,
  onAskKill,
  onCancelKill
}: RowProps) {
  const running = isRunning(session.status);
  const paused = isPaused(session.status);
  const terminal = isTerminal(session.status);
  const statusKey = (session.status ?? 'unknown').toLowerCase().replace(/[^a-z]+/g, '-');

  return (
    <li className="cu-session-row">
      <div className="cu-session-main">
        <span className="cu-session-name" title={session.id}>
          {sessionLabel(session)}
        </span>
        <span className={`cu-status-pill cu-status-pill--${statusKey}`}>
          {session.status ?? 'unknown'}
        </span>
        {session.title && <span className="cu-session-title">{session.title}</span>}
      </div>
      <div className="cu-session-meta">
        {typeof session.turns === 'number' && (
          <span className="cu-chip" title="Turns">
            {session.turns} turns
          </span>
        )}
        {typeof session.costUsd === 'number' && (
          <span className="cu-chip" title="Cost">
            ${session.costUsd.toFixed(2)}
          </span>
        )}
        {session.profile && <span className="cu-chip cu-chip--profile">{session.profile}</span>}
        {session.model && <span className="cu-chip cu-chip--model">{session.model}</span>}
      </div>
      <div className="cu-session-actions">
        {busy && <Loader2 size={13} className="cu-spin" aria-label="Working" />}
        {!busy && confirmingKill && (
          <span className="cu-confirm">
            <span>Kill?</span>
            <button
              type="button"
              className="cu-btn cu-btn--danger cu-btn--sm"
              onClick={() => onAction(session, 'kill')}
            >
              Yes
            </button>
            <button type="button" className="cu-btn cu-btn--sm" onClick={onCancelKill}>
              No
            </button>
          </span>
        )}
        {!busy && !confirmingKill && (
          <>
            {running && (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  title="Pause"
                  aria-label="Pause"
                  onClick={() => onAction(session, 'pause', 'paused')}
                >
                  <Pause size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Unstick (nudge a stalled session)"
                  aria-label="Unstick"
                  onClick={() => onAction(session, 'unstick')}
                >
                  <Zap size={13} />
                </button>
              </>
            )}
            {paused && (
              <button
                type="button"
                className="icon-btn"
                title="Resume"
                aria-label="Resume"
                onClick={() => onAction(session, 'resume', 'running')}
              >
                <Play size={13} />
              </button>
            )}
            {terminal ? (
              <button
                type="button"
                className="icon-btn"
                title="Post-mortem"
                aria-label="Post-mortem"
                onClick={onPostMortem}
              >
                <FileText size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn cu-icon-danger"
                title="Kill"
                aria-label="Kill"
                onClick={onAskKill}
              >
                <Square size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
