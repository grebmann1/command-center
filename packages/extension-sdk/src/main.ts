/**
 * Main-process side of the extension contract (`@cctc/extension-sdk/main`).
 * Separate from `./renderer` so the main bundle never imports React types.
 *
 * An extension's main module declares named **capabilities** — async functions
 * the renderer reaches via `ModuleHost.call(capability, ...args)`. Core
 * multiplexes every extension over one IPC channel (`modules:call`) keyed by
 * `{ moduleId, capability }`, so an extension adds zero entries to the IPC
 * layer, the preload bridge, or `registerIpc()`.
 *
 * Capabilities run in the Electron main process with full Node access
 * (child_process, fs, net). Keep them pure data in / data out: the return
 * value is structured-cloned across IPC, so it must be JSON-serialisable.
 */

/** A single capability: arbitrary JSON-serialisable args in, value out. */
export type ModuleCapability = (...args: any[]) => Promise<unknown> | unknown;

/**
 * Context handed to an extension's main module at registration time. Gives an
 * extension the host services it can't (and shouldn't) reimplement — same
 * decoupling rule as the renderer: no reaching into core internals.
 */
export interface MainModuleContext {
  /** Per-extension persistent KV store (backs `ModuleHost.storage`). */
  storage: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  /** Structured logger; messages are tagged with the extension id. */
  log: (message: string, err?: unknown) => void;
}

/**
 * An extension's main-process declaration. Registered in the main module
 * registry. `setup` is called once at app boot and returns the capability map
 * that backs `ModuleHost.call`.
 */
export interface MainModule {
  /** Must match the renderer `AppModule.id`. */
  id: string;
  /**
   * Build the capability map. Called once during `app.whenReady`. May be
   * sync or async (e.g. to warm a cache). Throwing here disables the
   * extension's capabilities but never crashes the app.
   */
  setup(ctx: MainModuleContext): Record<string, ModuleCapability> | Promise<Record<string, ModuleCapability>>;
}
