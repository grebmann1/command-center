/**
 * Renders the active app-module's panel. Reads the current nav, looks up the
 * matching module in the registry, and mounts its panel with a per-module
 * `ModuleHost`. Renders nothing when nav points at a core panel.
 *
 * Hosts are memoised per module id so a module's panel keeps a stable host
 * reference across re-renders (its effects depend on `host`).
 */

import { useMemo } from 'react';
import { useUi } from '../store';
import { getModule } from './index';
import { createModuleHost } from './host';
import type { ModuleHost } from '@shared/module-api';

export function ModulePanelHost() {
  const nav = useUi((s) => s.nav);
  const mod = getModule(nav);

  // Build (and cache) the host for whichever module is active. The map
  // persists across renders so each module sees one stable host instance.
  const host = useMemo<ModuleHost | null>(() => (mod ? getHost(mod.id) : null), [mod]);

  if (!mod || !host) return null;
  const Panel = mod.panel;
  return <Panel host={host} />;
}

const hosts = new Map<string, ModuleHost>();
function getHost(moduleId: string): ModuleHost {
  let h = hosts.get(moduleId);
  if (!h) {
    h = createModuleHost(moduleId);
    hosts.set(moduleId, h);
  }
  return h;
}
