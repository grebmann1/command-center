import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests inject CC_EXTENSIONS_DIR *before* importing the modules under test, so
// the lazy `getExtensionsDir()` resolver picks up the temp dir. The discovery /
// loader modules are electron-free, so no electron mock is needed.
let extDir: string;

async function importDiscovery() {
  return await import('../extensions/discovery.js');
}
async function importLoader() {
  return await import('../extensions/loader.js');
}

/** Write a `<id>/extension.json` manifest. */
async function writeExt(id: string, manifest: unknown): Promise<string> {
  const dir = join(extDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
  return dir;
}

const goodEngines = { cctcApi: '>=1 <2' };

describe('extension discovery', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-test-'));
    process.env.CC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.CC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('loads a valid renderer-only manifest', async () => {
    await writeExt('alpha', {
      id: 'alpha',
      title: 'Alpha',
      icon: 'Box',
      entry: { renderer: './renderer.js' },
      engines: goodEngines
    });
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions();
    expect(list).toHaveLength(1);
    // Renderer-only → no main side to activate, so mainActive is true at discovery.
    expect(list[0]).toMatchObject({
      id: 'alpha',
      enabled: true,
      loaded: true,
      mainActive: true
    });
    expect(list[0].error).toBeUndefined();
    expect(list[0].manifest?.entry.renderer).toBe('./renderer.js');
    // No main entry → loader resolves no mainEntryPath.
    expect(list[0].mainEntryPath).toBeUndefined();
  });

  it('handles a main-only manifest and resolves its main entry path', async () => {
    const dir = await writeExt('beta', {
      id: 'beta',
      title: 'Beta',
      icon: 'Cog',
      entry: { main: './main.js' },
      engines: goodEngines
    });
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions();
    expect(list).toHaveLength(1);
    expect(list[0].loaded).toBe(true);
    // Main-bearing → discovery alone does NOT activate the main side; the loader
    // flips mainActive once it imports + the host registers the module.
    expect(list[0].mainActive).toBe(false);
    expect(list[0].mainEntryPath).toBe(join(dir, 'main.js'));
    expect(list[0].manifest?.entry.renderer).toBeUndefined();
  });

  it('refuses a main entry that escapes the extension dir (skips, no mainEntryPath)', async () => {
    await writeExt('mainescaper', {
      id: 'mainescaper',
      title: 'MainEscaper',
      icon: 'Cog',
      entry: { main: '../../../../tmp/evil.js' },
      engines: goodEngines
    });
    const warnings: string[] = [];
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions((m) => warnings.push(m));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'mainescaper',
      loaded: false,
      mainActive: false,
      error: 'bad-manifest'
    });
    // Crucially: no mainEntryPath, so the loader never import()s the escaped path.
    expect(list[0].mainEntryPath).toBeUndefined();
    expect(warnings.some((w) => w.includes('mainescaper') && w.includes('escapes'))).toBe(true);
  });

  it('skips + warns on a malformed (unparseable) manifest', async () => {
    const dir = join(extDir, 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'extension.json'), '{ not json', 'utf-8');
    const warnings: string[] = [];
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions((m) => warnings.push(m));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'broken', loaded: false, error: 'bad-manifest' });
    expect(list[0].manifest).toBeNull();
    expect(warnings.some((w) => w.includes('broken'))).toBe(true);
  });

  it('skips + warns on an invalid manifest shape (missing required fields)', async () => {
    await writeExt('shapeless', { id: 'shapeless', title: 'X' }); // no icon/engines/entry
    const warnings: string[] = [];
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions((m) => warnings.push(m));
    expect(list[0]).toMatchObject({ id: 'shapeless', loaded: false, error: 'bad-manifest' });
    expect(warnings.some((w) => w.includes('shapeless'))).toBe(true);
  });

  it('skips a version-mismatched extension', async () => {
    await writeExt('future', {
      id: 'future',
      title: 'Future',
      icon: 'Rocket',
      entry: { renderer: './renderer.js' },
      engines: { cctcApi: '>=2' } // host SDK_API_VERSION === 1
    });
    const { discoverExtensions } = await importDiscovery();
    const list = await discoverExtensions();
    expect(list[0]).toMatchObject({ id: 'future', loaded: false, error: 'version-mismatch' });
    // Manifest still surfaced so the UI can explain why it was skipped.
    expect(list[0].manifest).not.toBeNull();
  });

  it('skips a disabled extension per the enabled-map', async () => {
    await writeExt('disabled-one', {
      id: 'disabled-one',
      title: 'Disabled',
      icon: 'Box',
      entry: { renderer: './renderer.js' },
      engines: goodEngines
    });
    const { discoverExtensions, setExtensionEnabled } = await importDiscovery();
    const r = await setExtensionEnabled('disabled-one', false);
    expect(r.ok).toBe(true);
    const list = await discoverExtensions();
    expect(list[0]).toMatchObject({
      id: 'disabled-one',
      enabled: false,
      loaded: false,
      error: 'disabled'
    });
  });

  it('round-trips setExtensionEnabled through enabled.json', async () => {
    await writeExt('toggle', {
      id: 'toggle',
      title: 'Toggle',
      icon: 'Box',
      entry: { renderer: './renderer.js' },
      engines: goodEngines
    });
    const { discoverExtensions, setExtensionEnabled } = await importDiscovery();

    await setExtensionEnabled('toggle', false);
    const enabledFile = join(extDir, 'enabled.json');
    expect(JSON.parse(await readFile(enabledFile, 'utf-8'))).toEqual({ 'toggle': false });
    let list = await discoverExtensions();
    expect(list[0].enabled).toBe(false);

    // Re-enable deletes the key (keep tidy).
    await setExtensionEnabled('toggle', true);
    expect(JSON.parse(await readFile(enabledFile, 'utf-8'))).toEqual({});
    list = await discoverExtensions();
    expect(list[0].enabled).toBe(true);
  });

  it('reads a renderer entry file as text, contained to the extension dir', async () => {
    const dir = await writeExt('reader', {
      id: 'reader',
      title: 'Reader',
      icon: 'Box',
      entry: { renderer: './bundle.js' },
      engines: goodEngines
    });
    await writeFile(join(dir, 'bundle.js'), 'export default 42;', 'utf-8');
    const { readRendererEntry } = await importDiscovery();
    expect(await readRendererEntry('reader')).toBe('export default 42;');
  });

  it('refuses a renderer entry that escapes the extension dir', async () => {
    await writeExt('escaper', {
      id: 'escaper',
      title: 'Escaper',
      icon: 'Box',
      entry: { renderer: '../../etc/passwd' },
      engines: goodEngines
    });
    const { readRendererEntry } = await importDiscovery();
    expect(await readRendererEntry('escaper')).toBeNull();
  });

  it('returns null reading a renderer entry for a main-only extension', async () => {
    await writeExt('mainonly', {
      id: 'mainonly',
      title: 'MainOnly',
      icon: 'Box',
      entry: { main: './main.js' },
      engines: goodEngines
    });
    const { readRendererEntry } = await importDiscovery();
    expect(await readRendererEntry('mainonly')).toBeNull();
  });

  it('returns [] when the extensions dir does not exist', async () => {
    await rm(extDir, { recursive: true, force: true });
    const { discoverExtensions } = await importDiscovery();
    expect(await discoverExtensions()).toEqual([]);
  });
});

describe('extension loader', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-loader-'));
    process.env.CC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.CC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('imports a valid main module and collects it', async () => {
    const dir = await writeExt('mainmod', {
      id: 'mainmod',
      title: 'MainMod',
      icon: 'Cog',
      entry: { main: './main.mjs' },
      engines: goodEngines
    });
    await writeFile(
      join(dir, 'main.mjs'),
      `export default { id: 'mainmod', setup() { return { ping: () => 'pong' }; } };`,
      'utf-8'
    );
    const { loadExtensions } = await importLoader();
    const { entries, modules } = await loadExtensions();
    expect(entries).toHaveLength(1);
    // Boot path imports the module → mainActive true.
    expect(entries[0]).toMatchObject({ id: 'mainmod', loaded: true, mainActive: true });
    expect(entries[0].error).toBeUndefined();
    expect(modules).toHaveLength(1);
    expect(modules[0].id).toBe('mainmod');
  });

  it('re-discovery mode does not import; mainActive reflects the live host set', async () => {
    const dir = await writeExt('reenable', {
      id: 'reenable',
      title: 'ReEnable',
      icon: 'Cog',
      entry: { main: './main.mjs' },
      engines: goodEngines
    });
    await writeFile(
      join(dir, 'main.mjs'),
      `export default { id: 'reenable', setup() { return {}; } };`,
      'utf-8'
    );
    const { loadExtensions } = await importLoader();

    // Re-enabled but NOT loaded into the host this boot → mainActive:false, and
    // no module is collected (no re-import). This is the "needs relaunch" state.
    const notLive = await loadExtensions({ activeMainIds: new Set<string>() });
    expect(notLive.modules).toHaveLength(0);
    expect(notLive.entries[0]).toMatchObject({
      id: 'reenable',
      loaded: true,
      mainActive: false
    });

    // Already live in the host (loaded at boot) → mainActive:true, still no
    // re-import.
    const live = await loadExtensions({ activeMainIds: new Set(['reenable']) });
    expect(live.modules).toHaveLength(0);
    expect(live.entries[0].mainActive).toBe(true);
  });

  it('isolates a failing main import as main-load-failed without collecting it', async () => {
    const dir = await writeExt('boom', {
      id: 'boom',
      title: 'Boom',
      icon: 'Cog',
      entry: { main: './main.mjs' },
      engines: goodEngines
    });
    await writeFile(join(dir, 'main.mjs'), `throw new Error('kaboom');`, 'utf-8');
    const { loadExtensions } = await importLoader();
    const { entries, modules } = await loadExtensions();
    expect(entries[0]).toMatchObject({ id: 'boom', loaded: false, error: 'main-load-failed' });
    expect(modules).toHaveLength(0);
  });

  it('stamps main-load-failed when default export is not a MainModule', async () => {
    const dir = await writeExt('notmod', {
      id: 'notmod',
      title: 'NotMod',
      icon: 'Cog',
      entry: { main: './main.mjs' },
      engines: goodEngines
    });
    await writeFile(join(dir, 'main.mjs'), `export default { nope: true };`, 'utf-8');
    const { loadExtensions } = await importLoader();
    const { entries, modules } = await loadExtensions();
    expect(entries[0]).toMatchObject({ id: 'notmod', loaded: false, error: 'main-load-failed' });
    expect(modules).toHaveLength(0);
  });

  it('does not import the main module of a renderer-only extension', async () => {
    await writeExt('renderonly', {
      id: 'renderonly',
      title: 'RenderOnly',
      icon: 'Box',
      entry: { renderer: './renderer.js' },
      engines: goodEngines
    });
    const { loadExtensions } = await importLoader();
    const { entries, modules } = await loadExtensions();
    expect(entries[0]).toMatchObject({ id: 'renderonly', loaded: true, mainActive: true });
    expect(modules).toHaveLength(0);
  });
});
