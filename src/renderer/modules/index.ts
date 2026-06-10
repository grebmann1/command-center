/**
 * Renderer module registry — the single place that lists app modules
 * (plugins/*). Core reads `APP_MODULES` to build the sidebar, the nav union,
 * and the panel switch. Adding a module = appending one import here.
 *
 * Everything else about a module (its panel, its main capabilities, its
 * storage) is reached generically, so no other core file changes.
 */

import type { AppModule } from '@shared/module-api';
import { gusModule } from '../../../plugins/gus/module';

export const APP_MODULES: AppModule[] = [gusModule];

/** Module ids, used to widen the NavId union at runtime. */
export const MODULE_IDS = APP_MODULES.map((m) => m.id);

export function getModule(id: string): AppModule | undefined {
  return APP_MODULES.find((m) => m.id === id);
}
