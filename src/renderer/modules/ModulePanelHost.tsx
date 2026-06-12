/**
 * Renders the active app-module's panel. Reads the current nav, looks up the
 * matching module in the MERGED registry (built-ins + runtime-loaded
 * extensions), and mounts its panel with a per-module `ModuleHost`. Renders
 * nothing when nav points at a core panel.
 *
 * Hosts are memoised per module id so a module's panel keeps a stable host
 * reference across re-renders (its effects depend on `host`). The cache is
 * evicted via `evictHost` when an extension is disabled/removed so a later
 * re-enable gets a fresh host (and the stale one is dropped).
 *
 * Every mounted panel is wrapped in an `ErrorBoundary` so a runtime extension
 * that throws while rendering is contained to its own slot and never crashes
 * the shell — mirroring the import/activate isolation in `loader.ts`.
 */

import { useMemo } from 'react';
import { useUi } from '../store';
import { useMergedModules } from './index';
import { createModuleHost, clearModuleCache } from './host';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { ModuleHost } from '@shared/module-api';

export function ModulePanelHost() {
  const nav = useUi((s) => s.nav);
  const modules = useMergedModules();
  const mod = useMemo(() => modules.find((m) => m.id === nav), [modules, nav]);

  // Build (and cache) the host for whichever module is active. The map
  // persists across renders so each module sees one stable host instance.
  const host = useMemo<ModuleHost | null>(() => (mod ? getHost(mod.id) : null), [mod]);

  if (!mod || !host) return null;

  // As of the Phase 2 contract `panel` is optional: a module may contribute
  // only `commands` and/or a `navBadge`. Such a module still owns a nav entry
  // (for its badge + palette commands), so selecting it must not crash —
  // ListPane has already bowed out of the content area for any merged module.
  // We render a tasteful placeholder rather than nothing so the empty content
  // area doesn't read as a broken view.
  const Panel = mod.panel;
  if (!Panel) {
    return (
      <div className="module-no-panel" role="status">
        <p>{mod.title} has no view of its own.</p>
        <p className="module-no-panel-hint">
          It contributes commands and badges — open the command palette (⌘K) to use them.
        </p>
      </div>
    );
  }

  return (
    <ErrorBoundary key={mod.id}>
      <Panel host={host} />
    </ErrorBoundary>
  );
}

const hosts = new Map<string, ModuleHost>();

/**
 * The single cached `ModuleHost` for a module id, created on first use. Shared
 * with the extension loader so a runtime panel's `activate()` closes over the
 * SAME host instance that ModulePanelHost later injects as the `host` prop —
 * one host per module, so `evictHost` actually releases what the panel holds.
 */
export function getHost(moduleId: string): ModuleHost {
  let h = hosts.get(moduleId);
  if (!h) {
    h = createModuleHost(moduleId);
    hosts.set(moduleId, h);
  }
  return h;
}

/**
 * Drop a module's cached host AND its in-memory `host.cache`. Called by the
 * extension loader when an extension is disabled or removed, so its host (and
 * any closed-over state) is released and a later re-enable builds a fresh one.
 * Clearing the cache here keeps the cache lifecycle matched to the host's — a
 * removed extension must not leave stale scratch data behind to leak (or to be
 * silently re-read on a later re-enable).
 */
export function evictHost(moduleId: string): void {
  hosts.delete(moduleId);
  clearModuleCache(moduleId);
}
