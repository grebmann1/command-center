/**
 * Runtime-extension discovery + enabled-map, scanning
 * `~/.cc-center/extensions/<id>/extension.json`. Deliberately electron-free so
 * vitest can import it directly (no `app`/`shell` mock needed) — the Finder
 * `reveal` and the moduleHost wiring live in the loader / index.ts side.
 *
 * Mirrors the defensive habits of `plugin-fs.ts` + `plugins.ts`:
 *   - lazy dir resolution with an ENV OVERRIDE (`CC_EXTENSIONS_DIR`) so tests
 *     point it at a temp dir without caring about import order;
 *   - `existsSync` guards everywhere;
 *   - a bad/missing/malformed manifest is logged + skipped, never thrown;
 *   - an enabled-map that defaults to enabled-unless-explicitly-false
 *     (same `readEnabledMap` / `setExtensionEnabled` shape as plugins).
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { checkApiCompat, type ExtensionManifest } from '@cctc/extension-sdk';
import type {
  ExtensionEntry,
  ExtensionLoadError,
  ExtensionManifestView,
  Result
} from '../../shared/types.js';

/**
 * Tests inject a fake extensions dir via `CC_EXTENSIONS_DIR`. Resolution is
 * lazy (re-read on each call), so import order doesn't matter — beforeEach can
 * set the env after the module loads. Falls back to `~/.cc-center/extensions`.
 */
export function getExtensionsDir(): string {
  const override = process.env.CC_EXTENSIONS_DIR;
  if (override) return override;
  return join(homedir(), '.cc-center', 'extensions');
}

function getEnabledFile(): string {
  return join(getExtensionsDir(), 'enabled.json');
}

/** Manifest file name inside each extension dir. */
const MANIFEST_NAME = 'extension.json';

/** A discovered extension dir paired with its load outcome. */
export interface DiscoveredExtension extends ExtensionEntry {
  /** Resolved absolute path to the main entry, when present + loadable. */
  mainEntryPath?: string;
}

type LogFn = (message: string, err?: unknown) => void;

/** No-op logger default so the scanner works without wiring. */
const noopLog: LogFn = () => {};

/** Internal directory names that never hold an extension. */
function isInternalName(n: string): boolean {
  return (
    n === 'enabled.json' ||
    n.startsWith('.') ||
    n.startsWith('temp_') ||
    n.endsWith('.disabled')
  );
}

/** Best-effort directory listing of subdirectories. */
async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Read the `enabled.json` map. Shape: `{ "<id>": boolean }`. Missing → {}. */
async function readEnabledMap(): Promise<Record<string, boolean>> {
  const file = getEnabledFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Validate the raw parsed manifest into the shape we surface. Returns null when
 * required fields (`id`, `title`, `icon`, `engines.cctcApi`, `entry`) are
 * missing or the wrong type. `entry.renderer` / `entry.main` are both optional.
 */
function validateManifest(raw: unknown): ExtensionManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) return null;
  if (typeof m.title !== 'string' || !m.title) return null;
  if (typeof m.icon !== 'string' || !m.icon) return null;
  if (!m.engines || typeof m.engines !== 'object') return null;
  const engines = m.engines as Record<string, unknown>;
  if (typeof engines.cctcApi !== 'string' || !engines.cctcApi) return null;
  if (!m.entry || typeof m.entry !== 'object') return null;
  const entry = m.entry as Record<string, unknown>;
  const renderer = entry.renderer;
  const main = entry.main;
  if (renderer !== undefined && typeof renderer !== 'string') return null;
  if (main !== undefined && typeof main !== 'string') return null;
  // A useless extension declares neither entry — skip it.
  if (renderer === undefined && main === undefined) return null;

  const titleLabel = typeof m.titleLabel === 'string' ? m.titleLabel : undefined;
  const permissions = Array.isArray(m.permissions)
    ? (m.permissions.filter((p) => typeof p === 'string') as ExtensionManifest['permissions'])
    : undefined;

  return {
    id: m.id,
    title: m.title,
    icon: m.icon,
    titleLabel,
    entry: {
      renderer: typeof renderer === 'string' ? renderer : undefined,
      main: typeof main === 'string' ? main : undefined
    },
    engines: { cctcApi: engines.cctcApi },
    permissions
  };
}

/** Project an SDK manifest down to the renderer-safe view in shared/types. */
function toManifestView(m: ExtensionManifest): ExtensionManifestView {
  return {
    id: m.id,
    title: m.title,
    icon: m.icon,
    titleLabel: m.titleLabel,
    entry: { renderer: m.entry.renderer, main: m.entry.main },
    engines: { cctcApi: m.engines.cctcApi },
    permissions: m.permissions ? [...m.permissions] : undefined
  };
}

/**
 * Scan the extensions dir and return one entry per `<id>` directory. Each entry
 * carries its parsed manifest (or null + an `error` reason), its enabled state,
 * and — for enabled, version-compatible extensions declaring a main entry — the
 * resolved absolute `mainEntryPath` the loader will import.
 *
 * `loaded` here reflects *discovery* success (valid + compatible + enabled). The
 * loader flips it to false and stamps `main-load-failed` if the main import
 * throws later.
 *
 * Never throws: a bad manifest is logged + skipped.
 */
export async function discoverExtensions(log: LogFn = noopLog): Promise<DiscoveredExtension[]> {
  const root = getExtensionsDir();
  if (!existsSync(root)) return [];

  const [dirs, enabledMap] = await Promise.all([listDirs(root), readEnabledMap()]);
  const out: DiscoveredExtension[] = [];

  for (const name of dirs) {
    if (isInternalName(name)) continue;
    const dir = join(root, name);
    const manifestPath = join(dir, MANIFEST_NAME);

    let manifest: ExtensionManifest | null = null;
    let error: ExtensionLoadError | undefined;

    if (!existsSync(manifestPath)) {
      log(`extension ${name}: missing ${MANIFEST_NAME} — skipping`);
      error = 'bad-manifest';
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
      } catch (err) {
        log(`extension ${name}: unparseable ${MANIFEST_NAME} — skipping`, err);
        out.push(badEntry(name, dir));
        continue;
      }
      manifest = validateManifest(parsed);
      if (!manifest) {
        log(`extension ${name}: invalid manifest shape — skipping`);
        error = 'bad-manifest';
      }
    }

    // Enabled defaults to true unless explicitly disabled in enabled.json.
    const enabled = enabledMap[name] !== false;

    if (!manifest) {
      out.push({ id: name, path: dir, manifest: null, enabled, loaded: false, error });
      continue;
    }

    const view = toManifestView(manifest);

    // Version gate — skip + warn on a contract mismatch.
    if (!checkApiCompat(manifest.engines.cctcApi)) {
      log(
        `extension ${name}: engines.cctcApi "${manifest.engines.cctcApi}" incompatible with host — skipping`
      );
      out.push({
        id: name,
        path: dir,
        manifest: view,
        enabled,
        loaded: false,
        error: 'version-mismatch'
      });
      continue;
    }

    if (!enabled) {
      out.push({ id: name, path: dir, manifest: view, enabled, loaded: false, error: 'disabled' });
      continue;
    }

    // Resolve the main entry path (if any). The loader imports it; until then we
    // mark loaded:true to mean "discovery-clean".
    let mainEntryPath: string | undefined;
    if (manifest.entry.main) {
      mainEntryPath = join(dir, manifest.entry.main);
    }

    out.push({ id: name, path: dir, manifest: view, enabled, loaded: true, mainEntryPath });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function badEntry(id: string, dir: string): DiscoveredExtension {
  return { id, path: dir, manifest: null, enabled: true, loaded: false, error: 'bad-manifest' };
}

/**
 * Read an extension's renderer entry file off disk and return its JS text, for
 * the renderer to blob-import (P1-C). Guards: the entry must resolve *within*
 * the extension's own dir (no `../` escape), the manifest must declare a
 * renderer entry, and the file must exist. Returns null otherwise.
 */
export async function readRendererEntry(id: string, log: LogFn = noopLog): Promise<string | null> {
  const root = getExtensionsDir();
  const dir = join(root, id);
  const manifestPath = join(dir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) return null;

  let manifest: ExtensionManifest | null = null;
  try {
    manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf-8')));
  } catch {
    return null;
  }
  if (!manifest?.entry.renderer) return null;

  // Contain the read to the extension's own dir — reject a renderer path that
  // resolves outside it (defends against a `../../etc/passwd`-style manifest).
  const target = resolve(dir, manifest.entry.renderer);
  const contained = resolve(dir);
  if (target !== contained && !target.startsWith(contained + '/')) {
    log(`extension ${id}: renderer entry escapes extension dir — refusing`);
    return null;
  }
  if (!existsSync(target)) {
    log(`extension ${id}: renderer entry ${manifest.entry.renderer} not found`);
    return null;
  }
  try {
    return await readFile(target, 'utf-8');
  } catch (err) {
    log(`extension ${id}: failed reading renderer entry`, err);
    return null;
  }
}

/** Strip the loader-only `mainEntryPath` field for the renderer-facing list. */
export function toEntry(d: DiscoveredExtension): ExtensionEntry {
  return {
    id: d.id,
    path: d.path,
    manifest: d.manifest,
    enabled: d.enabled,
    loaded: d.loaded,
    error: d.error
  };
}

/**
 * Flip an extension's enabled state in `enabled.json`. Mirrors plugins'
 * `setPluginEnabled`: deletes the key on enable (treat absent === enabled,
 * keep the file tidy), writes `false` on disable. Creates the dir/file as
 * needed. Atomic write via temp + rename.
 */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const root = getExtensionsDir();
  const file = getEnabledFile();
  const map = await readEnabledMap();
  if (enabled) delete map[id];
  else map[id] = false;

  try {
    await mkdir(root, { recursive: true });
    if (Object.keys(map).length === 0) {
      // Nothing to persist — write an empty object (rather than deleting the
      // file) so the map round-trips deterministically.
      await atomicWrite(file, '{}\n');
    } else {
      await atomicWrite(file, JSON.stringify(map, null, 2));
    }
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, contents, 'utf-8');
  await rename(tmp, file);
}

/** Absolute dir of one extension (for the Finder `reveal` opener). */
export function extensionDir(id: string): string {
  return join(getExtensionsDir(), id);
}
