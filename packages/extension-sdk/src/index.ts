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

import type { AppModule, ModuleHost } from './renderer.js';
import type { MainModule, MainModuleContext } from './main.js';

/**
 * Integer contract version. Bumped only on a breaking change to the extension
 * contract. An extension's manifest declares the range it supports; the host
 * compares against this constant at load and refuses to mount on a mismatch.
 */
export const SDK_API_VERSION = 1;

/**
 * Capabilities an extension may declare it intends to use. **Declared now,
 * enforced later** — see `AppModule.permissions`.
 */
export type ExtensionPermission =
  | 'storage'
  | 'projects:read'
  | 'projects:select'
  | 'session:launch'
  | 'external:open'
  | 'inbox:push';

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

export type { AppModule, ModuleHost, MainModule, MainModuleContext };
