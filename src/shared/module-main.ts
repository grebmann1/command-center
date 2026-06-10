/**
 * Main-process side of the app-module contract. Separate from
 * `module-api.ts` so the main bundle never imports React types.
 *
 * A module's main module declares named **capabilities** — async functions
 * the renderer reaches via `ModuleHost.call(capability, ...args)`. Core
 * multiplexes every module over one IPC channel (`module:call`) keyed by
 * `{ moduleId, capability }`, so a module adds zero entries to `ipc.ts`,
 * the preload bridge, or `registerIpc()`.
 *
 * Capabilities run in the Electron main process with full Node access
 * (child_process, fs, net). Keep them pure data in / data out: the return
 * value is structured-cloned across IPC, so it must be JSON-serialisable.
 */

/** A single capability: arbitrary JSON-serialisable args in, value out. */
export type ModuleCapability = (...args: any[]) => Promise<unknown> | unknown;

/**
 * Context handed to a module's main module at registration time. Gives a
 * module the host services it can't (and shouldn't) reimplement — same
 * decoupling rule as the renderer: no reaching into core internals.
 */
export interface MainModuleContext {
  /** Per-module persistent KV store (backs `ModuleHost.storage`). */
  storage: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  /** Structured logger; messages are tagged with the module id. */
  log: (message: string, err?: unknown) => void;
}

/**
 * A module's main-process declaration. Registered in the main module
 * registry (`src/main/modules/index.ts`). `setup` is called once at app
 * boot and returns the capability map that backs `ModuleHost.call`.
 */
export interface MainModule {
  /** Must match the renderer `AppModule.id`. */
  id: string;
  /**
   * Build the capability map. Called once during `app.whenReady`. May be
   * sync or async (e.g. to warm a cache). Throwing here disables the
   * module's capabilities but never crashes the app.
   */
  setup(ctx: MainModuleContext): Record<string, ModuleCapability> | Promise<Record<string, ModuleCapability>>;
}
