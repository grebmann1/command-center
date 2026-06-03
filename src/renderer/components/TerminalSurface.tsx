import { useData, useUi } from '../store';
import type { SplitLayout } from '../store';
import { TerminalView } from './TerminalView';

// Renders every live terminal session across every project as a single mount.
// Visibility is toggled per active tab so xterm scrollback is preserved when
// switching projects or tabs.
//
// Pane placement (`area`) is one of:
//   'a' — primary (always present when any pane is shown)
//   'b' — vertical right / horizontal bottom / grid top-right
//   'c' — grid bottom-left (only when layout === 'grid')
//   'd' — grid bottom-right (only when layout === 'grid')
//   undefined — terminal is hidden (display:none, scrollback preserved)
type Area = 'a' | 'b' | 'c' | 'd';

const SLOT_AREA: Array<Area> = ['b', 'c', 'd'];

export function TerminalSurface() {
  const terminals = useData((s) => s.terminals);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const splitLayoutMap = useUi((s) => s.splitLayout);
  const splitTabIdsMap = useUi((s) => s.splitTabIds);

  const activeTabId = selectedProjectId ? selectedTabId[selectedProjectId] : undefined;
  const layout: SplitLayout = (selectedProjectId && splitLayoutMap[selectedProjectId]) || 'single';
  const slotIds: Array<string | undefined> = selectedProjectId
    ? splitTabIdsMap[selectedProjectId] ?? []
    : [];

  // Build a tab-id → area map for the active project.
  const areaByTabId = new Map<string, Area>();
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

  return (
    <div className={`terminal-surface layout-${layout}`} aria-hidden={!selectedProjectId}>
      {Object.entries(terminals).flatMap(([projectId, sessions]) =>
        sessions.map((s) => {
          const area = projectId === selectedProjectId ? areaByTabId.get(s.id) : undefined;
          return <TerminalView key={s.id} session={s} area={area} />;
        })
      )}
    </div>
  );
}
