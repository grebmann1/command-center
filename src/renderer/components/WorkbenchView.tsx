import { useEffect, useRef, useState } from 'react';
import type { Project } from '@shared/types';
import { bootWorkbench, mountProject } from '../vscode/workbenchSetup';

interface Props {
  project: Project;
}

// Experimental: full monaco-vscode-api workbench mounted into a single DIV.
// The workbench owns its own file tree, tabs, and editor, so this view
// replaces the ExplorerView's split layout entirely when active.
export function WorkbenchView({ project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'booting' | 'mounting' | 'ready'>('booting');
  const disableWorkbench = () => {
    try {
      localStorage.setItem('cc.workbenchEnabled', '0');
    } catch {
      // ignore storage failures
    }
    window.location.reload();
  };

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    (async () => {
      try {
        setPhase('booting');
        await bootWorkbench(container);
        if (cancelled) return;
        setPhase('mounting');
        await mountProject({ projectId: project.id, absRoot: project.path });
        if (cancelled) return;
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, project.path]);

  return (
    <div className="workbench-view">
      {error && (
        <div className="workbench-error">
          <p>Workbench failed to boot:</p>
          <pre>{error}</pre>
          <button className="btn" onClick={disableWorkbench}>
            Disable workbench and reload
          </button>
        </div>
      )}
      {!error && phase !== 'ready' && (
        <div className="workbench-status">
          {phase === 'booting' ? 'Starting workbench…' : 'Mounting project…'}
        </div>
      )}
      <div ref={containerRef} className="workbench-host" />
    </div>
  );
}
