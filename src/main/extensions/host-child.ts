/**
 * Per-extension child bootstrap (P3-A) — runs INSIDE an Electron
 * `utilityProcess`, one process per untrusted DISK extension. This is the file
 * `ExtensionProcessHost.spawn()` forks. It is **core-owned, trusted** code; the
 * untrusted extension main module is `import()`'d *by this bootstrap, inside the
 * child*, so its `setup()` and capabilities never execute in the Electron main
 * process. That import is the line that used to be `loader.ts:114-115` — it
 * moves here verbatim.
 *
 * Lifecycle:
 *   1. The host forks this file and posts ONE `MessagePort` via
 *      `process.parentPort`. We grab that port and speak the `host-protocol`
 *      JSON-RPC over it; we do not use `parentPort` for anything else.
 *   2. On `{type:'init', entryPath, moduleId}` we `import(pathToFileURL(entryPath))`,
 *      take `default` as a `MainModule`, and call `setup(proxyCtx)`.
 *   3. `proxyCtx.storage`/`log` are PROXY stubs: each call posts a `broker`
 *      request to the host and (for storage.get) awaits the reply. The real
 *      store lives host-side, keyed by the AUTHENTICATED id (design §3d) — the
 *      child cannot read another extension's namespace.
 *   4. We answer `{type:'call'}` by invoking the matching capability and
 *      `{type:'teardown'}` by calling the module's `teardown?()`.
 *
 * CAPABILITY DEPRIVATION (P3-HARDEN): before the untrusted `import()`, the child
 * installs a Node-builtin denylist (`host-child-guard.ts`): an ESM loader hook +
 * a `Module._load` patch + neutered `process.binding`, so the ext cannot reach
 * raw `child_process`/`fs`/`net`/… and skip the broker. The brokered ctx
 * (exec/fs/fetch/storage/log over the port) is the only practical capability
 * path. See `host-child-guard.ts` for the honest residual (this is JS-level, not
 * an OS sandbox; `process.dlopen`/native addons remain). The other WIN
 * (from P3-A): untrusted code no longer runs in MAIN (no BrowserWindow, no app
 * state, no sibling modules' memory) and a crash/hang is contained to this child.
 */

import module from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  installChildBuiltinGuard,
  denylistLoaderHookUrl
} from './host-child-guard.js';
import type {
  MainModule,
  MainModuleContext,
  ModuleCapability,
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse
} from '../../shared/module-main.js';
import {
  errToString,
  type BrokerMethod,
  type ChildToHost,
  type HostToChild
} from './host-protocol.js';

/**
 * Electron injects `process.parentPort` (a MessagePortMain) into a
 * utilityProcess child. It's not in @types/node, so narrow it locally.
 */
interface ParentPortLike {
  on(event: 'message', listener: (e: { data: unknown; ports: PortLike[] }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
}
interface PortLike {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
}

function getParentPort(): ParentPortLike {
  const pp = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (!pp) {
    throw new Error('host-child must run inside an Electron utilityProcess (no parentPort)');
  }
  return pp;
}

/** Structural MainModule check — mirrors loader.ts `isMainModule`. */
function isMainModule(v: unknown): v is MainModule {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && !!m.id && typeof m.setup === 'function';
}

/**
 * Install the Node-builtin denylist (P3-HARDEN) BEFORE any untrusted code can
 * run. The bootstrap's own imports (above) are already resolved at top-level, so
 * registering the ESM loader hook now only affects the *untrusted* graph imported
 * later in {@link handleInit}. CJS `require` + `process.binding` are patched
 * synchronously. Failure to install is fatal — we must not import an extension
 * unguarded.
 */
function installBuiltinDenylist(): void {
  installChildBuiltinGuard();
  module.register(denylistLoaderHookUrl());
}

function start(): void {
  installBuiltinDenylist();
  const parentPort = getParentPort();

  // The host's data port arrives on the FIRST `cctc-port` parentPort message
  // (sent by spawn-child.ts). Bind exactly once: a second port-bearing message
  // must NOT spin up a second module instance / broker sequence. Everything
  // after the handoff flows over `port`, not parentPort.
  let bound = false;
  parentPort.on('message', (e) => {
    if (bound) return;
    const data = e.data as { type?: string } | undefined;
    if (data?.type !== 'cctc-port') return;
    const port = e.ports?.[0];
    if (!port) return;
    bound = true;
    runWithPort(port);
  });
  parentPort.start?.();
}

function runWithPort(port: PortLike): void {
  /** Pending broker requests (storage.get) awaiting the host's reply. */
  const brokerWaiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let brokerSeq = 0;
  let capabilities: Record<string, ModuleCapability> = {};
  let moduleInstance: MainModule | null = null;

  const send = (msg: ChildToHost) => port.postMessage(msg);

  /** Post a broker request to the host and await its reply (storage.get/set). */
  function broker(method: BrokerMethod, args: unknown[]): Promise<unknown> {
    const reqId = ++brokerSeq;
    return new Promise<unknown>((resolve, reject) => {
      brokerWaiters.set(reqId, { resolve, reject });
      send({ type: 'broker', reqId, method, args });
    });
  }

  // The proxy ctx. storage.get is async over the wire, but the SDK's
  // `storage.get` is declared sync. We expose a sync-looking shape backed by a
  // host round-trip via a cached read on first touch is overkill for P3-A — the
  // current built-ins use storage synchronously, but DISK extensions go through
  // this proxy where get returns a Promise. We keep the SDK type and document
  // that disk-ext storage.get resolves a Promise. (Built-ins keep the real sync
  // store in-process via MainModuleHost; they never hit this proxy.)
  const proxyCtx: MainModuleContext = {
    storage: {
      get: (<T = unknown>(key: string) => broker('storage.get', [key]) as Promise<T | undefined>) as MainModuleContext['storage']['get'],
      set: (key: string, value: unknown) => {
        // Fire-and-forget from the module's perspective; the host persists.
        void broker('storage.set', [key, value]);
      }
    },
    log: (message: string, err?: unknown) => {
      void broker('log', [message, err === undefined ? undefined : errToString(err)]);
    },
    // Brokered capabilities (P3-B). Each forwards over the port; the host gates
    // it against this extension's granted permissions + scopes BEFORE acting and
    // rejects (PermissionDenied) if ungranted. The child gets only the result —
    // never a raw fd / socket / child_process handle.
    exec: (req: ExecRequest) => broker('exec', [req]) as Promise<ExecResult>,
    fs: {
      readFile: (path: string, encoding?: 'utf-8') =>
        broker('fs.readFile', [path, encoding]) as Promise<string>,
      writeFile: (path: string, data: string) =>
        broker('fs.writeFile', [path, data]) as Promise<void>,
      readdir: (path: string) => broker('fs.readdir', [path]) as Promise<string[]>
    },
    fetch: (url: string, init?: BrokeredFetchInit) =>
      broker('fetch', [url, init]) as Promise<BrokeredFetchResponse>
  };

  async function handleInit(entryPath: string, moduleId: string): Promise<void> {
    try {
      const url = pathToFileURL(entryPath).href;
      // THE untrusted import — runs HERE in the child, never in main.
      const imported = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      const candidate = imported.default;
      if (!isMainModule(candidate)) {
        send({ type: 'setup-error', moduleId, error: 'main entry has no valid default MainModule export' });
        return;
      }
      moduleInstance = candidate;
      const caps = await candidate.setup(proxyCtx);
      capabilities = caps && typeof caps === 'object' ? caps : {};
      send({ type: 'ready', moduleId, capabilities: Object.keys(capabilities) });
    } catch (err) {
      send({ type: 'setup-error', moduleId, error: errToString(err) });
    }
  }

  async function handleCall(callId: number, capability: string, args: unknown[]): Promise<void> {
    const fn = capabilities[capability];
    if (typeof fn !== 'function') {
      send({ type: 'result', callId, ok: false, error: `Unknown capability: ${capability}` });
      return;
    }
    try {
      const result = await fn(...args);
      send({ type: 'result', callId, ok: true, result });
    } catch (err) {
      send({ type: 'result', callId, ok: false, error: errToString(err) });
    }
  }

  async function handleTeardown(callId: number): Promise<void> {
    try {
      if (moduleInstance?.teardown) await moduleInstance.teardown();
      send({ type: 'result', callId, ok: true });
    } catch (err) {
      send({ type: 'result', callId, ok: false, error: errToString(err) });
    }
  }

  port.on('message', (e) => {
    const msg = e.data as HostToChild;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'init':
        void handleInit(msg.entryPath, msg.moduleId);
        break;
      case 'call':
        void handleCall(msg.callId, msg.capability, msg.args);
        break;
      case 'teardown':
        void handleTeardown(msg.callId);
        break;
      case 'broker-result': {
        const waiter = brokerWaiters.get(msg.reqId);
        if (waiter) {
          brokerWaiters.delete(msg.reqId);
          if (msg.ok) waiter.resolve(msg.result);
          else waiter.reject(new Error(msg.error ?? 'broker request failed'));
        }
        break;
      }
    }
  });
  port.start();
}

start();
