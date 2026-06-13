import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData, useUi } from '../store';
import type { SplitLayout } from '../store';
import { TerminalView } from './TerminalView';

// Renders every live terminal session across every project as a single mount.
// Visibility is toggled per active tab so xterm scrollback is preserved when
// switching projects or tabs.
//
// This component is mounted ONCE at app level (TerminalSurfaceHost) and never
// unmounted, so its child xterm instances — and their scrollback — survive
// every nav change. To make the same live terminals appear inside whichever
// view owns column 3 (Workspace under `projects`, AgentsView under `agents`),
// the rendered grid is RE-PARENTED via createPortal into that view's anchor
// node. A portal moves only the DOM parent, not the React fiber position, so
// React does not remount — the one-xterm-per-session invariant holds.
//
// Pane placement (`area`) is one of:
//   'a' — primary (always present when any pane is shown)
//   'b' — vertical right / horizontal bottom / grid top-right
//   'c' — grid bottom-left (only when layout === 'grid')
//   'd' — grid bottom-right (only when layout === 'grid')
//   undefined — terminal is hidden (display:none, scrollback preserved)
type Area = 'a' | 'b' | 'c' | 'd';

const SLOT_AREA: Array<Area> = ['b', 'c', 'd'];

// DOM ids of the per-view portal anchors in column 3. Two distinct ids (not
// one shared id) because Workspace stays mounted — just CSS-hidden — under the
// Agents nav, so a single shared id would collide. The surface portals into
// whichever one the active nav selects.
export const PROJECTS_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-projects';
export const AGENTS_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-agents';

export function TerminalSurface() {
  const terminals = useData((s) => s.terminals);
  const nav = useUi((s) => s.nav);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const splitLayoutMap = useUi((s) => s.splitLayout);
  const splitTabIdsMap = useUi((s) => s.splitTabIds);
  const agentFocusId = useUi((s) => s.agentFocusId);

  // Fallback host: when no view anchor exists yet (first paint) or the active
  // nav isn't a terminal-hosting view, the grid lives here (hidden via CSS).
  const hostRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  // Resolve the portal target after layout so the active view's anchor (which
  // mounts in the same commit) is present. Re-resolve whenever nav changes.
  useLayoutEffect(() => {
    const anchorId =
      nav === 'projects'
        ? PROJECTS_TERMINAL_ANCHOR_ID
        : nav === 'agents'
          ? AGENTS_TERMINAL_ANCHOR_ID
          : null;
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    setTarget(anchor ?? hostRef.current);
  }, [nav]);

  // Build a tab-id → area map for whichever view owns the surface.
  const areaByTabId = new Map<string, Area>();
  let layout: SplitLayout = 'single';

  if (nav === 'agents') {
    // Agents view: a single focused session fills the pane. Bypasses the
    // project/tab selection entirely so a headless session can be shown
    // without un-hiding it.
    if (agentFocusId) areaByTabId.set(agentFocusId, 'a');
  } else if (nav === 'projects') {
    const activeTabId = selectedProjectId ? selectedTabId[selectedProjectId] : undefined;
    layout = (selectedProjectId && splitLayoutMap[selectedProjectId]) || 'single';
    const slotIds: Array<string | undefined> = selectedProjectId
      ? splitTabIdsMap[selectedProjectId] ?? []
      : [];
    if (activeTabId && selectedProjectId) {
      areaByTabId.set(activeTabId, 'a');
      if (layout !== 'single') {
        slotIds.forEach((id, i) => {
          if (!id || id === activeTabId) return;
          const area = SLOT_AREA[i];
          if (!area) return;
          // Don't overwrite if the same id is in multiple slots (shouldn't
          // happen, but be safe).
          if (!areaByTabId.has(id)) areaByTabId.set(id, area);
        });
      }
    }
  }
  // Any other nav: empty map — every terminal hidden (scrollback preserved).

  // Under Agents nav, area placement keys off agentFocusId (a global id), not
  // the per-project selection, so don't gate on `projectId === selected`.
  const projectScoped = nav === 'projects';

  const surface = (
    <div className={`terminal-surface layout-${layout}`} aria-hidden={!areaByTabId.size}>
      {Object.entries(terminals).flatMap(([projectId, sessions]) =>
        sessions.map((s) => {
          const area =
            !projectScoped || projectId === selectedProjectId
              ? areaByTabId.get(s.id)
              : undefined;
          return <TerminalView key={s.id} session={s} area={area} />;
        })
      )}
    </div>
  );

  return (
    <div ref={hostRef} className="terminal-surface-host">
      {target ? createPortal(surface, target) : surface}
    </div>
  );
}
