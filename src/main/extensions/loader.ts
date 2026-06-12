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
  /** Renderer-facing entries (manifest + enabled + loaded + error). */
  entries: ExtensionEntry[];
  /** Main modules to merge into `moduleHost.setupAll`. */
  modules: MainModule[];
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
 * Discover extensions, then import the main module of each enabled one that
 * declares `entry.main`. Returns the renderer-facing entry list (with any
 * load error stamped) plus the collected `MainModule`s. The caller merges the
 * modules with `MAIN_MODULES` and runs `setupAll` once.
 */
export async function loadExtensions(log: LogFn = noopLog): Promise<LoadedExtensions> {
  const discovered = await discoverExtensions(log);
  const modules: MainModule[] = [];
  const entries: ExtensionEntry[] = [];

  for (const ext of discovered) {
    const entry = toEntry(ext);
    if (ext.mainEntryPath && ext.loaded) {
      const mod = await importMainModule(ext, log);
      if (mod) {
        modules.push(mod);
      } else {
        entry.loaded = false;
        entry.error = 'main-load-failed';
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
