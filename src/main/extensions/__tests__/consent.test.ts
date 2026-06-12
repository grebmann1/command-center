import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Inject CC_EXTENSIONS_DIR before importing the module so the lazy
// getExtensionsDir() resolver (in discovery.ts) picks up the temp dir.
// consent.ts is electron-free, so no electron mock is needed.
let extDir: string;

async function importConsent() {
  return await import('../consent.js');
}

describe('extension consent store (P3-D)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-consent-'));
    process.env.CC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.CC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('reads an empty map when consent.json is absent (never throws)', async () => {
    const { readConsentMap } = await importConsent();
    await expect(readConsentMap()).resolves.toEqual({});
  });

  it('grantConsent persists the declared set and survives a re-read', async () => {
    const { grantConsent, readConsentMap } = await importConsent();
    const res = await grantConsent('acme.ext', ['storage', 'session:launch']);
    expect(res.ok).toBe(true);
    expect(existsSync(join(extDir, 'consent.json'))).toBe(true);
    const map = await readConsentMap();
    expect(map['acme.ext']?.permissions.sort()).toEqual(['session:launch', 'storage']);
  });

  it('grantConsent dedupes and rejects a missing id', async () => {
    const { grantConsent, readConsentMap } = await importConsent();
    await grantConsent('dup.ext', ['fs:read', 'fs:read', 'net']);
    const map = await readConsentMap();
    expect(map['dup.ext']?.permissions.sort()).toEqual(['fs:read', 'net']);
    expect((await grantConsent('', ['storage'])).ok).toBe(false);
  });

  describe('consentStateFor', () => {
    it('no record → needsConsent "new"', async () => {
      const { consentStateFor } = await importConsent();
      expect(consentStateFor(['storage'], {}, 'x')).toEqual({
        consented: false,
        needsConsent: 'new'
      });
    });

    it('declared ⊆ consented (equal) → consented, no reprompt', async () => {
      const { consentStateFor } = await importConsent();
      const map = { x: { permissions: ['storage', 'net'] } };
      expect(consentStateFor(['storage', 'net'], map, 'x')).toEqual({
        consented: true,
        needsConsent: null
      });
    });

    it('declared ⊂ consented (narrowed) → consented, no reprompt', async () => {
      const { consentStateFor } = await importConsent();
      const map = { x: { permissions: ['storage', 'net', 'fs:read'] } };
      expect(consentStateFor(['storage'], map, 'x')).toEqual({
        consented: true,
        needsConsent: null
      });
    });

    it('declared adds a new permission (widened) → needsConsent "widened"', async () => {
      const { consentStateFor } = await importConsent();
      const map = { x: { permissions: ['storage'] } };
      expect(consentStateFor(['storage', 'session:launch'], map, 'x')).toEqual({
        consented: false,
        needsConsent: 'widened'
      });
    });
  });

  describe('effectivePermissions (declared ∩ consented)', () => {
    it('no record → empty grant (everything denied)', async () => {
      const { effectivePermissions } = await importConsent();
      expect(effectivePermissions(['storage', 'net'], {}, 'x')).toEqual([]);
    });

    it('intersects declared with the consented set', async () => {
      const { effectivePermissions } = await importConsent();
      const map = { x: { permissions: ['storage', 'net'] } };
      // declared adds 'fs:read' (not consented) and drops 'net' is kept;
      // result is the intersection only.
      expect(effectivePermissions(['storage', 'fs:read'], map, 'x').sort()).toEqual([
        'storage'
      ]);
    });

    it('a narrowed declared set drops the removed permission from the grant', async () => {
      const { effectivePermissions } = await importConsent();
      const map = { x: { permissions: ['storage', 'net', 'fs:read'] } };
      expect(effectivePermissions(['storage'], map, 'x')).toEqual(['storage']);
    });
  });

  it('revokeConsent forgets a record and is a no-op for an unknown id', async () => {
    const { grantConsent, revokeConsent, readConsentMap } = await importConsent();
    await grantConsent('gone.ext', ['storage']);
    expect((await revokeConsent('gone.ext')).ok).toBe(true);
    expect(await readConsentMap()).toEqual({});
    // unknown id → still ok, no throw
    expect((await revokeConsent('never.existed')).ok).toBe(true);
  });

  it('tolerates a malformed consent.json (returns empty map)', async () => {
    const { readConsentMap, grantConsent } = await importConsent();
    // write garbage, then confirm read degrades to {}
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, 'consent.json'), '{ not valid json', 'utf-8');
    expect(await readConsentMap()).toEqual({});
    // and a subsequent grant still works (overwrites the garbage)
    expect((await grantConsent('ok.ext', ['storage'])).ok).toBe(true);
    const raw = await readFile(join(extDir, 'consent.json'), 'utf-8');
    expect(JSON.parse(raw)['ok.ext'].permissions).toEqual(['storage']);
  });
});
