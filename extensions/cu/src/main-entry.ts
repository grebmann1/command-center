/**
 * Main-process entry for the cu DISK extension.
 *
 * The host spawns a per-extension utilityProcess and `import()`s this module
 * there; its `default` export must be a {@link MainModule}. `cuMainModule` runs
 * `claude-unleashed` exclusively through the brokered exec capability, so in the
 * isolated child its `ctx.exec` calls (bin `claude-unleashed`) forward over the
 * broker port and are permission-gated against the manifest's `exec` grant +
 * `execAllowlist: ['claude-unleashed']`.
 *
 * The build externalizes only `electron` + node builtins; cu-main imports
 * neither (it's pure JS + ctx capabilities), so the bundle is self-contained.
 */
import { cuMainModule } from './main/cu-main.js';

export default cuMainModule;
