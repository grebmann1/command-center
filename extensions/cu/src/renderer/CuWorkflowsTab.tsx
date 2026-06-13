/**
 * Workflows tab — saved multi-node DAGs (`cu workflow ls`), each runnable
 * against the active project (`cu workflow run <name> --repo <path>`), plus a
 * recent-runs list (`cu workflow runs`).
 *
 * "Run" requires an active project (the workflow needs a `--repo`); the button
 * disables and explains when none is selected.
 */
import { useMemo, useState } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { Workflow, Play, Loader2, History } from 'lucide-react';
import { CatalogShell } from './CatalogShell.js';
import { CatalogRow } from './CatalogRow.js';
import { CuDetailModal } from './CuDetailModal.js';
import { useCatalog } from './useCatalog.js';
import type { CuWorkflow, CuWorkflowRun, CuRunResult } from '../shared/types.js';

export function CuWorkflowsTab({ host }: { host: ModuleHost }) {
  const project = useMemo(() => host.getActiveProject(), [host]);
  const workflows = useCatalog<CuWorkflow>(host, 'listWorkflows');
  const runs = useCatalog<CuWorkflowRun>(host, 'listWorkflowRuns');
  const [running, setRunning] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const runWorkflow = async (name: string) => {
    if (!project) {
      host.toast('Open a project to run a workflow.', 'error');
      return;
    }
    setRunning(name);
    try {
      const res = await host.call<CuRunResult>('runWorkflow', name, project.path);
      host.toast(`Started workflow ${name}${res?.sessionId ? ` (${res.sessionId})` : ''}.`);
      runs.reload();
    } catch (err) {
      host.toast(
        `Couldn't run ${name} — ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="cu-workflows-tab">
      <CatalogShell
        title="workflows"
        count={workflows.data.length}
        loading={workflows.loading}
        error={workflows.error}
        emptyLabel="No saved workflows. Create one with `cu workflow save`."
        onReload={workflows.reload}
      >
        {workflows.data.map((w) => (
          <CatalogRow
            key={w.name}
            icon={<Workflow size={13} className="cu-catalog-icon" aria-hidden />}
            name={w.name}
            description={w.description}
            badge={w.scope === 'repo' ? <span className="cu-chip cu-chip--scope">repo</span> : undefined}
            onOpen={() => setOpen(w.name)}
          >
            {typeof w.nodeCount === 'number' && <span className="cu-chip">{w.nodeCount} nodes</span>}
            <button
              type="button"
              className="cu-btn cu-btn--sm"
              onClick={() => void runWorkflow(w.name)}
              disabled={running === w.name || !project}
              title={project ? `Run in ${project.name}` : 'Open a project to run'}
            >
              {running === w.name ? <Loader2 size={12} className="cu-spin" /> : <Play size={12} />}
              <span>Run</span>
            </button>
          </CatalogRow>
        ))}
      </CatalogShell>

      {runs.data.length > 0 && (
        <CatalogShell
          title="recent runs"
          count={runs.data.length}
          loading={runs.loading}
          error={runs.error}
          emptyLabel="No runs yet."
          onReload={runs.reload}
        >
          {runs.data.map((r) => (
            <li key={r.token} className="cu-catalog-row">
              <div className="cu-catalog-main">
                <History size={13} className="cu-catalog-icon" aria-hidden />
                <span className="cu-catalog-name">{r.workflow ?? r.token}</span>
              </div>
              <div className="cu-catalog-meta">
                {r.status && (
                  <span
                    className={`cu-status-pill cu-status-pill--${(r.status ?? '').toLowerCase().replace(/[^a-z]+/g, '-')}`}
                  >
                    {r.status}
                  </span>
                )}
              </div>
            </li>
          ))}
        </CatalogShell>
      )}

      {open && (
        <CuDetailModal host={host} kind="workflow" name={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
