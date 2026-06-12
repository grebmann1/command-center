/**
 * Builds a `ModuleHost` for a given module id. Each method routes through the
 * generic `window.cc.modules` bridge (multiplexed IPC) or existing core
 * surfaces (inbox push, toasts), keeping modules decoupled from core wiring.
 */

import type { ModuleHost } from '@shared/module-api';
import type { HostEvents, ExtensionPermission } from '@cctc/extension-sdk/renderer';
import { useData, useUi } from '../store';
import { toSessionInfo } from './sessionInfo';
import { sanitizeExtraArgs } from '@shared/launch-sanitize';

/**
 * P3-B — renderer-side permission gate for DISK extensions.
 *
 * IMPORTANT (honest scope): this gate is **ADVISORY**, not authoritative. All
 * panels today share one `window.cc` and one IPC connection, so a malicious
 * panel can bypass `ModuleHost` and call `window.cc.terminals.create` /
 * `window.cc.openers.openIn` directly — the renderer cannot authenticate which
 * extension made a call. Authoritative renderer attribution (origin-based, per
 * sandboxed-iframe panel) is design §4 / a later "open the UI to strangers"
 * ticket (P3-C). Until then this gate:
 *   - stops a COOPERATIVE/curated disk ext from using a capability it didn't
 *     declare (catches honest mistakes, documents intent), and
 *   - sanitizes `launchSession` extraArgs against the denylist regardless (the
 *     sanitizer is shared with any future main-side gate).
 * The strong main-side gates in P3-B are the brokered exec/fs/fetch caps (the
 * `utilityProcess` child path) and `modules.pushInbox`/`modules.call`, which
 * carry an id main can key on. The renderer methods below ride generic core IPC
 * (`terminals.create`, `openers.openIn`) with no per-extension attribution, so
 * they can only be gated advisorily here.
 *
 * Built-in modules (gus/zana) are NOT in the grant map → unrestricted (trusted
 * by provenance).
 */
interface ModuleGrant {
  permissions: ReadonlySet<ExtensionPermission>;
}
const extensionGrants = new Map<string, ModuleGrant>();

/**
 * Publish the disk-extension grant map (called from the extension loader on
 * each reconcile). A built-in module's id is deliberately absent → its host is
 * unrestricted. Keyed by id; the value is the declared permission set.
 */
export function setExtensionGrants(
  grants: Array<{ id: string; permissions: readonly string[] }>
): void {
  extensionGrants.clear();
  for (const g of grants) {
    extensionGrants.set(g.id, {
      permissions: new Set(g.permissions as ExtensionPermission[])
    });
  }
}

/** True if `moduleId` is a disk ext AND lacks `permission`. Built-ins never gated. */
function diskExtLacks(moduleId: string, permission: ExtensionPermission): boolean {
  const grant = extensionGrants.get(moduleId);
  if (!grant) return false; // not a disk ext (built-in) → unrestricted
  return !grant.permissions.has(permission);
}

/**
 * Per-module in-memory scratch caches, held at MODULE scope (not inside
 * `createModuleHost`) so a module's cache survives BOTH panel unmount AND
 * host re-creation for the same id — `createModuleHost('gus')` called twice
 * returns hosts that share one cache. Evicted via {@link clearModuleCache},
 * which Phase 1's `evictHost(moduleId)` should call alongside dropping the host.
 */
const moduleCaches = new Map<string, Map<string, unknown>>();

function cacheFor(moduleId: string): Map<string, unknown> {
  let m = moduleCaches.get(moduleId);
  if (!m) {
    m = new Map<string, unknown>();
    moduleCaches.set(moduleId, m);
  }
  return m;
}

/**
 * Evict a module's in-memory `host.cache`. Call from `ModulePanelHost`'s
 * `evictHost(moduleId)` (Phase 1) so the cache lifecycle matches the host's —
 * a disabled/uninstalled extension shouldn't leave stale scratch data behind.
 * (Wiring the call lives in ModulePanelHost, owned by P2-C.)
 */
export function clearModuleCache(moduleId: string): void {
  moduleCaches.delete(moduleId);
}

/**
 * Wire one `host.on(event, cb)` subscription. Returns the unsubscribe fn for
 * exactly this subscription; multiple subscribers to the same event coexist
 * (each owns its own underlying stream/store subscription). Leak-safe: the
 * returned fn disposes everything this call set up.
 */
function subscribeHostEvent<E extends keyof HostEvents>(
  event: E,
  cb: (payload: HostEvents[E]) => void
): () => void {
  // A local cast helper: each branch builds the event's specific payload, and
  // we hand it to the (generically-typed) cb. The branch narrows E, so the
  // payload shape is checked against HostEvents[that key].
  const fire = cb as (payload: HostEvents[keyof HostEvents]) => void;

  switch (event) {
    case 'session:updated':
      return window.cc.terminals.onUpdated((session) => {
        fire({ session: toSessionInfo(session) });
      });
    case 'session:agentStatus':
      return window.cc.terminals.onAgentStatus((sessionId, state) => {
        fire({ sessionId, state });
      });
    case 'session:exit':
      return window.cc.terminals.onExit((sessionId, code) => {
        fire({ sessionId, code });
      });
    case 'inbox:appended':
      return window.cc.inbox.onAppended((entry) => {
        fire({ id: entry.id });
      });
    case 'inbox:removed':
      return window.cc.inbox.onRemoved((id) => {
        fire({ id });
      });
    case 'schedule:changed':
      return window.cc.scheduler.onChanged(() => fire({}));
    case 'mcp:changed':
      return window.cc.mcp.onChanged(() => fire({}));
    case 'skills:changed':
      return window.cc.skills.onChanged(() => fire({}));
    case 'project:changed': {
      // Derive from the shell's selected project. Subscribe to the whole UI
      // store (zustand v5 vanilla subscribe fires on every change) and diff the
      // selectedProjectId ourselves so we only fire on an actual project switch
      // — never the inline-selector-returning-a-fresh-object trap (that's a
      // React render hazard; this is a vanilla store subscription).
      let prevId = useUi.getState().selectedProjectId;
      const resolve = (id: string | null) => {
        if (!id) return null;
        const p = useData.getState().projects.find((proj) => proj.id === id);
        return p ? { id: p.id, name: p.name, path: p.path } : null;
      };
      return useUi.subscribe((state) => {
        const id = state.selectedProjectId;
        if (id === prevId) return;
        prevId = id;
        fire({ project: resolve(id) });
      });
    }
    case 'nav:changed': {
      let prevNav = useUi.getState().nav;
      return useUi.subscribe((state) => {
        const nav = state.nav;
        if (nav === prevNav) return;
        prevNav = nav;
        fire({ nav });
      });
    }
    default:
      // Unknown event id — no stream to wire. Returning a no-op keeps the
      // contract (always returns an unsubscribe fn) without throwing.
      return () => {};
  }
}

export function createModuleHost(moduleId: string): ModuleHost {
  return {
    moduleId,
    call: <T = unknown>(capability: string, ...args: unknown[]) =>
      window.cc.modules.call(moduleId, capability, args) as Promise<T>,
    storage: {
      get: <T = unknown>(key: string) =>
        window.cc.modules.storageGet(moduleId, key) as Promise<T | undefined>,
      set: (key: string, value: unknown) => window.cc.modules.storageSet(moduleId, key, value)
    },
    openExternal: (url: string) => {
      // Gate: external:open (advisory) + scheme allowlist (http/https only).
      if (diskExtLacks(moduleId, 'external:open')) {
        useUi.getState().pushToast(`${moduleId}: missing "external:open" permission`, 'error');
        return;
      }
      let scheme: string;
      try {
        scheme = new URL(url).protocol;
      } catch {
        useUi.getState().pushToast(`${moduleId}: invalid URL`, 'error');
        return;
      }
      if (scheme !== 'http:' && scheme !== 'https:') {
        useUi.getState().pushToast(`${moduleId}: only http(s) URLs may be opened`, 'error');
        return;
      }
      void window.cc.openers.openIn('browser', url);
    },
    pushInbox: async (msg) => {
      // Gate: inbox:push. (Main-side pushInbox also receives moduleId and can
      // gate authoritatively against the claimed id — see index.ts.)
      if (diskExtLacks(moduleId, 'inbox:push')) {
        throw new Error(`PermissionDenied: ${moduleId} lacks "inbox:push"`);
      }
      // Default to the shell's active project, mirroring getActiveProject().
      const projectId = msg.projectId ?? useUi.getState().selectedProjectId;
      if (!projectId) {
        throw new Error('pushInbox: no projectId and no active project');
      }
      return window.cc.modules.pushInbox(moduleId, { ...msg, projectId });
    },
    toast: (message: string, kind?: 'info' | 'error') => {
      useUi.getState().pushToast(message, kind);
    },
    getActiveProject: () => {
      const id = useUi.getState().selectedProjectId;
      if (!id) return null;
      const p = useData.getState().projects.find((p) => p.id === id);
      return p ? { id: p.id, name: p.name, path: p.path } : null;
    },
    listProjects: () =>
      useData.getState().projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    selectProject: (projectId: string | null) => {
      useUi.getState().selectProject(projectId);
    },
    launchSession: async ({ projectId, extraArgs, title, cwd }) => {
      // Gate: session:launch (advisory) + sanitize extraArgs against the denylist
      // (--dangerously-skip-permissions, --mcp-config, …) so a disk ext can't
      // launch an auto-approving / hijacked agent in the user's repo (design §1c).
      if (diskExtLacks(moduleId, 'session:launch')) {
        useUi.getState().pushToast(`${moduleId}: missing "session:launch" permission`, 'error');
        return null;
      }
      // Project-scope: only launch into a project the shell actually knows.
      const known = useData.getState().projects.some((p) => p.id === projectId);
      if (!known) return null;
      let safeArgs = extraArgs;
      if (extensionGrants.has(moduleId)) {
        const { args, removed } = sanitizeExtraArgs(extraArgs);
        safeArgs = args;
        if (removed.length > 0) {
          useUi
            .getState()
            .pushToast(`${moduleId}: blocked unsafe launch flags: ${removed.join(', ')}`, 'error');
        }
      }
      // Mirror CommandPalette.launch: spawn a claude tab, then bring the shell
      // to it (nav → projects, select the project + new tab, show terminals).
      const session = await useData
        .getState()
        .createTerminal(projectId, 'claude', 80, 24, { extraArgs: safeArgs, title, cwd });
      if (!session) return null;
      const ui = useUi.getState();
      ui.setNav('projects');
      ui.selectProject(projectId);
      ui.selectTab(projectId, session.id);
      ui.setWorkspaceMode(projectId, 'terminals');
      return { id: session.id };
    },
    on: <E extends keyof HostEvents>(event: E, cb: (payload: HostEvents[E]) => void) =>
      subscribeHostEvent(event, cb),
    cache: {
      get: <T = unknown>(key: string) => cacheFor(moduleId).get(key) as T | undefined,
      set: (key: string, value: unknown) => {
        cacheFor(moduleId).set(key, value);
      },
      delete: (key: string) => {
        cacheFor(moduleId).delete(key);
      }
    }
  };
}
