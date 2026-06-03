import { useData, useUi } from '../store';
import { TerminalView } from './TerminalView';

// Renders every live terminal session across every project as a single mount.
// Visibility is toggled per active tab so xterm scrollback is preserved when
// switching projects or tabs.
export function TerminalSurface() {
  const terminals = useData((s) => s.terminals);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const activeTabId = selectedProjectId ? selectedTabId[selectedProjectId] : undefined;

  return (
    <div className="terminal-surface" aria-hidden={!selectedProjectId}>
      {Object.entries(terminals).flatMap(([projectId, sessions]) =>
        sessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            active={projectId === selectedProjectId && s.id === activeTabId}
          />
        ))
      )}
    </div>
  );
}
