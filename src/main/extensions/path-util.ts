/**
 * Tiny electron-free path containment helper, shared by the extension scanner
 * (discovery.ts) and core (index.ts). Both need to verify a resolved path lives
 * inside a parent dir before reading/importing it — discovery.ts is
 * intentionally electron-free, so this lives apart from index.ts to keep that.
 */

import { relative, isAbsolute, resolve } from 'node:path';

/**
 * True when `child` resolves to `parent` itself or a path nested inside it.
 * Uses `relative()` + a `..`/absolute check (cross-platform; no separator
 * assumption) rather than a string-prefix compare. `child` must be absolute.
 */
export function isWithin(child: string, parent: string): boolean {
  if (!isAbsolute(child)) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolve `entry` relative to `dir` and return the absolute path only if it
 * stays within `dir`; null on escape (e.g. a `../../evil.js` manifest entry).
 */
export function resolveContained(dir: string, entry: string): string | null {
  const target = resolve(dir, entry);
  return isWithin(target, resolve(dir)) ? target : null;
}
