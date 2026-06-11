import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

// Resolve the extension SDK (`@cctc/extension-sdk` + subpaths) to its source
// in all three bundles. The SDK is the canonical extension contract; core and
// plugins both consume it. Subpaths (`/renderer`, `/main`, `/helpers`) map to
// the matching source file; the bare specifier maps to the package entry.
const sdkAlias = [
  {
    find: /^@cctc\/extension-sdk$/,
    replacement: resolve(__dirname, 'packages/extension-sdk/src/index.ts')
  },
  {
    find: /^@cctc\/extension-sdk\/(.*)$/,
    replacement: resolve(__dirname, 'packages/extension-sdk/src/$1.ts')
  }
];

// Vite/Rollup's own resolver doesn't fully understand the `./*` subpath
// pattern in monaco-vscode-api's package.json `exports` map (it strips file
// extensions in the parent module then can't find the leaf .js). Fall back
// to Node's resolver for any @codingame/* import — it handles the wildcard
// exports correctly.
const codingameRequire = createRequire(import.meta.url);
function codingameResolver(): Plugin {
  return {
    name: 'codingame-subpath-resolver',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.startsWith('@codingame/')) return null;
      // Only intervene on deep subpaths (./vscode/..., ./service-override/...,
      // etc.) where Rollup's exports-map resolution chokes on the wildcard
      // pattern. Leave the top-level package entry alone so Vite's normal
      // resolver wins and only ever creates one module record per file.
      const slashes = source.split('/').length - 1;
      if (slashes <= 1) return null;
      try {
        const resolved = codingameRequire.resolve(source);
        // Round-trip through Vite's resolver so the ID is normalized the same
        // way as a regular resolution (resolves symlinks, applies query
        // strings, etc.). Falls back to the bare path if resolution fails.
        const normalized = await this.resolve(resolved, importer, {
          skipSelf: true
        });
        return normalized?.id ?? resolved;
      } catch {
        return null;
      }
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias },
    build: {
      // In `dev`, watch app-module sources under `plugins/` as well as `src/`.
      // A module's main side (e.g. plugins/zana/main) is pulled into the main
      // bundle via the registry, but lives outside `src/`; without this the
      // dev watcher won't restart the main process when a plugin file changes,
      // leaving a stale main that answers `modules:call` with "Unknown module".
      watch: { include: ['src/**', 'plugins/**'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias },
    build: {
      watch: { include: ['src/**', 'plugins/**'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        ...sdkAlias,
        { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
        // monaco-vscode-api expects bare-specifier `vscode` to resolve to its
        // companion shim package (per upstream docs). Use a strict regex so we
        // only match `vscode` and `vscode/*`, never `@codingame/.../vscode/...`.
        {
          find: /^vscode(\/.*)?$/,
          replacement: '@codingame/monaco-vscode-extension-api$1'
        }
      ],
      dedupe: ['monaco-editor']
    },
    optimizeDeps: {
      exclude: [
        '@codingame/monaco-vscode-api',
        '@codingame/monaco-vscode-workbench-service-override',
        '@codingame/monaco-vscode-files-service-override',
        '@codingame/monaco-vscode-views-service-override',
        '@codingame/monaco-vscode-editor-service-override',
        '@codingame/monaco-vscode-explorer-service-override',
        '@codingame/monaco-vscode-keybindings-service-override',
        '@codingame/monaco-vscode-quickaccess-service-override',
        '@codingame/monaco-vscode-theme-service-override',
        '@codingame/monaco-vscode-theme-defaults-default-extension',
        '@codingame/monaco-vscode-textmate-service-override',
        '@codingame/monaco-vscode-configuration-service-override',
        '@codingame/monaco-vscode-storage-service-override',
        '@codingame/monaco-vscode-extensions-service-override',
        '@codingame/monaco-vscode-layout-service-override',
        '@codingame/monaco-vscode-environment-service-override',
        '@codingame/monaco-vscode-lifecycle-service-override',
        '@codingame/monaco-vscode-log-service-override',
        '@codingame/monaco-vscode-model-service-override',
        '@codingame/monaco-vscode-host-service-override',
        '@codingame/monaco-vscode-languages-service-override',
        '@codingame/monaco-vscode-base-service-override',
        '@codingame/monaco-vscode-notifications-service-override',
        '@codingame/monaco-vscode-dialogs-service-override',
        '@codingame/monaco-vscode-extension-api'
      ]
    },
    plugins: [codingameResolver(), react()],
    worker: {
      // monaco-vscode-api ships ES module workers that import other chunks;
      // Vite's default `iife` format can't code-split them.
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
