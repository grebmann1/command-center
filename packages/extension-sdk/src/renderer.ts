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
 * A SMALL, stable session shape owned by the SDK and surfaced in
 * {@link HostEvents}. Deliberately *not* core's `TerminalSession` — the SDK
 * stays dependency-light and decoupled from core's internal model, so this is
 * the minimal projection an extension can rely on across versions. Core maps
 * its richer session onto this shape before emitting `'session:updated'`.
 */
export interface SessionInfo {
  /** Stable session id (the terminal/tab id). */
  id: string;
  /** Id of the project the session belongs to. */
  projectId: string;
  /** Human-readable tab title at the time of the event. */
  title: string;
  /** Opaque status string (core's session status; not a fixed union here). */
  status: string;
}

/**
 * The event catalogue an extension can subscribe to via {@link ModuleHost.on}.
 * Each key maps to a **read-only notification** core already emits; payloads are
 * plain, JSON-serialisable objects (they cross the IPC boundary or derive from
 * a store snapshot). Handlers must treat payloads as immutable and must not
 * assume any delivery ordering between distinct event types.
 *
 * Always unsubscribe (call the function `on` returns) in your effect cleanup —
 * a panel that subscribes on mount and never unsubscribes leaks handlers across
 * remounts.
 *
 * Mapping to the streams core emits today:
 *   - `'project:changed'` / `'nav:changed'` — store-derived (shell selection / active nav).
 *   - `'session:updated'`        ← `terminals.onUpdated`
 *   - `'session:agentStatus'`    ← `terminals.onAgentStatus`
 *   - `'session:exit'`           ← `terminals.onExit`
 *   - `'inbox:appended'`         ← `inbox.onAppended`
 *   - `'inbox:removed'`          ← `inbox.onRemoved`
 *   - `'schedule:changed'`       ← `scheduler.onChanged`
 *   - `'mcp:changed'`            ← `mcp.onChanged`
 *   - `'skills:changed'`         ← `skills.onChanged`
 */
export interface HostEvents {
  /**
   * The shell's globally-selected project changed (or was cleared). Mirrors
   * what {@link ModuleHost.getActiveProject} would now return — subscribe to
   * react to project switches instead of reading the active project once.
   */
  'project:changed': { project: { id: string; name: string; path: string } | null };
  /** The active nav (sidebar selection) changed; `nav` is the new NavId. */
  'nav:changed': { nav: string };
  /** A session's metadata changed (title, status, …). */
  'session:updated': { session: SessionInfo };
  /** A session's Claude agent transitioned between activity states. */
  'session:agentStatus': {
    sessionId: string;
    state: 'working' | 'blocked' | 'done' | 'idle' | 'unknown';
  };
  /** A session's process exited; `code` is the exit code. */
  'session:exit': { sessionId: string; code: number };
  /** A new inbox entry was appended; `id` is the new entry's id. */
  'inbox:appended': { id: string };
  /** An inbox entry was removed; `id` is the removed entry's id. */
  'inbox:removed': { id: string };
  /** The set/state of scheduled tasks changed. Empty payload — re-read as needed. */
  'schedule:changed': Record<string, never>;
  /** MCP server configuration changed. Empty payload — re-read as needed. */
  'mcp:changed': Record<string, never>;
  /** The installed skills set changed. Empty payload — re-read as needed. */
  'skills:changed': Record<string, never>;
}

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

  /**
   * Subscribe to a host event (see {@link HostEvents}). The handler fires with
   * the event's typed, JSON-serialisable payload on every occurrence until you
   * unsubscribe. These are **read-only notifications** — they tell the panel
   * something changed; they don't mutate anything.
   *
   * Follows core's `on*` convention: returns an **unsubscribe function**. Call
   * it in your effect cleanup so handlers don't leak across remounts.
   *
   * @example
   * ```ts
   * React.useEffect(() => {
   *   const off = host.on('project:changed', ({ project }) => setProject(project));
   *   return off; // unsubscribe on unmount
   * }, []);
   * ```
   */
  on<E extends keyof HostEvents>(event: E, cb: (payload: HostEvents[E]) => void): () => void;

  /**
   * Synchronous, in-memory scratch store, private to this extension. Reads and
   * writes are immediate (no Promise) and the contents **survive panel unmount**
   * — unlike React state, which is torn down when the nav switches away and the
   * panel is unmounted. It does **not** persist to disk and is gone when the app
   * (or the extension) restarts — unlike {@link ModuleHost.storage}, which is
   * async and durable.
   *
   * Purpose: replace the module-global `let cache` workaround extensions use to
   * keep computed/fetched data across remounts. Use `storage` for anything that
   * must outlive a restart (view preferences); use `cache` for ephemeral,
   * cheap-to-lose working data (a fetched list you don't want to refetch on
   * every remount).
   */
  cache: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
}

/**
 * A command an extension contributes to the app's command palette. Built by
 * {@link AppModule.commands} (given the live {@link ModuleHost}), so its `run`
 * can close over host capabilities. Shaped to be adaptable to core's internal
 * `PaletteItem` ({ key, label, run, … }) — core supplies the icon/hint when it
 * lifts these into the palette.
 */
export interface ExtensionCommand {
  /** Stable id, unique within the extension. Core namespaces it by `moduleId`. */
  id: string;
  /** Text shown in the command palette. */
  label: string;
  /** Invoked when the user picks the command. Fire-and-forget. */
  run: () => void;
  /** Extra fuzzy-match terms beyond `label` (aliases, synonyms). */
  keywords?: string[];
}

/**
 * An extension's renderer-side declaration. Registered in the renderer module
 * registry; core renders the nav entry and lazily mounts `panel` when the
 * extension's nav is active.
 *
 * A module contributes through any subset of three extension points —
 * {@link AppModule.panel}, {@link AppModule.commands}, and
 * {@link AppModule.navBadge}. At least one is expected; a module with none
 * registers a nav entry that does nothing useful.
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
   *
   * **Optional** as of the Phase 2 contract: a module may contribute only
   * `commands` and/or a `navBadge` without a panel. When omitted, the module's
   * nav entry has no view to mount — core decides how to present that (e.g.
   * hide the nav entry, or render a placeholder).
   */
  panel?: ComponentType<{ host: ModuleHost }>;
  /**
   * Commands this module contributes to the app's command palette. Called with
   * the live {@link ModuleHost} so each command's `run` can use host
   * capabilities. Returns a (possibly empty) array; core merges them into the
   * palette as `PaletteItem`s, namespaced by `id`.
   */
  commands?: (host: ModuleHost) => ExtensionCommand[];
  /**
   * A badge to render on this module's sidebar nav entry — a count (`number`)
   * or short label (`string`), or `null`/`0`/`''` for no badge. Called with the
   * live {@link ModuleHost}; core renders the result in the `.nav-badge` slot.
   * Keep it cheap and synchronous — it may be invoked on re-render. To keep the
   * badge live, recompute off {@link ModuleHost.cache} or store state updated
   * from a {@link ModuleHost.on} subscription.
   */
  navBadge?: (host: ModuleHost) => number | string | null;
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
