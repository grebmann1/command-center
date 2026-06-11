import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest doesn't read electron.vite.config.ts, so the extension-SDK alias is
// declared here too. Keeps `@cctc/extension-sdk[/subpath]` resolving in tests
// (e.g. the markdown helper, now re-exported through the SDK).
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@cctc\/extension-sdk$/,
        replacement: resolve(__dirname, 'packages/extension-sdk/src/index.ts')
      },
      {
        find: /^@cctc\/extension-sdk\/(.*)$/,
        replacement: resolve(__dirname, 'packages/extension-sdk/src/$1.ts')
      },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') }
    ]
  }
});
