import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * Library-mode build: one entry in, one ESM out.
 *
 * We run Vite twice (renderer, then main) selected by the BUILD_TARGET env var,
 * because each side externalizes a different set:
 *   - renderer: externalize what the HOST owns — react, react-dom,
 *     react/jsx-runtime, lucide-react. The host injects React via activate();
 *     a second copy breaks hooks.
 *   - main: externalize electron + Node built-ins (the host's runtime provides
 *     them). Bundle everything else the extension brings.
 *
 * Output filenames MUST match the `entry` field in extension.json
 * (renderer.js / main.js).
 *
 * Build both with:  npm run build   (see package.json scripts)
 */
const target = process.env.BUILD_TARGET ?? 'renderer';

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig(
  target === 'main'
    ? {
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          lib: {
            entry: 'src/main/index.ts',
            formats: ['es'],
            fileName: () => 'main.js',
          },
          rollupOptions: {
            external: ['electron', ...nodeBuiltins],
          },
        },
      }
    : {
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          lib: {
            entry: 'src/renderer/panel.tsx',
            formats: ['es'],
            fileName: () => 'renderer.js',
          },
          rollupOptions: {
            external: [
              'react',
              'react-dom',
              'react/jsx-runtime',
              'lucide-react',
            ],
          },
        },
      }
);
