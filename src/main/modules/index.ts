/**
 * Main-process module registry — lists each module's main module. Mirrors
 * the renderer registry; core's boot runs `setupAll` over this array and the
 * IPC layer dispatches `modules:call` against it. Add a module = one line.
 */

import type { MainModule } from '../../shared/module-main.js';
import { gusMainModule } from '../../../plugins/gus/main/gus-main.js';
import { zanaMainModule } from '../../../plugins/zana/main/zana-main.js';

export const MAIN_MODULES: MainModule[] = [gusMainModule, zanaMainModule];
