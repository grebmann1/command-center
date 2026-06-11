/**
 * Re-export shim. The extension contract now lives in the published SDK
 * package (`@cctc/extension-sdk`); this file keeps core's existing
 * `@shared/module-api` imports working unchanged. New code should import
 * from `@cctc/extension-sdk/renderer` directly.
 */

export type { AppModule, ModuleHost } from '@cctc/extension-sdk/renderer';
