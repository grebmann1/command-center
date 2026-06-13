/**
 * Proves the headline finding of the gus-disk dogfood: the BUILT renderer
 * bundle (extensions/gus/dist/renderer.js), when imported and activated with the
 * host's React, renders the gus panel WITHOUT an "Invalid hook call" and with
 * lucide icons present — i.e. react/jsx-runtime correctly resolve to the single
 * injected React, and lucide-react is bundled in.
 *
 * This imports the real built artifact (the same bytes the host blob-imports),
 * so it fails if the build regresses the react-shim / jsx-runtime-shim wiring.
 * It is skipped (not failed) when the bundle hasn't been built yet, so the
 * top-level `vitest run` stays green on a clean checkout; CI builds first.
 *
 * Rendering uses react-dom/server (no DOM needed) — it still runs the full hook
 * + render path, which is what would throw on a second React.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RendererEntry, ModuleHost } from '@cctc/extension-sdk/renderer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, 'dist', 'renderer.js');
const built = existsSync(bundlePath);

/** Minimal host stub — enough for activate() + a first render of the panel. */
function makeHost(): ModuleHost {
  return {
    moduleId: 'gus',
    call: async () => {
      // Keep the first render synchronous + cheap: every gus capability resolves
      // empty, so the panel paints its empty board (no error path).
      return [] as unknown;
    },
    storage: { get: async () => undefined, set: async () => {} },
    openExternal: () => {},
    pushInbox: async () => ({ id: 'x' }),
    toast: () => {},
    getActiveProject: () => null,
    listProjects: () => [],
    selectProject: () => {},
    launchSession: async () => null,
    on: () => () => {},
    cache: { get: () => undefined, set: () => {}, delete: () => {} }
  };
}

describe.skipIf(!built)('gus built renderer bundle (blob-import contract)', () => {
  it('activates with host React and renders the panel — no second-React hook crash, lucide bundled', async () => {
    // The host sets this global before importing any bundle (see
    // src/renderer/modules/loader.ts) so eval-time React APIs (lucide's
    // forwardRef) resolve. Mirror that here before importing the artifact.
    (globalThis as Record<string, unknown>).__CCTC_HOST_REACT__ = React;
    const mod = (await import(pathToFileURL(bundlePath).href)) as { default?: RendererEntry };
    const entry = mod.default;
    expect(entry, 'bundle default-exports a RendererEntry').toBeTruthy();
    expect(typeof entry!.activate).toBe('function');

    const host = makeHost();
    // Inject the SAME React this test uses — the host's single instance.
    const result = entry!.activate({ React, host });
    const activated = typeof result === 'function' ? { panel: result } : result;

    expect(typeof activated.panel).toBe('function');
    expect(typeof activated.commands).toBe('function');
    // No navBadge: removed because it only showed the open-project count, which
    // has nothing to do with GUS. See renderer-entry.tsx.
    expect(activated.navBadge).toBeUndefined();

    // Render the panel. This runs useState/useEffect/useMemo/useRef + JSX +
    // lucide icons. A second React would throw "Invalid hook call" HERE.
    const Panel = activated.panel as React.ComponentType<{ host: ModuleHost }>;
    const html = renderToStaticMarkup(React.createElement(Panel, { host }));

    // The panel root + a lucide icon (rendered as <svg>) prove JSX + lucide work.
    expect(html).toContain('gus-panel');
    expect(html).toContain('<svg'); // lucide icons render to inline SVG
    expect(html).toContain('GUS');

    // The ported contributions behave.
    const cmds = activated.commands!(host);
    expect(cmds[0]?.id).toBe('say-hi');
  });
});
