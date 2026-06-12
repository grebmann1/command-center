/**
 * Renderer module registry — the single place that lists app modules
 * (plugins/*). Core reads `APP_MODULES` to build the sidebar, the nav union,
 * and the panel switch. Adding a module = appending one import here.
 *
 * Everything else about a module (its panel, its main capabilities, its
 * storage) is reached generically, so no other core file changes.
 */

import { useMemo } from 'react';
import type { AppModule } from '@shared/module-api';
import { gusModule } from '../../../plugins/gus/module';
import { zanaModule } from '../../../plugins/zana/module';
import { useExtensionModules } from './loader';

export const APP_MODULES: AppModule[] = [gusModule, zanaModule];

/** Built-in module ids, used to widen the NavId union at runtime. */
export const MODULE_IDS = APP_MODULES.map((m) => m.id);

/** Look up a built-in module by id. Prefer the merged accessors for code that
 *  must also see runtime-loaded extensions. */
export function getModule(id: string): AppModule | undefined {
  return APP_MODULES.find((m) => m.id === id);
}

/**
 * Combine the static built-ins with the runtime-loaded extension modules. A
 * runtime extension may not collide with a built-in id; if one does, the
 * built-in wins (it was registered first and is trusted).
 */
function mergeModules(extensionModules: AppModule[]): AppModule[] {
  if (extensionModules.length === 0) return APP_MODULES;
  const taken = new Set(APP_MODULES.map((m) => m.id));
  const extras = extensionModules.filter((m) => !taken.has(m.id));
  return extras.length === 0 ? APP_MODULES : [...APP_MODULES, ...extras];
}

/**
 * Reactive merged module set (built-ins + runtime extensions). The single
 * source the shell's nav-aware surfaces (Sidebar, App title, ListPane,
 * ModulePanelHost) consume so built-ins and extensions are treated uniformly.
 * Memoised against the raw extension slice to keep a stable reference (avoids
 * the zustand fresh-array selector trap).
 */
export function useMergedModules(): AppModule[] {
  const extensionModules = useExtensionModules((s) => s.modules);
  return useMemo(() => mergeModules(extensionModules), [extensionModules]);
}

/** Imperative merged-module lookup for non-React call sites. */
export function getMergedModule(id: string): AppModule | undefined {
  return mergeModules(useExtensionModules.getState().modules).find((m) => m.id === id);
}

/** Imperative merged id set (built-ins + currently-loaded extensions). */
export function getMergedModuleIds(): string[] {
  return mergeModules(useExtensionModules.getState().modules).map((m) => m.id);
}
