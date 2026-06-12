/**
 * Install-time consent store (P3-D). A disk extension's declared permissions
 * must be CONSENTED by the user before its main runs / panel mounts; an update
 * that WIDENS the declared set re-prompts. This file owns the persisted grant
 * and the widen-diff. Electron-free (like `discovery.ts`) so vitest can import
 * it directly with a `CC_EXTENSIONS_DIR` temp dir.
 *
 * Storage: `~/.cc-center/extensions/consent.json`, shape:
 *   { "<id>": { "permissions": string[] } }
 * The stored `permissions` is exactly the list the user approved. Consent state
 * is derived by comparing it against the extension's CURRENT manifest-declared
 * permissions:
 *   - no record               → needsConsent: 'new'      (never approved)
 *   - declared ⊄ consented    → needsConsent: 'widened'  (update added perms)
 *   - declared ⊆ consented    → needsConsent: null       (approved; equal/narrowed)
 *
 * A narrowed/equal update is silent — the extension keeps running and the
 * EFFECTIVE grant is `declared ∩ consented` (so a removed permission stops being
 * granted without a reprompt). Built-ins never appear here (they aren't disk
 * exts and bypass consent entirely).
 *
 * Atomic writes mirror the enabled-map (`setExtensionEnabled`): temp + rename.
 */

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getExtensionsDir } from './discovery.js';
import type { Result } from '../../shared/types.js';

/** One persisted consent record. */
export interface ConsentRecord {
  /** The exact permission list the user approved. */
  permissions: string[];
}

export type ConsentMap = Record<string, ConsentRecord>;

/** Why a disk ext needs (re)consent, or null when fully consented. */
export type NeedsConsent = 'new' | 'widened' | null;

function getConsentFile(): string {
  return join(getExtensionsDir(), 'consent.json');
}

/** Read `consent.json`. Missing/malformed → empty map (never throws). */
export async function readConsentMap(): Promise<ConsentMap> {
  const file = getConsentFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ConsentMap = {};
    for (const [id, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
        const perms = (rec as { permissions?: unknown }).permissions;
        out[id] = {
          permissions: Array.isArray(perms)
            ? perms.filter((p): p is string => typeof p === 'string')
            : []
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Compute consent state for one disk ext given its CURRENT declared permissions
 * and the consent map. Pure — the unit tests hit this directly.
 */
export function consentStateFor(
  declared: readonly string[] | undefined,
  consent: ConsentMap,
  id: string
): { consented: boolean; needsConsent: NeedsConsent } {
  const rec = consent[id];
  if (!rec) return { consented: false, needsConsent: 'new' };
  const granted = new Set(rec.permissions);
  const widened = (declared ?? []).some((p) => !granted.has(p));
  if (widened) return { consented: false, needsConsent: 'widened' };
  // Equal or narrowed: approved. (Narrowing needs no reprompt; the effective
  // grant is declared ∩ consented, computed by the GrantProvider.)
  return { consented: true, needsConsent: null };
}

/** The intersection that becomes the EFFECTIVE granted permission set. */
export function effectivePermissions(
  declared: readonly string[] | undefined,
  consent: ConsentMap,
  id: string
): string[] {
  const rec = consent[id];
  if (!rec) return [];
  const granted = new Set(rec.permissions);
  return (declared ?? []).filter((p) => granted.has(p));
}

/**
 * Record the user's consent: persist the CURRENT declared permission list as the
 * approved set for `id`. Called on Approve. Mirrors `setExtensionEnabled`'s
 * atomic write. After this, `consentStateFor` returns `needsConsent:null` until
 * a future update widens the declared set again.
 */
export async function grantConsent(
  id: string,
  declared: readonly string[] | undefined
): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const root = getExtensionsDir();
  const file = getConsentFile();
  const map = await readConsentMap();
  map[id] = { permissions: [...new Set(declared ?? [])] };
  try {
    await mkdir(root, { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2));
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/** Forget consent for `id` (on uninstall, or an explicit revoke). */
export async function revokeConsent(id: string): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const file = getConsentFile();
  const map = await readConsentMap();
  if (!(id in map)) return { ok: true, value: true };
  delete map[id];
  try {
    await mkdir(getExtensionsDir(), { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2));
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
