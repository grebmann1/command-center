/**
 * Profiles tab — read-only catalog of saved launch shapes (`cu profiles ls`).
 * A profile captures model + caps + permission mode + systemPrompt; tools live
 * on agents (ADR 0021), so they're not shown here.
 */
import { useState } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { Settings2 } from 'lucide-react';
import { CatalogShell } from './CatalogShell.js';
import { CatalogRow } from './CatalogRow.js';
import { CuDetailModal } from './CuDetailModal.js';
import { useCatalog } from './useCatalog.js';
import type { CuProfile } from '../shared/types.js';

export function CuProfilesTab({ host }: { host: ModuleHost }) {
  const { data, loading, error, reload } = useCatalog<CuProfile>(host, 'listProfiles');
  const [open, setOpen] = useState<string | null>(null);

  return (
    <CatalogShell
      title="profiles"
      count={data.length}
      loading={loading}
      error={error}
      emptyLabel="No saved profiles. Create one with `cu profiles save`."
      onReload={reload}
    >
      {data.map((p) => (
        <CatalogRow
          key={p.name}
          icon={<Settings2 size={13} className="cu-catalog-icon" aria-hidden />}
          name={p.name}
          description={p.description}
          onOpen={() => setOpen(p.name)}
        >
          {p.model && <span className="cu-chip cu-chip--model">{p.model}</span>}
          {p.permissionMode && <span className="cu-chip">{p.permissionMode}</span>}
          {typeof p.maxTurns === 'number' && <span className="cu-chip">{p.maxTurns} turns</span>}
          {typeof p.maxBudgetUsd === 'number' && (
            <span className="cu-chip">${p.maxBudgetUsd.toFixed(2)}</span>
          )}
        </CatalogRow>
      ))}
      {open && (
        <CuDetailModal host={host} kind="profile" name={open} onClose={() => setOpen(null)} />
      )}
    </CatalogShell>
  );
}
