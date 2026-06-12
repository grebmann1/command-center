/**
 * Renderer entry for the gus DISK extension.
 *
 * Default-exports a {@link RendererEntry}. The host loader blob-imports this
 * bundle and calls `activate({ React, host })`; we capture the host React into
 * the in-bundle holder (see ./host-react) BEFORE returning anything, so every
 * hook/JSX call the panel makes at render resolves against the host's single
 * React instance. Then we return the richer {@link ActivateResult} — panel +
 * the command-palette entry and nav badge previously declared on the built-in
 * `gusModule` — so the disk extension contributes the same three extension
 * points it did as a built-in.
 *
 * `react` / `react/jsx-runtime` are aliased to in-bundle shims at build time;
 * `lucide-react` is BUNDLED (the host does not provide it). The only thing this
 * bundle externalizes is nothing — it is fully self-contained.
 */
import type { RendererEntry, ActivateResult, ModuleHost } from '@cctc/extension-sdk/renderer';
import { setHostReact } from './host-react.js';
import GusPanel from '../../../plugins/gus/renderer/GusPanel.js';

const entry: RendererEntry = {
  activate({ React, host }): ActivateResult {
    // MUST run before the panel renders — primes the react / jsx-runtime shims.
    setHostReact(React);

    return {
      panel: GusPanel,
      // Ported verbatim from the built-in gusModule. Core namespaces this as
      // `ext:gus:say-hi`.
      commands: (h: ModuleHost) => [
        {
          id: 'say-hi',
          label: 'GUS: say hi',
          keywords: ['hello', 'greet', 'ping'],
          run: () => h.toast('Hello from the GUS module')
        }
      ],
      // Sidebar nav badge: number of open projects (cheap + synchronous).
      navBadge: (h: ModuleHost) => h.listProjects().length
    };
  }
};

export default entry;
