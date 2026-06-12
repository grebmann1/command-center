/**
 * Unified dispatch router (P3-A). ONE entry point the `modules:call` IPC handler
 * calls; it routes by moduleId between the two hosts:
 *
 *   - built-in MAIN_MODULES (gus, zana) → in-process `MainModuleHost` (trusted)
 *   - disk extensions                   → out-of-process `ExtensionProcessHost`
 *
 * Routing rule: a disk extension owns a child in the process host iff
 * `processHost.has(id)`; everything else falls through to the in-process host
 * (which already rejects an unknown id with "Unknown module"). Built-in ids and
 * disk-ext ids never collide in practice — built-ins are a fixed code-owned set
 * — and the process host is checked first so a disk ext can't shadow a built-in.
 *
 * Storage routing follows the same split: a disk ext's storage is served
 * host-side by the process host's broker (keyed by the authenticated child id);
 * a built-in's storage is the in-process `MainModuleHost` store. The router
 * exposes storageGet/Set so the IPC layer stays agnostic.
 *
 * SEAM (P3-B): the renderer-facing permission gate (launchSession/openExternal/
 * pushInbox) is layered in `index.ts` on those IPC handlers, not here; the
 * broker-cap gate is in the process host's `handleBroker`. This router only
 * decides WHICH host runs a moduleId — it is the natural place to also consult a
 * `PermissionBroker.can(id, capability)` before dispatch if capability-level
 * policy is wanted.
 */

import type { MainModuleHost } from '../modules/registry.js';
import type { ExtensionProcessHost } from './process-host.js';

export class ModuleRouter {
  constructor(
    private readonly builtins: Pick<
      MainModuleHost,
      'dispatch' | 'storageGet' | 'storageSet' | 'liveModuleIds' | 'teardown'
    >,
    private readonly diskExts: ExtensionProcessHost
  ) {}

  /** Route a renderer `ModuleHost.call` to the owning host. */
  dispatch(moduleId: string, capability: string, args: unknown[]): Promise<unknown> {
    if (this.diskExts.has(moduleId)) {
      return this.diskExts.dispatch(moduleId, capability, args);
    }
    return Promise.resolve(this.builtins.dispatch(moduleId, capability, args));
  }

  /**
   * Storage get. Disk-ext storage lives host-side (served by the process host's
   * broker), but its store is the SAME on-disk KV the built-in host owns — so we
   * read/write it through the built-in host regardless, keyed by moduleId. This
   * keeps one storage implementation; the anti-spoof guarantee for disk exts is
   * that the CHILD can only reach storage via its broker, where the host
   * substitutes the authenticated id (the child never names the id). The
   * renderer-side `modules.storageGet/Set` id is gated in P3-B/P3-C.
   */
  storageGet(moduleId: string, key: string): unknown {
    return this.builtins.storageGet(moduleId, key);
  }

  storageSet(moduleId: string, key: string, value: unknown): void {
    this.builtins.storageSet(moduleId, key, value);
  }

  /** Tear down a module on either host (disable/uninstall). */
  async teardown(moduleId: string): Promise<void> {
    if (this.diskExts.has(moduleId)) {
      await this.diskExts.teardown(moduleId);
      return;
    }
    await this.builtins.teardown(moduleId);
  }

  /** Union of live ids across both hosts — feeds extension `mainActive` stamping. */
  liveModuleIds(): Set<string> {
    const ids = this.builtins.liveModuleIds();
    for (const id of this.diskExts.liveModuleIds()) ids.add(id);
    return ids;
  }
}
