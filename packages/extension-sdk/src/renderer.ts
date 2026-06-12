/**
 * Renderer-facing extension contract — the surface an extension's **panel**
 * imports (`@cctc/extension-sdk/renderer`). React types live here, so the
 * main bundle never pulls them in (main-side types are in `./main`).
 *
 * An extension is a self-contained feature (e.g. GUS) that plugs a nav entry
 * and a panel into the app shell without editing core wiring. It reaches the
 * host **only** through `ModuleHost` below — there is deliberately no escape
 * hatch to `window.cc` or core stores, so an extension stays portable.
 */

import type { ComponentType } from 'react';
import type { ExtensionPermission } from './index.js';

/**
 * Capability bridge handed to an extension's panel. Everything an extension
 * needs from the host goes through here.
 */
export interface ModuleHost {
  /** Stable id of the owning extension (e.g. `'gus'`). */
  readonly moduleId: string;

  /**
   * Invoke one of the extension's own main-process capabilities (declared in
   * its `MainModule.capabilities`). Multiplexed over a single core IPC
   * channel keyed by `moduleId` + `capability`; the extension never registers
   * its own `ipcMain.handle`.
   *
   * @returns the capability's resolved value, or throws with its error message.
   */
  call<T = unknown>(capability: string, ...args: unknown[]): Promise<T>;

  /**
   * Persistent key/value storage namespaced to this extension. Backed by a
   * JSON file under the app data dir; values must be JSON-serialisable.
   * Use for view preferences (selected sprint, collapsed columns, …).
   */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };

  /** Open a URL in the user's default browser. */
  openExternal(url: string): void;

  /**
   * Push a message to the user's inbox (markdown + optional project docs).
   * `projectId` defaults to the shell's active project; rejects if neither is
   * available. At least one of `comments`/`docs` must be present.
   *
   * @returns the new inbox entry's id.
   */
  pushInbox(msg: {
    projectId?: string;
    comments?: string;
    docs?: Array<{ path: string }>;
  }): Promise<{ id: string }>;

  /** Surface a transient toast in the app shell. */
  toast(message: string, kind?: 'info' | 'error'): void;

  /**
   * The project currently selected in the app shell, or null when none / on a
   * core view. Lets an extension scope its data to the active project's directory.
   */
  getActiveProject(): { id: string; name: string; path: string } | null;

  /**
   * All projects open in the app shell (id, name, absolute path). Lets an
   * extension offer a project picker without reaching into core stores.
   */
  listProjects(): Array<{ id: string; name: string; path: string }>;

  /**
   * Make a project the app's globally-selected project — the same effect as
   * clicking it in the core Projects sidebar. Lets an extension keep the shell's
   * selection in sync with its own in-panel project picker. No-op for an
   * unknown id. Pass null to clear the selection.
   */
  selectProject(projectId: string | null): void;

  /**
   * Launch an interactive Claude session in a project and navigate the shell to
   * the new tab. Always launches the base `claude` launch profile — an extension
   * shapes the run (model, system prompt, allowed/denied tools, permission
   * mode, opening prompt) by passing the corresponding CLI flags via
   * `extraArgs`, which are appended last and so win over global/project
   * defaults.
   *
   * @returns the new session's id, or null when it couldn't be created (e.g.
   *          no project matches `projectId`).
   */
  launchSession(opts: {
    projectId: string;
    extraArgs?: string[];
    title?: string;
    cwd?: string;
  }): Promise<{ id: string } | null>;
}

/**
 * An extension's renderer-side declaration. Registered in the renderer module
 * registry; core renders the nav entry and lazily mounts `panel` when the
 * extension's nav is active.
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
   * registry decides whether to wrap it in `React.lazy`. Extensions that want
   * code-splitting can export a lazy component here themselves.
   */
  panel: ComponentType<{ host: ModuleHost }>;
  /**
   * Capabilities this extension intends to use. **Declared now, not yet
   * enforced** — curated extensions are trusted, so this is documentation and
   * forward-compatibility. Enforcement (a permission broker at the dispatch
   * boundary) lands when the platform opens to untrusted third parties.
   */
  permissions?: ExtensionPermission[];
}

/**
 * The shape a **runtime-loaded** panel bundle must `default`-export. This is the
 * disk-loading counterpart to `AppModule.panel`: where a built-in module hands
 * core a ready React `ComponentType`, a runtime-loaded extension instead exports
 * a factory that core calls to *build* that component.
 *
 * **Why a factory instead of exporting the component directly?**
 * A runtime-loaded panel is a separately-built ESM bundle. If it did
 * `import 'react'` of its own, the bundler would either inline a *second* copy
 * of React or rely on a fragile import-map to dedupe against the host's copy.
 * Two React instances in one tree break hooks ("Invalid hook call" / mismatched
 * dispatcher) because hook state lives in module-level singletons. To avoid
 * that, the host passes **its own React instance** into `activate`; the panel
 * builds its component closed over that instance, so every hook the panel runs
 * resolves against the host's React tree. The extension's bundle externalizes
 * `react` entirely and never ships or imports one.
 *
 * `activate` is called once per mount by the host loader; the returned component
 * receives the same `{ host }` prop contract as `AppModule.panel`, so a panel's
 * body is identical whether it's built-in or runtime-loaded.
 *
 * Built-in modules keep using `AppModule.panel` unchanged — this factory is the
 * *runtime* code path, not a replacement for it.
 *
 * @example
 * ```ts
 * // extension's renderer entry, built as ESM with `react` externalized
 * import type { RendererEntry } from '@cctc/extension-sdk/renderer';
 *
 * const entry: RendererEntry = {
 *   activate({ React, host }) {
 *     return function Panel() {
 *       const [n, setN] = React.useState(0); // host's React → hooks work
 *       return React.createElement('button', { onClick: () => setN(n + 1) }, `${host.moduleId}: ${n}`);
 *     };
 *   },
 * };
 * export default entry;
 * ```
 */
export interface RendererEntry {
  /**
   * Build the panel component. The host injects its own React instance and the
   * capability bridge; the returned component is mounted with `{ host }`.
   */
  activate(ctx: { React: typeof import('react'); host: ModuleHost }): ComponentType<{ host: ModuleHost }>;
}
