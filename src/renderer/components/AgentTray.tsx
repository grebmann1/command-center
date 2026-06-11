import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type { AgentState, TerminalSession } from '@shared/types';
import { useData, useUi, useAgentStatus } from '../store';

/**
 * Which agent states the tray surfaces, in display-priority order. We show only
 * the two states that actually want the user's attention:
 *   blocked — agent is waiting on the user (permission prompt / question — the
 *             Notification-hook state), so it's listed first and pulses red.
 *   working — agent is actively running, so you can hop in and watch.
 * `done`/`idle`/`unknown` are deliberately excluded — they aren't "running" and
 * don't need you, so they'd just be noise here.
 */
const TRAY_STATES: readonly AgentState[] = ['blocked', 'working'];
const STATE_RANK: Record<string, number> = { blocked: 0, working: 1 };

const STATE_LABEL: Record<string, string> = {
  blocked: 'Needs you',
  working: 'Working'
};

interface TrayAgent {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  state: AgentState;
}

/**
 * Bottom-of-sidebar tray listing every agent that is currently running or
 * waiting for user interaction, across ALL projects. One click jumps straight
 * to that session's tab (un-hiding it first if it's a background/scheduled run),
 * mirroring the inbox "focus session" path so the behavior is consistent.
 *
 * Headless (background/scheduler) sessions are intentionally included — a
 * blocked scheduled run is exactly the kind of thing you want surfaced here.
 */
export function AgentTray() {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const byId = useAgentStatus((s) => s.byId);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  // Derive the flat, sorted list once per relevant change. Selectors above
  // return raw store slices (stable refs); the fresh array lives behind useMemo
  // so we don't trip zustand's re-render loop (see MEMORY zustand-selector-stable-ref).
  const agents = useMemo<TrayAgent[]>(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    const out: TrayAgent[] = [];
    for (const [projectId, list] of Object.entries(terminals)) {
      for (const session of list) {
        const state = byId[session.id] ?? 'unknown';
        if (!TRAY_STATES.includes(state)) continue;
        out.push({
          session,
          projectId,
          projectName: nameById.get(projectId) ?? 'Unknown',
          state
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

  const blockedCount = agents.reduce((n, a) => n + (a.state === 'blocked' ? 1 : 0), 0);

  const focus = (a: TrayAgent) => {
    const ui = useUi.getState();
    ui.setNav('projects');
    ui.selectProject(a.projectId);
    // restoreTerminal un-hides a headless (background/scheduled) session AND
    // selects it; for an already-visible session it just selects. selectTab
    // alone silently no-ops on a headless id — same reasoning as App.tsx's
    // tray-focus handler.
    if (a.session.headless) {
      void useData.getState().restoreTerminal(a.session.id, a.projectId);
    } else {
      ui.selectTab(a.projectId, a.session.id);
    }
  };

  if (agents.length === 0) return null;

  // Collapsed rail: a single activity icon carrying the count. Red when any
  // agent is blocked (needs you), otherwise muted. Clicking expands the rail so
  // the full list is reachable.
  if (collapsed) {
    const title =
      blockedCount > 0
        ? `${agents.length} active · ${blockedCount} need you`
        : `${agents.length} active`;
    return (
      <div className="agent-tray collapsed">
        <button
          className="nav-item agent-tray-rail-btn"
          onClick={toggleSidebar}
          title={title}
          aria-label={title}
        >
          <span className="nav-item-icon">
            <Activity size={16} />
          </span>
          <span
            className={`nav-badge ${blockedCount > 0 ? 'nav-badge--blocked' : 'nav-badge--muted'}`}
            aria-hidden="true"
          >
            {agents.length > 99 ? '99+' : agents.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="agent-tray">
      <div className="agent-tray-header">
        <span className="nav-section-label agent-tray-label">Agents</span>
        <span className="agent-tray-count">{agents.length}</span>
      </div>
      <div className="agent-tray-list">
        {agents.map((a) => (
          <button
            key={a.session.id}
            className="agent-tray-row"
            onClick={() => focus(a)}
            title={`${a.session.title} — ${a.projectName} · ${STATE_LABEL[a.state]}`}
          >
            <span className={`tab-agent-dot agent-${a.state}`} aria-hidden="true" />
            <span className="agent-tray-row-text">
              <span className="agent-tray-row-title">{a.session.title}</span>
              <span className="agent-tray-row-meta">{a.projectName}</span>
            </span>
            {a.state === 'blocked' && (
              <span className="agent-tray-needs-you">{STATE_LABEL[a.state]}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
