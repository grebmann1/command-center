/**
 * Wire protocol for the per-extension `utilityProcess` host (P3-A).
 *
 * Electron-free + dependency-free on purpose: this file is imported by BOTH the
 * Electron-side process host (`process-host.ts`) AND the Node-side child
 * bootstrap (`host-child.ts`), and by the vitest router/dispatch tests. Keep it
 * pure types + tiny pure helpers so it can be imported anywhere.
 *
 * Two directions cross the `MessagePort`:
 *
 *   host → child
 *     {type:'init',     entryPath, moduleId}        // one-shot, first message
 *     {type:'call',     callId, capability, args}   // dispatch a ModuleHost.call
 *     {type:'teardown', callId}                     // ask the child to teardown
 *
 *   child → host
 *     {type:'ready',    moduleId, capabilities}     // setup() resolved; lists cap names
 *     {type:'setup-error', moduleId, error}         // setup() threw → child stays dead
 *     {type:'result',   callId, ok:true,  result}   // a call/teardown resolved
 *     {type:'result',   callId, ok:false, error}    // a call/teardown rejected/threw
 *     {type:'broker',   reqId, method, args}        // ctx.storage/log forwarded to host
 *
 *   host → child (reply to a broker request)
 *     {type:'broker-result', reqId, ok:true,  result}
 *     {type:'broker-result', reqId, ok:false, error}
 *
 * The child NEVER supplies its own moduleId on broker requests: the host owns
 * the port↔moduleId mapping (anti-spoof, design §3d), so storage is namespaced
 * by the AUTHENTICATED id the host associates with that child's port, not a
 * value the child sends. `init` carries the moduleId only so the child can tag
 * its own logs; it is not trusted for storage routing.
 */

/**
 * Names of the brokered `MainModuleContext` methods the child can call. The
 * `exec`/`fs.*`/`fetch` methods (P3-B) are gated host-side against the
 * extension's permissions BEFORE the host performs the op; an ungranted request
 * comes back as a `broker-result` with `ok:false` + a PermissionDenied message.
 */
export type BrokerMethod =
  | 'storage.get'
  | 'storage.set'
  | 'log'
  | 'exec'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'fs.readdir'
  | 'fetch';

// ---- host → child ----------------------------------------------------------

export interface InitMessage {
  type: 'init';
  /** Absolute path to the extension's main entry the child will `import()`. */
  entryPath: string;
  /** The extension id, for the child's own log tagging only (NOT trusted). */
  moduleId: string;
}

export interface CallMessage {
  type: 'call';
  callId: number;
  capability: string;
  args: unknown[];
}

export interface TeardownMessage {
  type: 'teardown';
  callId: number;
}

export interface BrokerResultMessage {
  type: 'broker-result';
  reqId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type HostToChild =
  | InitMessage
  | CallMessage
  | TeardownMessage
  | BrokerResultMessage;

// ---- child → host ----------------------------------------------------------

export interface ReadyMessage {
  type: 'ready';
  moduleId: string;
  /** Capability names the module's setup() returned (for diagnostics). */
  capabilities: string[];
}

export interface SetupErrorMessage {
  type: 'setup-error';
  moduleId: string;
  error: string;
}

export interface ResultMessage {
  type: 'result';
  callId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BrokerMessage {
  type: 'broker';
  reqId: number;
  method: BrokerMethod;
  args: unknown[];
}

export type ChildToHost =
  | ReadyMessage
  | SetupErrorMessage
  | ResultMessage
  | BrokerMessage;

// ---- helpers ---------------------------------------------------------------

/** Normalize an unknown thrown value to a string the other side can render. */
export function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
