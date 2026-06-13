/**
 * Agents tab — read-only catalog of behavior contracts (`cu agents ls`). The
 * agent's `allowedTools` is the security boundary, so it's surfaced as chips.
 * Scopes to the active project's repo when one is selected (merged user + repo
 * scope), matching what a session launched there would actually see.
 *
 * Agent-groups are shown beneath as a second, lighter list — they bundle agents
 * by name and carry no behavior of their own.
 */
import { useMemo, useState } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { Bot, Boxes } from 'lucide-react';
import { CatalogShell } from './CatalogShell.js';
import { CatalogRow } from './CatalogRow.js';
import { CuDetailModal, type DetailKind } from './CuDetailModal.js';
import { useCatalog } from './useCatalog.js';
import type { CuAgent, CuAgentGroup } from '../shared/types.js';

export function CuAgentsTab({ host }: { host: ModuleHost }) {
  const repoPath = useMemo(() => host.getActiveProject()?.path, [host]);
  const agents = useCatalog<CuAgent>(host, 'listAgents', repoPath);
  const groups = useCatalog<CuAgentGroup>(host, 'listAgentGroups');
  const [detail, setDetail] = useState<{ kind: DetailKind; name: string } | null>(null);

  return (
    <div className="cu-agents-tab">
      <CatalogShell
        title="agents"
        count={agents.data.length}
        loading={agents.loading}
        error={agents.error}
        emptyLabel="No agents. Create one with `cu agents save`."
        onReload={agents.reload}
      >
        {agents.data.map((a) => (
          <CatalogRow
            key={`${a.scope ?? 'user'}:${a.name}`}
            icon={<Bot size={13} className="cu-catalog-icon" aria-hidden />}
            name={a.name}
            description={a.description}
            badge={a.scope === 'repo' ? <span className="cu-chip cu-chip--scope">repo</span> : undefined}
            onOpen={() => setDetail({ kind: 'agent', name: a.name })}
          >
            {a.archetype && <span className="cu-chip">{a.archetype}</span>}
            {a.model && <span className="cu-chip cu-chip--model">{a.model}</span>}
            {a.allowedTools && a.allowedTools.length > 0 && (
              <span className="cu-chip cu-chip--tools" title={a.allowedTools.join(', ')}>
                {a.allowedTools.length} tools
              </span>
            )}
          </CatalogRow>
        ))}
      </CatalogShell>

      {groups.data.length > 0 && (
        <CatalogShell
          title="agent groups"
          count={groups.data.length}
          loading={groups.loading}
          error={groups.error}
          emptyLabel="No agent groups."
          onReload={groups.reload}
        >
          {groups.data.map((g) => (
            <CatalogRow
              key={g.name}
              icon={<Boxes size={13} className="cu-catalog-icon" aria-hidden />}
              name={g.name}
              description={g.description}
              onOpen={() => setDetail({ kind: 'agent-group', name: g.name })}
            >
              {g.coordinator && <span className="cu-chip">coord: {g.coordinator}</span>}
              {g.members && g.members.length > 0 && (
                <span className="cu-chip" title={g.members.join(', ')}>
                  {g.members.length} members
                </span>
              )}
            </CatalogRow>
          ))}
        </CatalogShell>
      )}

      {detail && (
        <CuDetailModal
          host={host}
          kind={detail.kind}
          name={detail.name}
          repoPath={detail.kind === 'agent' ? repoPath : undefined}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
