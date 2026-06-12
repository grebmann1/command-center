/**
 * Concrete, permission-GATED implementation of the brokered capabilities
 * (P3-B): process-spawn / fs / fetch performed host-side for a disk extension's
 * child. Each method gates against the {@link PermissionBroker} keyed by the
 * AUTHENTICATED moduleId (passed by the process host — the child cannot forge
 * it), then performs the op with raw Node. A denied request throws
 * {@link PermissionDenied}; the process host turns the throw into an `ok:false`
 * broker-result, so the child's `await ctx.exec(...)` rejects with the message.
 *
 * Process spawning uses `execFile` with `shell: false` and an explicit argv —
 * NO shell string is ever accepted (no command injection surface); the `bin` is
 * a basename checked against the per-extension allowlist.
 *
 * This is the SANCTIONED path. As of P3-HARDEN the child also installs a
 * Node-builtin denylist (`host-child-guard.ts`), so a malicious ext can no longer
 * trivially `import('node:child_process')` to skip this gate — the brokered path
 * is now the only *practical* capability path. See `host-child-guard.ts` for the
 * honest residual (JS-level, not an OS sandbox; `process.dlopen` remains).
 *
 * fs scoping is symlink-safe: each path is checked lexically AND after
 * `realpath()` (P3-HARDEN), so a symlink inside a granted root pointing at a
 * sensitive target (e.g. `~/.ssh`) cannot escape. exec failures/timeouts REJECT
 * (S3) rather than resolving a misleading `{code:null}`.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import type {
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse
} from '../../shared/module-main.js';
import type { BrokerCapabilities } from './process-host.js';
import { PermissionBroker, PermissionDenied } from './permission-broker.js';

/** Hard ceiling on a brokered spawn, regardless of the ext's requested timeout. */
const MAX_SPAWN_TIMEOUT_MS = 60_000;
/**
 * Cap brokered spawn output so an ext can't OOM main with a huge stdout.
 * 16 MiB to match the trusted built-in exec (registry.ts BUILTIN_EXEC_MAX_BUFFER)
 * and the pre-isolation behavior — a large `sf data query` (e.g. a 2000-row
 * sprint pull) can exceed 8 MiB, and an under-cap would watchdog-kill it into a
 * misleading "CLI unavailable" reject rather than returning the data.
 */
const SPAWN_MAX_BUFFER = 16 * 1024 * 1024;
/** Max redirect hops a brokered fetch will follow (each re-checks `net`). */
const FETCH_MAX_REDIRECTS = 5;
/** Cap on a brokered fetch response body — a hostile/large response can't OOM main. */
const FETCH_MAX_BODY = 8 * 1024 * 1024;

/**
 * Read a fetch Response body as text, aborting once it exceeds `cap` bytes.
 * Streams chunk-by-chunk so an unbounded/hostile response can't exhaust memory
 * before we notice (unlike `res.text()`, which buffers the whole thing first).
 */
async function readCappedText(res: Response, cap: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > cap) {
          await reader.cancel();
          throw new Error(`fetch: response body exceeds ${cap} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Symlink-safe canonicalization (P3-HARDEN). The lexical `resolve()` used for the
 * first scope check does NOT follow symlinks, so a symlink *inside* a granted
 * root pointing at `~/.ssh` would pass the lexical `isWithin` yet read/write the
 * link target. We `realpath()` the path and return the REAL on-disk location so
 * the caller can re-assert the scope against it.
 *
 * For a path that doesn't exist yet (a write to a new file), `realpath` of the
 * full path ENOENTs; we instead realpath the nearest existing ancestor dir and
 * re-attach the trailing not-yet-existing segments. This still resolves a
 * symlinked *parent* (the escape vector for new-file writes) while tolerating the
 * leaf not existing. If even the root is missing we fall back to the lexical
 * resolve (nothing to escape through — the path simply isn't reachable).
 *
 * TOCTOU: the gate then operates on the RETURNED real path (not the caller's
 * path), closing the leaf/parent swap window; a swap of an intermediate
 * component of a deep existing path between this realpath and the fs op is the
 * standard, unavoidable filesystem TOCTOU residual.
 */
async function realpathForCheck(lexical: string): Promise<string> {
  try {
    return await realpath(lexical);
  } catch {
    // Walk up to the first existing ancestor, realpath it, re-join the rest.
    let dir = dirname(lexical);
    const tail: string[] = [basename(lexical)];
    for (;;) {
      try {
        const realDir = await realpath(dir);
        // tail is [leaf, …, nearest-missing]; reverse → outermost-first for join.
        // `reverse()` mutates in place but is the last op before return, so safe.
        return join(realDir, ...tail.reverse());
      } catch {
        const parent = dirname(dir);
        if (parent === dir) return lexical; // hit the fs root, nothing existed
        tail.push(basename(dir));
        dir = parent;
      }
    }
  }
}

export function createBrokerCapabilities(broker: PermissionBroker): BrokerCapabilities {
  return {
    async exec(moduleId, req: ExecRequest): Promise<ExecResult> {
      if (!req || typeof req.bin !== 'string' || !req.bin) {
        throw new Error('exec: missing bin');
      }
      // Gate: `exec` granted AND bin on the allowlist. assert() throws on deny.
      broker.assert(moduleId, 'exec', { kind: 'exec', bin: req.bin });
      // If a cwd is requested it must be within a granted fs root (lexical then
      // realpath, so a symlinked cwd can't escape — P3-HARDEN).
      if (req.cwd) {
        broker.assert(moduleId, 'fs:read', {
          kind: 'fs',
          path: await realpathForCheck(resolve(req.cwd))
        });
      }
      const timeout = Math.min(req.timeoutMs ?? MAX_SPAWN_TIMEOUT_MS, MAX_SPAWN_TIMEOUT_MS);
      return await new Promise<ExecResult>((resolveP, rejectP) => {
        // shell:false + explicit argv → no shell interpretation, no injection.
        // NOTE (S2 residual): `bin` is a basename resolved against the host's
        // PATH at spawn time — whatever's FIRST on PATH wins. The allowlist gates
        // the *name*, not the on-disk binary. See docs/extensions-authoring.md
        // "exec PATH residual". We do not pin a controlled PATH here because the
        // host's PATH is the user's own trusted environment; an attacker who can
        // prepend a hostile dir to the user's PATH already has local code-exec.
        execFile(
          req.bin, // basename; resolved against PATH.
          Array.isArray(req.args) ? req.args : [],
          { cwd: req.cwd, timeout, maxBuffer: SPAWN_MAX_BUFFER, shell: false },
          (err, stdout, stderr) => {
            // S3: distinguish a *failure to run / watchdog kill* from a process
            // that ran and exited (cleanly or by its own non-zero code / a signal
            // it caught). The former MUST reject so the ext's `await ctx.exec`
            // surfaces an error instead of a misleading `{code:null}` success.
            if (err) {
              // `execFile`'s error puts the numeric exit code in `code` for a
              // non-zero exit, but a STRING errno ('ENOENT'…) there on a spawn
              // failure — the @types union mislabels it, so read it as unknown.
              const e = err as Error & { code?: unknown; killed?: boolean; signal?: string };
              const exitCode = typeof e.code === 'number' ? e.code : null;
              if (exitCode === null) {
                // No numeric exit code means the process did not exit normally:
                //   - spawn failure: e.code is a string errno ('ENOENT', 'EACCES'…)
                //   - timeout/maxBuffer kill: e.killed === true (Node's watchdog)
                //   - killed by a signal: e.signal set, e.killed false
                // Reject for spawn-failure and watchdog-timeout (the hung-child
                // case the ticket calls out); a watchdog timeout is `killed:true`.
                if (e.killed) {
                  rejectP(
                    new Error(
                      `exec: "${req.bin}" killed after ${timeout}ms (timeout or output cap exceeded)`
                    )
                  );
                  return;
                }
                if (typeof e.code === 'string') {
                  rejectP(new Error(`exec: failed to start "${req.bin}" (${e.code})`));
                  return;
                }
                // Exited via an uncaught signal (e.g. crashed) — surface the
                // signal as a non-error result with code:null so a caller can
                // still inspect stdout/stderr, distinct from the reject paths.
                resolveP({
                  stdout: String(stdout),
                  stderr: String(stderr),
                  code: null,
                  signal: e.signal ?? null
                });
                return;
              }
              // Ran and exited non-zero — a normal, reportable result.
              resolveP({ stdout: String(stdout), stderr: String(stderr), code: exitCode });
              return;
            }
            resolveP({ stdout: String(stdout), stderr: String(stderr), code: 0 });
          }
        );
      });
    },

    async readFile(moduleId, path, encoding) {
      // Check the REAL path: `realpathForCheck` resolves symlinks AND collapses
      // `..`, so a symlink inside a granted root pointing outside it (e.g. →
      // ~/.ssh) is caught — the grant's roots are realpath'd to match
      // (P3-HARDEN). This single check subsumes the lexical one.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      return await readFile(real, encoding ?? 'utf-8');
    },

    async writeFile(moduleId, path, data) {
      // For a new file the leaf may not exist yet, so `realpathForCheck` resolves
      // the (possibly symlinked) parent dir — the escape vector for a new-file
      // write — and re-attaches the leaf.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:write', { kind: 'fs', path: real });
      await writeFile(real, data, 'utf-8');
    },

    async readdir(moduleId, path) {
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      return await readdir(real);
    },

    async fetch(moduleId, url, init?: BrokeredFetchInit): Promise<BrokeredFetchResponse> {
      // Follow redirects MANUALLY so the egress allowlist is re-checked on every
      // hop. `redirect: 'follow'` (the WHATWG default) would let a net-granted
      // ext request an allowlisted host that 30x-redirects to an arbitrary one
      // (e.g. 169.254.169.254 cloud-metadata / internal SSRF) — the allowlist is
      // only the entire `net` capability, so a single attacker redirect must not
      // escape it. We re-assert `net` against each Location host before chasing.
      let current = url;
      let res: Response | undefined;
      for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
        let host: string;
        try {
          host = new URL(current).hostname;
        } catch {
          throw new Error('fetch: invalid url');
        }
        broker.assert(moduleId, 'net', { kind: 'net', host });
        res = await fetch(current, {
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
          redirect: 'manual'
        });
        if (res.status < 300 || res.status >= 400) break;
        const location = res.headers.get('location');
        if (!location) break; // a 3xx with no Location — treat as terminal
        if (hop === FETCH_MAX_REDIRECTS) {
          throw new Error('fetch: too many redirects');
        }
        // Resolve relative redirects against the current URL, then loop to
        // re-assert `net` on the resolved host.
        current = new URL(location, current).toString();
      }
      if (!res) throw new Error('fetch: no response');
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      // Cap the body so an off-allowlist (or hostile) response can't OOM main,
      // mirroring exec's maxBuffer. Read as a stream and abort past the cap.
      const body = await readCappedText(res, FETCH_MAX_BODY);
      return { status: res.status, ok: res.ok, headers, body };
    }
  };
}

export { PermissionDenied };
