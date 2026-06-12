import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Library-mode build for the gus DISK extension. Two targets (selected by
 * BUILD_TARGET), each externalizing a different set, both emitting a single
 * self-contained ESM file whose name matches `entry` in extension.json.
 *
 * RENDERER (the headline of the gus-disk dogfood):
 *   The bundle is blob-imported by the host (no import map), so it must contain
 *   ZERO unresolved bare imports. Two host-owned deps would otherwise be bare:
 *     - react / react/jsx-runtime — the host injects its OWN React via
 *       activate({ React }); a second copy breaks hooks. We canNOT leave them
 *       as bare externals (nothing would resolve them in a blob). Instead we
 *       ALIAS them to in-bundle shims (src/react-shim, src/jsx-runtime-shim)
 *       that delegate to the host React captured at activate time. → one React,
 *       no bare imports.
 *     - lucide-react — the host does NOT inject it, so it is BUNDLED (not
 *       externalized). gus's panel imports ~20 icons; they ship in the artifact.
 *   Net: external: [] — the renderer artifact is fully self-contained.
 *
 * MAIN: externalize electron + node builtins (the host runtime provides them).
 *   gus-main imports neither, so the rest bundles cleanly.
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
            fileName: () => 'main.js'
          },
          rollupOptions: { external: ['electron', ...nodeBuiltins] }
        }
      }
    : {
        // The shims must win over the real packages for `react` and
        // `react/jsx-runtime` ONLY — lucide-react and everything else resolve
        // normally and get bundled.
        resolve: {
          alias: [
            { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react$/, replacement: resolve(__dirname, 'src/react-shim.ts') }
          ]
        },
        esbuild: {
          // Automatic runtime → JSX compiles to jsx()/jsxs() from
          // 'react/jsx-runtime', which the alias above points at our shim.
          jsx: 'automatic'
        },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          // Always emit production JSX (jsx-runtime, not jsx-dev-runtime) so the
          // built artifact is stable regardless of NODE_ENV at build time.
          minify: false,
          lib: {
            entry: resolve(__dirname, 'src/renderer-entry.tsx'),
            formats: ['es'],
            fileName: () => 'renderer.js'
          },
          rollupOptions: {
            // Self-contained: react/jsx-runtime are aliased to in-bundle shims,
            // lucide-react is bundled. Nothing is left external.
            external: []
          }
        }
      }
);
