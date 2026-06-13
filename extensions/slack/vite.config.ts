import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Library-mode build for the slack DISK extension. Two targets (selected by
 * BUILD_TARGET): main (externalize electron + node builtins) and renderer
 * (self-contained, React shimmed).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const target = process.env.BUILD_TARGET ?? 'renderer';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig(
  target === 'main'
    ? {
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'src/main-entry.ts'),
            formats: ['es'],
            fileName: () => 'main.mjs'
          },
          rollupOptions: { external: ['electron', ...nodeBuiltins] }
        }
      }
    : {
        resolve: {
          alias: [
            { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react$/, replacement: resolve(__dirname, 'src/react-shim.ts') }
          ]
        },
        esbuild: {
          jsx: 'automatic'
        },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          minify: false,
          lib: {
            entry: resolve(__dirname, 'src/renderer-entry.tsx'),
            formats: ['es'],
            fileName: () => 'renderer.js'
          },
          rollupOptions: {
            external: []
          }
        }
      }
);
