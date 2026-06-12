/**
 * Main-side runtime load for discovered extensions. For each enabled,
 * version-compatible extension that declares `entry.main`, dynamically import
 * the module, take its `default` export as a `MainModule`, and collect it so
 * core can feed it into the EXISTING `moduleHost.setupAll([...MAIN_MODULES,
 * ...discovered])` (merge, never replace).
 *
 * Failures are isolated per-extension — a bad import must not break boot or
 * sibling extensions, mirroring `setupAll`'s own try/catch isolation. A failed
 * import stamps the entry's `error` to `main-load-failed` and `loaded:false`.
 *
 * Electron-free: it only does dynamic ESM imports + path work, so a test can
 * exercise it without mocking `app`.
 */

import { pathToFileURL } from 'node:url';
import type { MainModule } from '@cctc/extension-sdk/main';
import { discoverExtensions, toEntry, type DiscoveredExtension } from './discovery.js';
import type { ExtensionEntry } from '../../shared/types.js';

type LogFn = (message: string, err?: unknown) => void;
const noopLog: LogFn = () => {};

export interface LoadedExtensions {
  /** Renderer-facing entries (manifest + enabled + loaded + mainActive + error). */
  entries: ExtensionEntry[];
  /** Main modules to merge into `moduleHost.setupAll`. */
  modules: MainModule[];
}

export interface LoadOptions {
  log?: LogFn;
  /**
   * When provided, the loader runs in **re-discovery mode**: it does NOT
   * `import()` any main module (an ESM import is cached by URL — a re-import
   * after teardown returns the SAME, still-half-initialised instance, so a
   * naive re-setup is a partial no-op). Instead it stamps each main-bearing
   * entry's `mainActive` from this set — the ids the host actually has live in
   * `moduleHost` right now. Main modules are relaunch-required to (re)activate,
   * so a re-enabled-but-not-relaunched extension correctly reads
   * `mainActive:false` and the renderer can surface a relaunch hint.
   *
   * Omit on the BOOT path: the loader imports each main module and marks the
   * ones it collected `mainActive:true`.
   */
  activeMainIds?: ReadonlySet<string>;
}

/**
 * A `MainModule` looks structurally valid: an object with a string `id` and a
 * `setup` function. We don't trust the disk bundle's `default` blindly.
 */
function isMainModule(v: unknown): v is MainModule {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && !!m.id && typeof m.setup === 'function';
}

/**
 * Discover extensions and resolve each one's main-side state.
 *
 * BOOT path (no `activeMainIds`): import the main module of each enabled,
 * compatible extension that declares `entry.main`, take its `default` as a
 * `MainModule`, and collect it. The caller merges `modules` with `MAIN_MODULES`
 * and runs `setupAll` once. Collected modules' entries are marked
 * `mainActive:true`; a failed import stamps `loaded:false` + `main-load-failed`.
 *
 * RE-DISCOVERY path (`activeMainIds` provided): do NOT import anything — just
 * re-read the manifests/enabled-map and stamp each main-bearing entry's
 * `mainActive` from the live set. `modules` comes back empty (the host already
 * has its boot-time modules; main modules are relaunch-required to (re)activate).
 */
export async function loadExtensions(opts: LoadOptions = {}): Promise<LoadedExtensions> {
  const log = opts.log ?? noopLog;
  const reDiscover = opts.activeMainIds !== undefined;
  const activeMainIds = opts.activeMainIds ?? new Set<string>();

  const discovered = await discoverExtensions(log);
  const modules: MainModule[] = [];
  const entries: ExtensionEntry[] = [];

  for (const ext of discovered) {
    const entry = toEntry(ext);

    if (ext.mainEntryPath && ext.loaded) {
      if (reDiscover) {
        // No import: a main module is only active if the host loaded it at boot.
        entry.mainActive = activeMainIds.has(ext.id);
      } else {
        const mod = await importMainModule(ext, log);
        if (mod) {
          modules.push(mod);
          entry.mainActive = true;
        } else {
          entry.loaded = false;
          entry.mainActive = false;
          entry.error = 'main-load-failed';
        }
      }
    }
    entries.push(entry);
  }

  return { entries, modules };
}

/** Dynamic-import one extension's main module; returns null on any failure. */
async function importMainModule(
  ext: DiscoveredExtension,
  log: LogFn
): Promise<MainModule | null> {
  if (!ext.mainEntryPath) return null;
  try {
    const url = pathToFileURL(ext.mainEntryPath).href;
    const imported = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    const candidate = imported.default;
    if (!isMainModule(candidate)) {
      log(`extension ${ext.id}: main entry has no valid default MainModule export`);
      return null;
    }
    // The module's own id should match its dir id; warn but honour the dir id
    // so the renderer/storage namespacing stays consistent.
    if (candidate.id !== ext.id) {
      log(`extension ${ext.id}: main module id "${candidate.id}" differs from dir id`);
    }
    return candidate;
  } catch (err) {
    log(`extension ${ext.id}: failed to import main entry`, err);
    return null;
  }
}
