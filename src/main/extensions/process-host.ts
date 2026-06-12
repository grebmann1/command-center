/**
 * Out-of-process host for untrusted DISK extensions (P3-A). One Electron
 * `utilityProcess` per disk extension; the extension's main `setup()` and its
 * capabilities run in that child (see `host-child.ts`), never in the Electron
 * main process. This is the parallel path to `MainModuleHost` (which keeps the
 * trusted built-in gus/zana in-process); a unified router (`module-router.ts`)
 * picks between them by moduleId.
 *
 * Responsibilities:
 *   - spawn(entry): fork the child bootstrap, hand it a MessagePort + the
 *     entry path + moduleId; wait for `ready` (setup done) or `setup-error`.
 *   - dispatch(moduleId, capability, args): RPC to that child WITH A TIMEOUT —
 *     a hung/crashed child rejects, it never wedges main.
 *   - teardown(moduleId): teardown RPC (short deadline) then kill the child.
 *   - liveModuleIds(): ids whose child is live AND completed setup.
 *   - crash/exit handling: mark the module inactive, reject in-flight calls,
 *     isolate from main + siblings.
 *   - serve the storage/log broker requests FROM the host, keyed by the
 *     AUTHENTICATED moduleId the host bound to that child's port (anti-spoof,
 *     design §3d) — NOT a value the child supplies.
 *
 * The transport is injected (`SpawnFn` → `ChildEndpoint`) so the RPC routing,
 * timeout, teardown, and crash-isolation logic is unit-testable with a mock
 * endpoint, no real utilityProcess required. The production `spawnUtilityChild`
 * factory lives at the bottom and is the only Electron-coupled part.
 */

import {
  errToString,
  type BrokerMethod,
  type ChildToHost,
  type HostToChild
} from './host-protocol.js';
import type {
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse
} from '../../shared/module-main.js';

type LogFn = (message: string, err?: unknown) => void;

/** Host-side per-extension storage (the namespaced KV the broker serves). */
export interface HostStorage {
  get(moduleId: string, key: string): unknown;
  set(moduleId: string, key: string, value: unknown): void;
}

/**
 * The gated performer for the brokered caps (P3-B). Each method receives the
 * AUTHENTICATED `moduleId` (the id the host bound to the child's port — the
 * child cannot forge it), checks the permission + scope against that id, and
 * performs the op host-side. It MUST throw (PermissionDenied or any Error) when
 * ungranted/out-of-scope; the process host turns a throw into an `ok:false`
 * broker-result so the child's `await` rejects. Injected so the process host
 * stays Electron-free + unit-testable with a mock performer.
 */
export interface BrokerCapabilities {
  exec(moduleId: string, req: ExecRequest): Promise<ExecResult>;
  readFile(moduleId: string, path: string, encoding?: 'utf-8'): Promise<string>;
  writeFile(moduleId: string, path: string, data: string): Promise<void>;
  readdir(moduleId: string, path: string): Promise<string[]>;
  fetch(moduleId: string, url: string, init?: BrokeredFetchInit): Promise<BrokeredFetchResponse>;
}

/**
 * The transport seam. A `ChildEndpoint` is one live child process the host can
 * talk to. The production impl wraps an Electron `utilityProcess` + its data
 * `MessagePort`; tests pass a mock. The host attaches `onMessage`/`onExit`
 * synchronously after `spawn()` returns, before any message is delivered.
 */
export interface ChildEndpoint {
  /** Deliver a host→child message over the data port. */
  postMessage(msg: HostToChild): void;
  /** Register the child→host message sink (called once by the host). */
  onMessage(listener: (msg: ChildToHost) => void): void;
  /** Register the exit/crash sink (called once by the host). */
  onExit(listener: (code: number | null) => void): void;
  /** Kill the child process unconditionally. */
  kill(): void;
}

/** Factory that starts a child for `{entryPath, moduleId}` and returns its endpoint. */
export type SpawnFn = (entryPath: string, moduleId: string) => ChildEndpoint;

/** A disk extension to spawn: its id + the resolved absolute main entry path. */
export interface DiskExtensionSpec {
  moduleId: string;
  entryPath: string;
}

export interface ProcessHostOptions {
  spawn: SpawnFn;
  storage: HostStorage;
  log: LogFn;
  /**
   * Gated brokered capabilities (P3-B). Optional: when absent, an exec/fs/fetch
   * broker request is rejected (deny-by-default) — useful in tests that only
   * exercise storage/log + routing.
   */
  caps?: BrokerCapabilities;
  /** Per-dispatch timeout (ms). A child that doesn't answer is rejected. Default 30s. */
  callTimeoutMs?: number;
  /** Teardown-RPC deadline (ms) before the child is killed regardless. Default 2s. */
  teardownTimeoutMs?: number;
  /** Setup deadline (ms): a child that never reports `ready` is killed. Default 15s. */
  setupTimeoutMs?: number;
}

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One managed child. */
interface ChildState {
  moduleId: string;
  endpoint: ChildEndpoint;
  /** Flipped true once the child reports `ready` (setup() resolved). */
  ready: boolean;
  /** True after exit/crash or teardown — dispatch must reject, not hang. */
  dead: boolean;
  pending: Map<number, PendingCall>;
  nextCallId: number;
  /** Resolvers for the spawn()'s ready/error wait. */
  onReady?: () => void;
  onSetupError?: (error: string) => void;
  setupTimer?: ReturnType<typeof setTimeout>;
}

export class ExtensionProcessHost {
  private readonly children = new Map<string, ChildState>();
  /**
   * Ids whose child exited unsolicited (crash/segfault/process.exit), so a
   * later `dispatch` rejects with a clear "crashed" message instead of falling
   * through the router to the in-process host's misleading "Unknown module".
   * Cleared on a fresh `spawn` of the same id (relaunch). Intentional teardown
   * does NOT add to this set — that's a clean removal.
   */
  private readonly crashed = new Set<string>();
  private readonly callTimeoutMs: number;
  private readonly teardownTimeoutMs: number;
  private readonly setupTimeoutMs: number;

  constructor(private readonly opts: ProcessHostOptions) {
    this.callTimeoutMs = opts.callTimeoutMs ?? 30_000;
    this.teardownTimeoutMs = opts.teardownTimeoutMs ?? 2_000;
    this.setupTimeoutMs = opts.setupTimeoutMs ?? 15_000;
  }

  /**
   * Spawn one disk extension's child and wait for setup. Resolves true when the
   * child reports `ready`, false on setup-error / spawn failure / setup timeout.
   * Never throws — boot isolation: one bad ext must not break others.
   */
  async spawn(spec: DiskExtensionSpec): Promise<boolean> {
    const { moduleId, entryPath } = spec;
    // Defensive: never run two children for the same id.
    if (this.children.has(moduleId)) await this.teardown(moduleId);
    // A relaunch clears any prior crash record.
    this.crashed.delete(moduleId);

    let endpoint: ChildEndpoint;
    try {
      endpoint = this.opts.spawn(entryPath, moduleId);
    } catch (err) {
      this.opts.log(`extension ${moduleId}: child spawn failed`, err);
      return false;
    }

    const state: ChildState = {
      moduleId,
      endpoint,
      ready: false,
      dead: false,
      pending: new Map(),
      nextCallId: 1
    };
    this.children.set(moduleId, state);

    endpoint.onMessage((msg) => this.onChildMessage(state, msg));
    endpoint.onExit((code) => this.onChildExit(state, code));

    const settled = new Promise<boolean>((resolve) => {
      state.onReady = () => resolve(true);
      state.onSetupError = () => resolve(false);
      state.setupTimer = setTimeout(() => {
        this.opts.log(`extension ${moduleId}: setup timed out after ${this.setupTimeoutMs}ms`);
        resolve(false);
        // Kill — a child stuck in setup is not usable.
        this.killAndForget(moduleId);
      }, this.setupTimeoutMs);
    });

    // Hand the child its identity + entry. The endpoint's port is already wired
    // by the spawn factory; this is the first protocol message.
    endpoint.postMessage({ type: 'init', entryPath, moduleId });

    return settled;
  }

  /** RPC a capability to the right child, with a timeout. Rejects if dead/hung. */
  dispatch(moduleId: string, capability: string, args: unknown[]): Promise<unknown> {
    if (this.crashed.has(moduleId)) {
      return Promise.reject(new Error(`Extension ${moduleId} crashed — relaunch to retry`));
    }
    const state = this.children.get(moduleId);
    if (!state || state.dead) {
      return Promise.reject(new Error(`Unknown module: ${moduleId}`));
    }
    if (!state.ready) {
      return Promise.reject(new Error(`Module not ready: ${moduleId}`));
    }
    const callId = state.nextCallId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(callId);
        reject(new Error(`Capability timed out: ${moduleId}.${capability}`));
      }, this.callTimeoutMs);
      state.pending.set(callId, { resolve, reject, timer });
      try {
        state.endpoint.postMessage({ type: 'call', callId, capability, args });
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(callId);
        reject(err instanceof Error ? err : new Error(errToString(err)));
      }
    });
  }

  /**
   * Tear down one child: teardown RPC (short deadline), then kill unconditionally.
   * No-op for an unknown id. Mirrors `MainModuleHost.teardown`'s contract.
   */
  async teardown(moduleId: string): Promise<void> {
    // A disable/uninstall of a crashed ext clears its crash record too.
    this.crashed.delete(moduleId);
    const state = this.children.get(moduleId);
    if (!state) return;
    if (!state.dead && state.ready) {
      await this.teardownRpc(state).catch((err) =>
        this.opts.log(`extension ${moduleId}: teardown rpc failed`, err)
      );
    }
    this.killAndForget(moduleId);
  }

  private teardownRpc(state: ChildState): Promise<void> {
    const callId = state.nextCallId++;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        state.pending.delete(callId);
        resolve();
      };
      const timer = setTimeout(done, this.teardownTimeoutMs);
      // Resolve on either the result or the deadline — we kill regardless after.
      state.pending.set(callId, { resolve: () => done(), reject: () => done(), timer });
      try {
        state.endpoint.postMessage({ type: 'teardown', callId });
      } catch {
        done();
      }
    });
  }

  /** Tear down every child (app quit). Best-effort, parallel. */
  async teardownAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((id) => this.teardown(id)));
  }

  /** Ids whose child is live AND completed setup — the `mainActive:true` set. */
  liveModuleIds(): Set<string> {
    const live = new Set<string>();
    for (const [id, st] of this.children) {
      if (st.ready && !st.dead) live.add(id);
    }
    return live;
  }

  /**
   * True if this host owns this id — a live/dead child OR a crash record. The
   * router uses it to keep routing a crashed disk-ext id HERE (so dispatch
   * returns the clear "crashed" message) rather than falling through to the
   * in-process host's "Unknown module".
   */
  has(moduleId: string): boolean {
    return this.children.has(moduleId) || this.crashed.has(moduleId);
  }

  // ---- internals -----------------------------------------------------------

  private onChildMessage(state: ChildState, msg: ChildToHost): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready':
        state.ready = true;
        if (state.setupTimer) clearTimeout(state.setupTimer);
        state.onReady?.();
        break;
      case 'setup-error':
        this.opts.log(`extension ${state.moduleId}: setup failed: ${msg.error}`);
        if (state.setupTimer) clearTimeout(state.setupTimer);
        state.onSetupError?.(msg.error);
        // Setup failed → the child is useless; drop it (isolated, no respawn).
        this.killAndForget(state.moduleId);
        break;
      case 'result': {
        const pending = state.pending.get(msg.callId);
        if (!pending) return; // already timed out / unknown — ignore
        clearTimeout(pending.timer);
        state.pending.delete(msg.callId);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error ?? 'capability failed'));
        break;
      }
      case 'broker':
        this.handleBroker(state, msg.reqId, msg.method, msg.args);
        break;
    }
  }

  /**
   * Serve a child's broker request HOST-SIDE. The authenticated id is
   * `state.moduleId` — the id the host bound to this child's port, NOT any value
   * in the payload — so a child cannot read/write a sibling's namespace nor
   * borrow a sibling's grants (design §3d). storage/log are unconditional (they
   * are inherently namespaced by id); exec/fs/fetch are gated by the injected
   * `caps` performer, which checks the permission + scope against `state.moduleId`
   * and throws (→ `ok:false`) when ungranted.
   */
  private handleBroker(state: ChildState, reqId: number, method: BrokerMethod, args: unknown[]): void {
    const reply = (ok: boolean, result?: unknown, error?: string) =>
      state.endpoint.postMessage({ type: 'broker-result', reqId, ok, result, error });
    const id = state.moduleId;
    const caps = this.opts.caps;
    // exec/fs/fetch resolve asynchronously through the gated performer.
    const brokered = (op: () => Promise<unknown>) => {
      if (!caps) {
        reply(false, undefined, `PermissionDenied: ${id} — broker capability unavailable`);
        return;
      }
      op().then(
        (result) => reply(true, result),
        (err) => reply(false, undefined, errToString(err))
      );
    };
    try {
      switch (method) {
        case 'storage.get':
          reply(true, this.opts.storage.get(id, String(args[0])));
          break;
        case 'storage.set':
          this.opts.storage.set(id, String(args[0]), args[1]);
          reply(true);
          break;
        case 'log':
          this.opts.log(`[ext:${id}] ${String(args[0])}`, args[1]);
          reply(true);
          break;
        case 'exec':
          brokered(() => caps!.exec(id, args[0] as ExecRequest));
          break;
        case 'fs.readFile':
          brokered(() => caps!.readFile(id, String(args[0]), args[1] as 'utf-8' | undefined));
          break;
        case 'fs.writeFile':
          brokered(() => caps!.writeFile(id, String(args[0]), String(args[1])));
          break;
        case 'fs.readdir':
          brokered(() => caps!.readdir(id, String(args[0])));
          break;
        case 'fetch':
          brokered(() => caps!.fetch(id, String(args[0]), args[1] as BrokeredFetchInit | undefined));
          break;
        default:
          reply(false, undefined, `Unknown broker method: ${String(method)}`);
      }
    } catch (err) {
      reply(false, undefined, errToString(err));
    }
  }

  private onChildExit(state: ChildState, code: number | null): void {
    if (state.dead) return; // teardown already handled it
    state.dead = true;
    state.ready = false;
    if (state.setupTimer) clearTimeout(state.setupTimer);
    // Reject every in-flight call — never leave a renderer promise hanging.
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Extension ${state.moduleId} exited (code ${code})`));
    }
    state.pending.clear();
    // If it died before setup completed, unblock the spawn() waiter.
    state.onSetupError?.(`exited before ready (code ${code})`);
    this.opts.log(`extension ${state.moduleId}: child exited (code ${code})`);
    // Record the crash so a later dispatch gives a clear message (and the
    // router keeps routing the id here). Cleared on relaunch via spawn().
    this.crashed.add(state.moduleId);
    this.children.delete(state.moduleId);
  }

  /** Mark dead, kill, and drop from the map. Safe to call repeatedly. */
  private killAndForget(moduleId: string): void {
    const state = this.children.get(moduleId);
    if (!state) return;
    state.dead = true;
    state.ready = false;
    if (state.setupTimer) clearTimeout(state.setupTimer);
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Extension ${moduleId} torn down`));
    }
    state.pending.clear();
    try {
      state.endpoint.kill();
    } catch (err) {
      this.opts.log(`extension ${moduleId}: kill failed`, err);
    }
    this.children.delete(moduleId);
  }
}
