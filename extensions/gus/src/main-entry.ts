/**
 * Main-process entry for the gus DISK extension.
 *
 * The host spawns a per-extension utilityProcess and `import()`s this module
 * there; its `default` export must be a {@link MainModule}. We re-export the
 * existing `gusMainModule` (GUS-EXT-A already moved it off raw node spawn APIs
 * to `ctx.exec`), so in the isolated child its `ctx.exec({ bin: 'sf' })` calls
 * forward over the broker port and are permission-gated against the manifest's
 * `exec` grant + `execAllowlist: ['sf']`.
 *
 * The build externalizes only `electron` + node builtins; gus-main imports
 * neither (it's pure JS + ctx capabilities), so the bundle is self-contained.
 */
import { gusMainModule } from '../../../plugins/gus/main/gus-main.js';

export default gusMainModule;
