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
 * This is the SANCTIONED path. HONEST RESIDUAL: the child is still a Node
 * process, so a malicious extension can pull in `node:child_process` itself and
 * skip this gate entirely until a Node-builtin denylist lands in the child (a
 * separate, deferred ticket). P3-B makes the brokered path real, scoped, and
 * audited; it does not yet seal raw Node in the child.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
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
/** Cap brokered spawn output so an ext can't OOM main with a huge stdout. */
const SPAWN_MAX_BUFFER = 8 * 1024 * 1024;
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

export function createBrokerCapabilities(broker: PermissionBroker): BrokerCapabilities {
  return {
    async exec(moduleId, req: ExecRequest): Promise<ExecResult> {
      if (!req || typeof req.bin !== 'string' || !req.bin) {
        throw new Error('exec: missing bin');
      }
      // Gate: `exec` granted AND bin on the allowlist. assert() throws on deny.
      broker.assert(moduleId, 'exec', { kind: 'exec', bin: req.bin });
      // If a cwd is requested it must be within a granted fs root.
      if (req.cwd) {
        broker.assert(moduleId, 'fs:read', { kind: 'fs', path: resolve(req.cwd) });
      }
      const timeout = Math.min(req.timeoutMs ?? MAX_SPAWN_TIMEOUT_MS, MAX_SPAWN_TIMEOUT_MS);
      return await new Promise<ExecResult>((resolveP) => {
        // shell:false + explicit argv → no shell interpretation, no injection.
        execFile(
          req.bin, // basename; resolved against PATH.
          Array.isArray(req.args) ? req.args : [],
          { cwd: req.cwd, timeout, maxBuffer: SPAWN_MAX_BUFFER, shell: false },
          (err, stdout, stderr) => {
            const code =
              err && typeof (err as { code?: unknown }).code === 'number'
                ? (err as { code: number }).code
                : err
                ? null
                : 0;
            resolveP({ stdout: String(stdout), stderr: String(stderr), code });
          }
        );
      });
    },

    async readFile(moduleId, path, encoding) {
      const canonical = resolve(path);
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: canonical });
      return await readFile(canonical, encoding ?? 'utf-8');
    },

    async writeFile(moduleId, path, data) {
      const canonical = resolve(path);
      broker.assert(moduleId, 'fs:write', { kind: 'fs', path: canonical });
      await writeFile(canonical, data, 'utf-8');
    },

    async readdir(moduleId, path) {
      const canonical = resolve(path);
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: canonical });
      return await readdir(canonical);
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
