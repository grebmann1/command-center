/**
 * App-module contract — the **only** surface a feature module (under
 * `plugins/<id>/`) is allowed to import from the core app.
 *
 * A "module" is a self-contained feature (e.g. GUS) that plugs a nav entry
 * and a panel into the app shell without editing core wiring. It declares
 * itself once in the renderer registry (`src/renderer/modules/index.ts`)
 * and the main registry (`src/main/modules/index.ts`); core discovers it
 * from there and routes IPC, nav, and storage generically.
 *
 * Decoupling rule: modules import from `@shared/module-api` (this file) and
 * `@shared/module-main`, plus their own files. They must NOT import core
 * stores, IPC channel names, or other modules. The boundary is the contract
 * below — keep it stable and modules stay drop-in.
 *
 * This file is renderer-facing (React types). Main-process module types live
 * in `module-main.ts` so the main bundle never pulls in React.
 */

import type { ComponentType } from 'react';

/**
 * Capability bridge handed to a module's panel. Everything a module needs
 * from the host goes through here — there is deliberately no escape hatch to
 * `window.cc` or core stores, so a module stays portable.
 */
export interface ModuleHost {
  /** Stable id of the owning module (e.g. `'gus'`). */
  readonly moduleId: string;

  /**
   * Invoke one of the module's own main-process capabilities (declared in
   * its `MainModule.capabilities`). Multiplexed over a single core IPC
   * channel keyed by `moduleId` + `capability`; the module never registers
   * its own `ipcMain.handle`.
   *
   * @returns the capability's resolved value, or throws with its error message.
   */
  call<T = unknown>(capability: string, ...args: unknown[]): Promise<T>;

  /**
   * Persistent key/value storage namespaced to this module. Backed by a
   * JSON file under the app data dir; values must be JSON-serialisable.
   * Use for view preferences (selected sprint, collapsed columns, …).
   */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };

  /** Open a URL in the user's default browser. */
  openExternal(url: string): void;

  /** Push a message to the user's inbox (markdown + optional project docs). */
  pushInbox(msg: { comments?: string; docs?: Array<{ path: string }> }): Promise<void>;

  /** Surface a transient toast in the app shell. */
  toast(message: string, kind?: 'info' | 'error'): void;
}

/**
 * A module's renderer-side declaration. Registered in the renderer module
 * registry; core renders the nav entry and lazily mounts `panel` when the
 * module's nav is active.
 */
export interface AppModule {
  /** Stable, URL-safe id. Doubles as the NavId and the storage namespace. */
  id: string;
  /** Sidebar label. */
  title: string;
  /**
   * Lucide icon name (resolved by core against `lucide-react`). Kept as a
   * string so the contract has no dependency on the icon library's types.
   */
  icon: string;
  /** Window-title suffix when active; defaults to `title`. */
  titleLabel?: string;
  /**
   * The panel component. `host` is injected by core. Plain (not lazy) — the
   * registry decides whether to wrap it in `React.lazy`. Modules that want
   * code-splitting can export a lazy component here themselves.
   */
  panel: ComponentType<{ host: ModuleHost }>;
}
