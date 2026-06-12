/**
 * Optional main-process entry for a CCTC extension.
 *
 * `setup` returns a map of named capabilities. The renderer reaches each one via
 * `host.call('<name>', ...args)`. Capabilities run in the Electron main process
 * with Node access; keep them data-in / data-out (return values are
 * structured-cloned across IPC, so they must be JSON-serialisable).
 *
 * The build externalizes `electron` and Node built-ins; everything else the
 * extension imports is bundled. Delete this file (and the `entry.main` field in
 * extension.json) for a renderer-only extension.
 */
import { defineMainModule } from '@cctc/extension-sdk';

export default defineMainModule({
  id: 'my-extension',
  setup(ctx) {
    return {
      async ping(name: string) {
        ctx.log(`ping(${name})`);
        return { pong: true, name, at: Date.now() };
      },
    };
  },
});
