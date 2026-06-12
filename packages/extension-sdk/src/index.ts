/**
 * Process-agnostic entry for `@cctc/extension-sdk`. Holds the API version,
 * the permission vocabulary, and small `define*` helpers. Safe to import from
 * either process (no React, no Node).
 *
 * Subpath entries:
 *   - `@cctc/extension-sdk/renderer` — AppModule, ModuleHost (React peer dep)
 *   - `@cctc/extension-sdk/main`     — MainModule, MainModuleContext
 *   - `@cctc/extension-sdk/helpers`  — pure runtime helpers (markdown, …)
 */

import type {
  AppModule,
  ModuleHost,
  RendererEntry,
  ActivateResult,
  HostEvents,
  SessionInfo,
  ExtensionCommand,
} from './renderer.js';
import type { MainModule, MainModuleContext } from './main.js';

/**
 * Integer contract version. Bumped only on a breaking change to the extension
 * contract. An extension's manifest declares the range it supports; the host
 * compares against this constant at load and refuses to mount on a mismatch.
 */
export const SDK_API_VERSION = 1;

/**
 * Capabilities an extension may declare it intends to use.
 *
 * As of Phase 3-B these are **ENFORCED deny-by-default for DISK extensions**:
 * a brokered capability or gated host method whose permission is absent from
 * the extension's granted set is rejected. Built-in modules (gus/zana, shipped
 * with the app) are TRUSTED and bypass enforcement entirely — the trust tier is
 * PROVENANCE, not capability.
 *
 * The `exec` / `fs:read` / `fs:write` / `net` tokens gate the brokered
 * {@link MainModuleContext} capabilities (P3-B); their scoping (which bins /
 * paths / hosts) is declared alongside in {@link ExtensionManifest.permissionScopes}.
 */
export type ExtensionPermission =
  | 'storage'
  | 'projects:read'
  | 'projects:select'
  | 'session:launch'
  | 'external:open'
  | 'inbox:push'
  // Brokered main-side capabilities (P3-B), scoped via `permissionScopes`:
  | 'exec'
  | 'fs:read'
  | 'fs:write'
  | 'net';

/**
 * Per-permission SCOPING an extension declares alongside its `permissions`.
 * The permission token says "may exec / read / reach"; the scope says **what**.
 * Deny-by-default: an empty/absent scope means the gate rejects every concrete
 * request even if the bare permission is granted. Surfaced verbatim to the P3-D
 * consent screen so the user sees exactly what an extension may run/read/reach.
 */
export interface ExtensionPermissionScopes {
  /** Allowed executable basenames for `ctx.exec` (e.g. `["sf","git"]`). No paths, no shell. */
  execAllowlist?: string[];
  /**
   * Filesystem roots `ctx.fs.*` may touch, as absolute paths or `~`-prefixed
   * home paths. A request is allowed only if its canonical path is within one
   * granted root. The extension's OWN dir is always implicitly readable.
   */
  fsRoots?: string[];
  /** Allowed egress hosts for `ctx.fetch` (hostname only, e.g. `["api.github.com"]`). */
  egressAllowlist?: string[];
}

/**
 * Static description of a runtime-loaded extension, authored as the `cctc`
 * block of the extension's `package.json` (so an extension is npm-native and
 * installable). The host's disk loader reads this to register the extension's
 * nav entry, locate its bundles, and gate it against the contract version
 * before mounting.
 *
 * Mirrors the `package.json#cctc` shape sketched in the findings:
 * ```jsonc
 * {
 *   "engines": { "cctcApi": ">=1 <2" },
 *   "cctc": {
 *     "id": "gus", "title": "GUS", "icon": "Ticket",
 *     "entry": { "renderer": "./dist/renderer.js", "main": "./dist/main.js" },
 *     "permissions": ["storage", "projects:read", "session:launch", "inbox:push"]
 *   }
 * }
 * ```
 * Note `engines.cctcApi` lives at the package.json root (npm-native) while the
 * rest lives under `cctc`; loaders typically merge them into this one object.
 */
export interface ExtensionManifest {
  /** Stable, URL-safe id. Doubles as NavId and storage namespace; matches `AppModule.id` / `MainModule.id`. */
  id: string;
  /** Sidebar label. */
  title: string;
  /** Lucide icon name, resolved by core against `lucide-react`. */
  icon: string;
  /** Window-title suffix when active; defaults to `title`. */
  titleLabel?: string;
  /**
   * Bundle entry points relative to the extension root. Both optional: a
   * renderer-only extension omits `main`; a headless/main-only one omits
   * `renderer`.
   */
  entry: { renderer?: string; main?: string };
  /** Contract-version requirement (see {@link checkApiCompat}), e.g. `">=1 <2"`. */
  engines: { cctcApi: string };
  /**
   * Capabilities the extension intends to use. ENFORCED deny-by-default for disk
   * extensions as of P3-B (built-ins bypass). The granted set is derived from
   * this list today; P3-D will intersect it with explicit user consent.
   */
  permissions?: ExtensionPermission[];
  /**
   * Scoping for the brokered permissions (`exec`/`fs:*`/`net`). Optional; an
   * absent scope means the corresponding capability rejects every concrete
   * request (deny-by-default) even when the bare permission is granted.
   */
  permissionScopes?: ExtensionPermissionScopes;
}

/**
 * Identity helper for an extension's renderer declaration. Gives editors full
 * type inference at the definition site and acts as a forward-compat seam if
 * the contract gains required fields later.
 */
export function defineModule(m: AppModule): AppModule {
  return m;
}

/** Identity helper for an extension's main-process declaration. */
export function defineMainModule(m: MainModule): MainModule {
  return m;
}

/**
 * Check an extension manifest's `engines.cctcApi` range against the host's
 * contract version. The host calls this at load and refuses to mount on a
 * mismatch. Deliberately **no semver dependency** — the parser is a small
 * hand-rolled subset covering both the host-facing integer-comparator grammar
 * and the semver-ish forms extension authors naturally write.
 *
 * Two token grammars are accepted (intermixable across space-separated tokens,
 * all of which must hold — logical AND):
 *
 *   1. Integer comparators: `>=N`, `<=N`, `>N`, `<N`, `=N`, or a bare `N`
 *      (treated as `=N`). `N` is a non-negative integer (the contract version
 *      is an integer, not SemVer).
 *   2. Semver-ish "major pin" forms — `^1.0.0`, `~1.2.0`, `1.x`, `1.2.x`,
 *      `1`, `1.2`, `1.2.3`. Because the contract version is a single integer,
 *      every one of these is interpreted as "major version === leading
 *      number". So `^1.0.0`, `~1.2`, `1.x`, and `1.2.3` all mean "major 1" and
 *      are satisfied when `current === 1`.
 *
 * Empty/whitespace-only ranges accept anything → `true`. Any token that
 * matches neither grammar fails closed → `false`.
 *
 * @param manifestRange the `engines.cctcApi` string (e.g. `">=1 <2"`, `"^1.0.0"`, `"1.x"`).
 * @param current the host contract version; defaults to {@link SDK_API_VERSION}.
 * @returns `true` when `current` satisfies every comparator in the range.
 *
 * @example
 * checkApiCompat('>=1 <2', 1); // true
 * checkApiCompat('>=1 <2', 2); // false
 * checkApiCompat('^1.0.0', 1); // true  (caret → major 1)
 * checkApiCompat('^1.0.0', 2); // false
 * checkApiCompat('~1.2', 1);   // true  (tilde → major 1)
 * checkApiCompat('1.x', 1);    // true
 * checkApiCompat('1', 1);      // true  (bare N === =N)
 * checkApiCompat('>=2');       // false when SDK_API_VERSION === 1
 */
export function checkApiCompat(manifestRange: string, current: number = SDK_API_VERSION): boolean {
  const tokens = manifestRange.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // no constraint → accept

  for (const token of tokens) {
    if (!tokenSatisfied(token, current)) return false;
  }
  return true;
}

/** Evaluate one range token against `current`. Fails closed on unparseable input. */
function tokenSatisfied(token: string, current: number): boolean {
  // Semver-ish "major pin" forms: `^1.0.0`, `~1.2.0`, `1.x`, `1.2.x`, `1.2.3`,
  // `1.2`, `1`. Any leading `^`/`~`, plus a dotted version where the segment(s)
  // after the major may be numbers or an `x`/`X` wildcard. The contract version
  // is a single integer, so all of these collapse to "major === current".
  const semverish = /^[\^~]?(\d+)(?:\.(?:\d+|[xX*]))*$/.exec(token);
  if (semverish) {
    // Disambiguate from the integer-comparator grammar: a bare `N` with no
    // caret/tilde/dot is handled identically below (`=N`), so it doesn't matter
    // which branch claims it. Here we only own tokens that are unmistakably
    // semver-ish (have a `^`/`~` or a `.`), or a bare integer.
    return current === Number(semverish[1]);
  }

  // Integer comparators: `>=N`, `<=N`, `>N`, `<N`, `=N`, bare `N`.
  const cmp = /^(>=|<=|>|<|=)?(\d+)$/.exec(token);
  if (cmp) {
    const op = cmp[1] ?? '=';
    const n = Number(cmp[2]);
    return (
      op === '>=' ? current >= n :
      op === '<=' ? current <= n :
      op === '>'  ? current > n :
      op === '<'  ? current < n :
      current === n // '=' or bare N
    );
  }

  return false; // unparseable → fail closed
}

export type {
  AppModule,
  ModuleHost,
  RendererEntry,
  ActivateResult,
  HostEvents,
  SessionInfo,
  ExtensionCommand,
  MainModule,
  MainModuleContext,
};
