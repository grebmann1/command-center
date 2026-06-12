/**
 * Permission enforcement for extensions (P3-B). Turns the DECLARED
 * `ExtensionPermission` union into ENFORCED, deny-by-default gates.
 *
 * Trust tier is PROVENANCE, not capability:
 *   - BUILT-IN modules (gus, zana — the `MAIN_MODULES` ids) ship with the app
 *     and are TRUSTED. `can()` always returns true for them; they never hit the
 *     broker (they run in-process with raw Node) — but if a built-in id is ever
 *     asked, it is allowed.
 *   - DISK extensions are UNTRUSTED. A capability is allowed only if its
 *     permission is in that extension's GRANTED set (+ scope checks for
 *     exec bins / fs paths / fetch hosts). Anything not granted → denied.
 *
 * Deny-by-default everywhere: an unknown id, an extension with no manifest, an
 * ungranted permission, or an out-of-scope concrete request all reject.
 *
 * P3-D SEAM: `grantedPermissions(moduleId)` is the single source of truth for
 * what a disk ext may do. Today it returns `declared = manifest.permissions`.
 * P3-D will swap the *provider* to return `declared ∩ user-consented` (the
 * consent screen's stored grant) WITHOUT changing the broker or any gate — they
 * only ever consult this function. Inject a different `GrantProvider` to do so.
 */

import { basename } from 'node:path';
import { homedir } from 'node:os';
import { resolve, isAbsolute } from 'node:path';
import { isWithin } from './path-util.js';
import type { ExtensionPermission } from '@cctc/extension-sdk';

/** Scope arg for a concrete request, interpreted per-permission. */
export type PermissionScope =
  | { kind: 'exec'; bin: string }
  | { kind: 'fs'; path: string }
  | { kind: 'net'; host: string };

/** What the broker needs to know about ONE disk extension. */
export interface ExtensionGrant {
  /** Granted permission tokens (for P3-B: the declared manifest permissions). */
  permissions: ReadonlySet<ExtensionPermission>;
  /** Allowed exec basenames. */
  execAllowlist: ReadonlySet<string>;
  /** Canonicalized fs roots the ext may touch (its own dir is added by the host). */
  fsRoots: readonly string[];
  /** Allowed egress hostnames. */
  egressAllowlist: ReadonlySet<string>;
}

/**
 * Provides the live grant for a disk-ext id, or null if it is unknown / not a
 * disk ext. P3-D replaces the implementation (declared ∩ consented) without the
 * broker changing.
 */
export type GrantProvider = (moduleId: string) => ExtensionGrant | null;

/** Roots that are NEVER writable even if a granted fsRoot would cover them. */
function sensitiveRoots(): string[] {
  const home = homedir();
  return [resolve(home, '.ssh'), resolve(home, '.aws'), resolve(home, '.cc-center')];
}

export interface AuditEntry {
  ts: number;
  moduleId: string;
  permission: string;
  scope?: string;
  allow: boolean;
}

export interface PermissionBrokerDeps {
  /** Ids that are built-in (trusted) — always allowed. */
  builtinIds: ReadonlySet<string>;
  /** Live grant lookup for disk exts (the P3-D seam). */
  grants: GrantProvider;
  /** Audit sink (allow + deny lines). */
  audit?: (entry: AuditEntry) => void;
}

/** Thrown (or its message used) when a gate rejects. The renderer/child sees this text. */
export class PermissionDenied extends Error {
  constructor(moduleId: string, permission: string, detail?: string) {
    super(`PermissionDenied: ${moduleId} lacks "${permission}"${detail ? ` (${detail})` : ''}`);
    this.name = 'PermissionDenied';
  }
}

export class PermissionBroker {
  constructor(private readonly deps: PermissionBrokerDeps) {}

  /** True if this id is a trusted built-in (bypasses all enforcement). */
  isBuiltin(moduleId: string): boolean {
    return this.deps.builtinIds.has(moduleId);
  }

  /**
   * Deny-by-default decision. Built-ins: always true. Disk exts: the permission
   * must be granted AND (for scoped perms) the concrete scope must pass.
   * Audits both allow and deny.
   */
  can(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): boolean {
    const allow = this.decide(moduleId, permission, scope);
    this.deps.audit?.({
      ts: Date.now(),
      moduleId,
      permission,
      scope: scope ? scopeToString(scope) : undefined,
      allow
    });
    return allow;
  }

  /** Like {@link can} but throws {@link PermissionDenied} instead of returning false. */
  assert(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): void {
    if (!this.can(moduleId, permission, scope)) {
      throw new PermissionDenied(moduleId, permission, scope ? scopeToString(scope) : undefined);
    }
  }

  private decide(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): boolean {
    if (this.isBuiltin(moduleId)) return true; // trusted by provenance

    const grant = this.deps.grants(moduleId);
    if (!grant) return false; // unknown / not a disk ext → deny
    if (!grant.permissions.has(permission)) return false; // bare permission ungranted

    if (!scope) return true; // unscoped permission, granted

    switch (scope.kind) {
      case 'exec':
        // basename only — never accept a path or a shell string.
        return scope.bin === basename(scope.bin) && grant.execAllowlist.has(scope.bin);
      case 'fs': {
        if (!isAbsolute(scope.path)) return false;
        const canonical = resolve(scope.path);
        const inRoot = grant.fsRoots.some((root) => isWithin(canonical, root));
        if (!inRoot) return false;
        // Writes additionally never touch a sensitive root.
        if (permission === 'fs:write') {
          if (sensitiveRoots().some((s) => isWithin(canonical, s))) return false;
        }
        return true;
      }
      case 'net':
        return grant.egressAllowlist.has(scope.host.toLowerCase());
      default:
        return false;
    }
  }
}

function scopeToString(scope: PermissionScope): string {
  switch (scope.kind) {
    case 'exec':
      return `bin=${scope.bin}`;
    case 'fs':
      return `path=${scope.path}`;
    case 'net':
      return `host=${scope.host}`;
  }
}

/**
 * Build an {@link ExtensionGrant} from a disk ext's declared manifest view.
 * P3-B: granted = declared. `~`-prefixed / relative fsRoots are canonicalized;
 * the extension's own dir is added so it can always read its bundle.
 *
 * P3-D will wrap/replace this to intersect with the stored user consent.
 */
export function grantFromManifest(
  permissions: readonly string[] | undefined,
  scopes: { execAllowlist?: string[]; fsRoots?: string[]; egressAllowlist?: string[] } | undefined,
  extDir: string
): ExtensionGrant {
  const fsRoots = [resolve(extDir)];
  for (const root of scopes?.fsRoots ?? []) {
    fsRoots.push(canonicalizeRoot(root));
  }
  return {
    permissions: new Set((permissions ?? []) as ExtensionPermission[]),
    execAllowlist: new Set(scopes?.execAllowlist ?? []),
    fsRoots,
    egressAllowlist: new Set((scopes?.egressAllowlist ?? []).map((h) => h.toLowerCase()))
  };
}

/** Resolve a `~`-prefixed or relative root to an absolute canonical path. */
function canonicalizeRoot(root: string): string {
  if (root === '~' || root.startsWith('~/')) {
    return resolve(homedir(), root.slice(root === '~' ? 1 : 2));
  }
  return resolve(root);
}
