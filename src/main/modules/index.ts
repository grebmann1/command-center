/**
 * Main-process module registry — lists each module's main module. Mirrors
 * the renderer registry; core's boot runs `setupAll` over this array and the
 * IPC layer dispatches `modules:call` against it. Add a module = one line.
 */

import type { MainModule } from '../../shared/module-main.js';
import { zanaMainModule } from '../../../plugins/zana/main/zana-main.js';

// gus is no longer compiled in — it ships as a disk extension (GUS-EXT-B),
// loaded out-of-process through the runtime extension pipeline (discovery →
// consent → utilityProcess → broker exec). See extensions/gus/. zana stays a
// built-in.
export const MAIN_MODULES: MainModule[] = [zanaMainModule];
