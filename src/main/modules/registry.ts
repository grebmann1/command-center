/**
 * Main-process module host. Owns the lifecycle of every app module's
 * main side: runs each module's `setup()` once at boot, holds the resulting
 * capability maps, and exposes a single `dispatch()` the IPC layer calls.
 *
 * Modules are listed in `./index.ts`. Core touches nothing per-module —
 * adding a module means appending one line to that array.
 */

import { app, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { MainModule, MainModuleContext, ModuleCapability } from '../../shared/module-main.js';

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
        log: (msg, err) => this.deps.log(`[module:${mod.id}] ${msg}`, err)
      };
      try {
        const caps = await mod.setup(ctx);
        this.caps.set(mod.id, caps);
      } catch (err) {
        this.deps.log(`module setup failed: ${mod.id}`, err);
        this.caps.set(mod.id, {});
      }
    }
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
