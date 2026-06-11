/**
 * Re-export shim. The extension contract now lives in the published SDK
 * package (`@cctc/extension-sdk`); this file keeps core's existing
 * `@shared/module-main` imports working unchanged. New code should import
 * from `@cctc/extension-sdk/main` directly.
 */

export type { MainModule, MainModuleContext, ModuleCapability } from '@cctc/extension-sdk/main';
