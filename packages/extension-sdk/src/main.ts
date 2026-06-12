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
  /**
   * Per-extension persistent KV store (backs `ModuleHost.storage`).
   *
   * NOTE (P3-A): for built-in modules (in-process) `get` returns synchronously.
   * For a DISK extension running out-of-process in its `utilityProcess`, the
   * store lives host-side and `get` resolves a Promise over the broker port —
   * `await ctx.storage.get(key)` works in both cases. The store is namespaced by
   * the AUTHENTICATED extension id the host binds to the child's port, never an
   * id the extension supplies, so one extension cannot read another's namespace.
   */
  storage: {
    get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
    set(key: string, value: unknown): void;
  };
  /** Structured logger; messages are tagged with the extension id. */
  log: (message: string, err?: unknown) => void;

  /**
   * Brokered capabilities (P3-B). Each is performed HOST-SIDE and gated
   * deny-by-default against the extension's granted permissions + scopes
   * (see `ExtensionManifest.permissions` / `permissionScopes`). For a DISK
   * extension these forward over the `utilityProcess` MessagePort to the host,
   * which checks the permission for the AUTHENTICATED extension id before acting
   * and rejects with a `PermissionDenied`-tagged error otherwise.
   *
   * Built-in modules run in-process and TRUSTED: they may keep using raw Node
   * (`child_process`/`fs`/`fetch`) directly and need not use these. The members
   * are optional so a `{storage, log}`-only module still typechecks.
   *
   * RESIDUAL (honest): the child now installs a Node-builtin denylist
   * (P3-HARDEN: ESM loader hook + CJS `require` patch + neutered
   * `process.binding`), so `import('node:child_process')` / `require('fs')` no
   * longer trivially bypass `exec`. These brokered caps are the SANCTIONED,
   * permission-gated, audited path. This is JS-level deprivation, NOT an OS
   * sandbox — a native addon (`process.dlopen`) or realm escape could still reach
   * raw OS; the true seal (Node `--permission` / OS sandbox) is a follow-up.
   */
  exec?: (req: ExecRequest) => Promise<ExecResult>;
  fs?: {
    readFile(path: string, encoding?: 'utf-8'): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
  };
  fetch?: (url: string, init?: BrokeredFetchInit) => Promise<BrokeredFetchResponse>;
}

/** A no-shell process exec. `bin` is a basename checked against the exec allowlist. */
export interface ExecRequest {
  /** Executable basename (e.g. `"sf"`). NO path separators, NO shell string. */
  bin: string;
  /** Argument vector, passed without a shell. */
  args?: string[];
  /** Working directory; must be within a granted fs root if provided. */
  cwd?: string;
  /** Hard timeout (ms); the host caps it regardless. */
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null if the process exited via a signal. */
  code: number | null;
  /**
   * The signal the process exited on (e.g. `"SIGSEGV"`), when `code` is null;
   * otherwise absent. NOTE: a *spawn failure* (bin not found) or a *host
   * watchdog kill* (timeout / output-cap exceeded) does not return a result at
   * all — `ctx.exec` REJECTS in those cases (S3), so a `{code:null}` result here
   * always means "ran, then died on a signal", never "never ran".
   */
  signal?: string | null;
}

/** Minimal, JSON-serialisable fetch init the broker honours. */
export interface BrokeredFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface BrokeredFetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
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
  /**
   * Release any process-level resources the extension acquired in `setup`
   * (timers, fs/file watchers, child processes, open sockets). Called when the
   * extension is disabled or uninstalled — and, for runtime-loaded extensions,
   * before a hot-reload re-imports the module. May be sync or async; the host
   * awaits it. Throwing here is logged and isolated, never crashes the app.
   * Optional: a stateless extension needs no teardown.
   */
  teardown?(): void | Promise<void>;
}
