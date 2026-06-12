/**
 * Main-process module host. Owns the lifecycle of every app module's
 * main side: runs each module's `setup()` once at boot, holds the resulting
 * capability maps, and exposes a single `dispatch()` the IPC layer calls.
 *
 * Modules are listed in `./index.ts`. Core touches nothing per-module —
 * adding a module means appending one line to that array.
 */

import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  MainModule,
  MainModuleContext,
  ModuleCapability,
  ExecRequest,
  ExecResult
} from '../../shared/module-main.js';

/**
 * Hard ceiling on a built-in's exec, regardless of its requested timeout.
 * Built-ins are trusted, but a bound still prevents a hung `sf` wedging boot.
 */
const BUILTIN_EXEC_MAX_TIMEOUT_MS = 60_000;
/** Cap built-in exec output so a runaway child can't OOM main. */
const BUILTIN_EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * TRUSTED, UNGATED `exec` for BUILT-IN (in-process) modules.
 *
 * Built-ins are the trusted tier: they run in the main process and could call
 * `node:child_process` directly. We give them `ctx.exec` anyway so the
 * `MainModuleContext` contract is UNIFORM — the SAME `ctx.exec({ bin: 'sf' })`
 * a built-in calls today also works verbatim when that module later moves to a
 * disk extension (GUS-EXT-B), where it forwards to the permission-GATED broker
 * (`createBrokerCapabilities`). This path is deliberately NOT gated: no
 * permission check, no bin-allowlist — that gating belongs to the disk-ext
 * broker, a SEPARATE ctx-construction site (host-child.ts → broker-caps.ts),
 * which this must not weaken.
 *
 * It mirrors the broker's S3 reject semantics so the two execs are behaviourally
 * interchangeable: a spawn failure (ENOENT) or watchdog kill (timeout / output
 * cap) REJECTS; a process that ran and exited non-zero RESOLVES with `code !== 0`.
 */
function builtinExec(req: ExecRequest): Promise<ExecResult> {
  if (!req || typeof req.bin !== 'string' || !req.bin) {
    return Promise.reject(new Error('exec: missing bin'));
  }
  const timeout = Math.min(req.timeoutMs ?? BUILTIN_EXEC_MAX_TIMEOUT_MS, BUILTIN_EXEC_MAX_TIMEOUT_MS);
  return new Promise<ExecResult>((resolveP, rejectP) => {
    // shell:false + explicit argv → no shell interpretation, no injection.
    execFile(
      req.bin,
      Array.isArray(req.args) ? req.args : [],
      { cwd: req.cwd, timeout, maxBuffer: BUILTIN_EXEC_MAX_BUFFER, shell: false },
      (err, stdout, stderr) => {
        if (err) {
          // @types mislabels `code`: numeric exit code on a non-zero exit, but a
          // STRING errno ('ENOENT'…) on a spawn failure. Read it as unknown.
          const e = err as Error & { code?: unknown; killed?: boolean; signal?: string };
          const exitCode = typeof e.code === 'number' ? e.code : null;
          if (exitCode === null) {
            // Never ran / watchdog-killed → reject (S3), matching the broker.
            if (e.killed) {
              rejectP(new Error(`exec: "${req.bin}" killed after ${timeout}ms (timeout or output cap exceeded)`));
              return;
            }
            if (typeof e.code === 'string') {
              rejectP(new Error(`exec: failed to start "${req.bin}" (${e.code})`));
              return;
            }
            // Ran, then died on a signal — surface as a non-error code:null result.
            resolveP({ stdout: String(stdout), stderr: String(stderr), code: null, signal: e.signal ?? null });
            return;
          }
          resolveP({ stdout: String(stdout), stderr: String(stderr), code: exitCode });
          return;
        }
        resolveP({ stdout: String(stdout), stderr: String(stderr), code: 0 });
      }
    );
  });
}

/** Per-module JSON KV store under `~/.cc-center/modules/<id>.json`. */
class ModuleStorage {
  private cache: Record<string, unknown>;
  private readonly file: string;

  constructor(private readonly moduleId: string, dir: string) {
    this.file = join(dir, `${moduleId}.json`);
    this.cache = this.load();
  }

  private load(): Record<string, unknown> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.cache[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.cache[key] = value;
    const tmp = `${this.file}.tmp.${randomBytes(4).toString('hex')}`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    renameSync(tmp, this.file);
  }
}

export interface ModuleHostDeps {
  log: (message: string, err?: unknown) => void;
}

export class MainModuleHost {
  private readonly caps = new Map<string, Record<string, ModuleCapability>>();
  private readonly stores = new Map<string, ModuleStorage>();
  /** Keep the module instances so `teardown(id)` can call their `teardown?()`. */
  private readonly modules = new Map<string, MainModule>();
  private readonly storageDir: string;

  constructor(private readonly deps: ModuleHostDeps) {
    this.storageDir = join(app.getPath('home'), '.cc-center', 'modules');
    try {
      mkdirSync(this.storageDir, { recursive: true });
    } catch (err) {
      this.deps.log('module storage mkdir', err);
    }
  }

  private storageFor(moduleId: string): ModuleStorage {
    let s = this.stores.get(moduleId);
    if (!s) {
      s = new ModuleStorage(moduleId, this.storageDir);
      this.stores.set(moduleId, s);
    }
    return s;
  }

  /** Run every module's setup once. Failures are isolated per module. */
  async setupAll(modules: MainModule[]): Promise<void> {
    for (const mod of modules) {
      const ctx: MainModuleContext = {
        storage: this.storageFor(mod.id),
        log: (msg, err) => this.deps.log(`[module:${mod.id}] ${msg}`, err),
        // Trusted, ungated exec for the in-process built-in tier. Gives the
        // built-in ctx the SAME `exec` shape a disk extension gets from the
        // broker, so module code (e.g. gus's `ctx.exec({ bin: 'sf' })`) is
        // identical across both tiers. NOT gated here — that's the disk-ext
        // broker's job (a separate ctx, untouched).
        exec: builtinExec
      };
      try {
        const caps = await mod.setup(ctx);
        this.caps.set(mod.id, caps);
        this.modules.set(mod.id, mod);
      } catch (err) {
        this.deps.log(`module setup failed: ${mod.id}`, err);
        this.caps.set(mod.id, {});
        // Still track the module so a later teardown can attempt cleanup of
        // anything `setup` half-acquired before it threw.
        this.modules.set(mod.id, mod);
      }
    }
  }

  /**
   * Tear down one module: call its `teardown?()` (awaited, throw isolated +
   * logged), then drop it from the caps + modules maps so a subsequent
   * `dispatch` rejects with "Unknown module". Used on extension disable /
   * uninstall. No-op for an unknown id. The per-module storage is left intact
   * so a re-enable keeps its state.
   */
  async teardown(moduleId: string): Promise<void> {
    const mod = this.modules.get(moduleId);
    if (mod?.teardown) {
      try {
        await mod.teardown();
      } catch (err) {
        this.deps.log(`module teardown failed: ${moduleId}`, err);
      }
    }
    this.caps.delete(moduleId);
    this.modules.delete(moduleId);
  }

  /**
   * Ids of the modules currently live (set up, not torn down). The extension
   * loader stamps each main-bearing extension's `mainActive` from this on
   * re-discovery, so the renderer knows whether `host.call` will resolve.
   */
  liveModuleIds(): Set<string> {
    return new Set(this.modules.keys());
  }

  /** Dispatch a renderer `ModuleHost.call`. Throws on unknown id/capability. */
  async dispatch(moduleId: string, capability: string, args: unknown[]): Promise<unknown> {
    const caps = this.caps.get(moduleId);
    if (!caps) throw new Error(`Unknown module: ${moduleId}`);
    const fn = caps[capability];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown capability: ${moduleId}.${capability}`);
    }
    return await fn(...args);
  }

  storageGet(moduleId: string, key: string): unknown {
    return this.storageFor(moduleId).get(key);
  }

  storageSet(moduleId: string, key: string, value: unknown): void {
    this.storageFor(moduleId).set(key, value);
  }
}

/** Shared by capabilities that want to open a URL host-side. */
export function openExternal(url: string): void {
  void shell.openExternal(url);
}
