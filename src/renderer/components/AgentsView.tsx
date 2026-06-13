import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ExternalLink } from 'lucide-react';
import type { AgentState, TerminalSession } from '@shared/types';
import { useData, useUi, useAgentStatus } from '../store';
import { profileIcon } from '../util/profileIcon';
import { AGENTS_TERMINAL_ANCHOR_ID } from './TerminalSurface';

/**
 * The Agents section: a cross-project view of every live agent.
 *
 *  - AgentsListPane (column 2, rendered by ListPane) lists all agents grouped
 *    by liveness, with a live "running for X", a state dot, and badges.
 *  - AgentsView (column 3, this file's default export) frames the focused
 *    agent's LIVE terminal — the single app-level TerminalSurface portals its
 *    grid into the anchor here, so it's the same xterm (and scrollback) the
 *    Projects view uses. Clicking a background/scheduled agent peeks it here
 *    WITHOUT un-backgrounding; "Open in Projects" is the explicit graduation.
 */

interface AgentRow {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  state: AgentState;
}

// Display priority: who needs attention first. Mirrors AGENT_STATE_RANK in the
// store but ordered for a top-to-bottom list (most urgent first).
const STATE_RANK: Record<AgentState, number> = {
  blocked: 0,
  working: 1,
  idle: 2,
  done: 3,
  unknown: 4
};

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle'
};

/**
 * Flat, sorted list of every agent across all projects. Selectors return raw
 * store slices (stable refs); the derived array lives behind useMemo so we
 * don't trip zustand's re-render loop (see MEMORY zustand-selector-stable-ref).
 * Headless (background/scheduled) sessions are INCLUDED — peeking them is the
 * whole point. Exited sessions are included too; the list groups them out.
 */
function useAgentRows(): AgentRow[] {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const byId = useAgentStatus((s) => s.byId);

  return useMemo<AgentRow[]>(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    const out: AgentRow[] = [];
    for (const [projectId, list] of Object.entries(terminals)) {
      for (const session of list) {
        out.push({
          session,
          projectId,
          projectName: nameById.get(projectId) ?? 'Unknown',
          state: byId[session.id] ?? 'unknown'
        });
      }
    }
    out.sort((a, b) => {
      const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (r !== 0) return r;
      return a.session.title.localeCompare(b.session.title);
    });
    return out;
  }, [terminals, projects, byId]);
}

/** "12m", "1h 5m", "8s" — coarse, human, recomputed on the list's 1s tick. */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Column 2: the agent list ────────────────────────────────────────────────

export function AgentsListPane() {
  const rows = useAgentRows();
  const agentFocusId = useUi((s) => s.agentFocusId);
  const focusAgent = useUi((s) => s.focusAgent);

  // One timer for the whole list drives the live "running for X". A tick state
  // forces a re-render each second; durations are computed at render from
  // createdAt vs. now. Only mounted while the Agents list is shown.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const live = rows.filter((r) => r.session.status !== 'exited');
  const finished = rows.filter((r) => r.session.status === 'exited');
  const now = Date.now();

  const renderRow = (r: AgentRow) => {
    const { session: t } = r;
    const exited = t.status === 'exited';
    const active = t.id === agentFocusId;
    const dur = formatDuration(now - t.createdAt);
    return (
      <button
        key={t.id}
        className={`agents-row ${active ? 'active' : ''} ${exited ? 'exited' : ''}`}
        onClick={() => focusAgent(t)}
        aria-current={active ? 'true' : undefined}
        title={`${t.title} — ${r.projectName} · ${STATE_LABEL[r.state]}`}
      >
        <span className="agents-row-icon">{profileIcon(t.profile, 13)}</span>
        <span className="agents-row-text">
          <span className="agents-row-title-line">
            {!exited && <span className={`tab-agent-dot agent-${r.state}`} aria-hidden="true" />}
            <span className="agents-row-title">{t.title}</span>
          </span>
          <span className="agents-row-meta">
            <span className="agents-row-project">{r.projectName}</span>
            {!exited && <span className="agents-row-duration">{dur}</span>}
            {t.headless && <span className="agents-row-badge">Background</span>}
            {t.scheduled && <span className="agents-row-badge">Scheduled</span>}
            {exited && (
              <span className={`agents-row-badge ${t.exitCode ? 'bad' : ''}`}>
                {t.exitCode ? `Exited ${t.exitCode}` : 'Exited'}
              </span>
            )}
          </span>
        </span>
        {r.state === 'blocked' && <span className="agents-row-needs">Needs you</span>}
      </button>
    );
  };

  return (
    <section className="list-pane agents-list-pane">
      <header className="list-header">
        <h2>Agents</h2>
        {live.length > 0 && <span className="agents-count">{live.length}</span>}
      </header>
      <div className="list-body">
        {rows.length === 0 ? (
          <div className="agents-list-empty">
            <Bot size={20} aria-hidden="true" />
            <p>No agents yet</p>
            <span>Launch a Claude session in a project to see it here.</span>
          </div>
        ) : (
          <>
            {live.map(renderRow)}
            {finished.length > 0 && (
              <>
                <div className="agents-group-label">Recently finished</div>
                {finished.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ── Column 3: the focused agent's live terminal ─────────────────────────────

export function AgentsView() {
  const rows = useAgentRows();
  const agentFocusId = useUi((s) => s.agentFocusId);

  const focused = useMemo(
    () => rows.find((r) => r.session.id === agentFocusId) ?? null,
    [rows, agentFocusId]
  );

  // Dangling-focus guard: if agentFocusId points at a session that no longer
  // exists (closed / exited-and-reaped / project removed), clear it so the
  // view falls back to the empty state instead of framing a ghost. Cheaper and
  // more robust than threading clears through every store mutation.
  const focusAgentRef = useRef(agentFocusId);
  focusAgentRef.current = agentFocusId;
  useEffect(() => {
    if (agentFocusId && !rows.some((r) => r.session.id === agentFocusId)) {
      useUi.setState({ agentFocusId: null });
    }
  }, [rows, agentFocusId]);

  const openInProjects = () => {
    if (!focused) return;
    const ui = useUi.getState();
    ui.setNav('projects');
    ui.selectProject(focused.projectId);
    // The one intentional un-backgrounding: graduate the peeked session to a
    // real Projects tab. restoreTerminal un-hides a headless session AND
    // selects it; for an already-visible session it just selects.
    if (focused.session.headless) {
      void useData.getState().restoreTerminal(focused.session.id, focused.projectId);
    } else {
      ui.selectTab(focused.projectId, focused.session.id);
    }
  };

  return (
    <main className="agents-view">
      <div className="agents-terminal-header">
        {focused ? (
          <>
            <span className={`tab-agent-dot agent-${focused.state}`} aria-hidden="true" />
            <span className="agents-terminal-title">{focused.session.title}</span>
            <span className="agents-terminal-project">{focused.projectName}</span>
            {focused.session.headless && (
              <span className="agents-row-badge">Background</span>
            )}
            <span className="grow" />
            <button
              type="button"
              className="agents-open-projects"
              onClick={openInProjects}
              title="Open this agent as a tab in Projects"
            >
              <ExternalLink size={13} />
              <span>Open in Projects</span>
            </button>
          </>
        ) : (
          <span className="agents-terminal-title muted">Agents</span>
        )}
      </div>
      <div
        id={AGENTS_TERMINAL_ANCHOR_ID}
        className="agents-terminal-frame"
        aria-hidden={!focused}
      >
        {/* The app-level TerminalSurface portals the focused agent's live
            terminal in here when nav === 'agents'. */}
        {!focused && (
          <div className="agents-empty">
            <Bot size={28} aria-hidden="true" />
            <h3>Select an agent</h3>
            <p>Pick an agent on the left to watch it live and jump in.</p>
          </div>
        )}
      </div>
    </main>
  );
}
