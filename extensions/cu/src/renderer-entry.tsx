/**
 * Renderer entry for the cu DISK extension.
 *
 * Default-exports a {@link RendererEntry}. The host loader blob-imports this
 * bundle and calls `activate({ React, host })`; we capture the host React into
 * the in-bundle holder (see ./host-react) BEFORE returning anything, so every
 * hook/JSX call the panel makes at render resolves against the host's single
 * React instance. Then we return the {@link ActivateResult} — panel + a few
 * command-palette entries + the running-session nav badge.
 *
 * `react` / `react/jsx-runtime` are aliased to in-bundle shims at build time;
 * `lucide-react` is BUNDLED (the host does not provide it). The bundle
 * externalizes nothing — it is fully self-contained.
 */
import type { RendererEntry, ActivateResult, ModuleHost } from '@cctc/extension-sdk/renderer';
import { setHostReact } from './host-react.js';
import CuPanel from './renderer/CuPanel.js';
import { RUNNING_COUNT_CACHE_KEY } from './shared/types.js';

const entry: RendererEntry = {
  activate({ React, host }): ActivateResult {
    // MUST run before the panel renders — primes the react / jsx-runtime shims.
    setHostReact(React);

    return {
      panel: CuPanel,
      // Core namespaces these as `ext:cu:<id>`.
      commands: (h: ModuleHost) => [
        {
          id: 'refresh-fleet',
          label: 'Fleet: refresh sessions',
          keywords: ['claude unleashed', 'cu', 'reload', 'sessions'],
          run: () => h.toast('Open Fleet to see the refreshed sessions.')
        },
        {
          id: 'pause-all',
          label: 'Fleet: pause all sessions',
          keywords: ['claude unleashed', 'cu', 'stop', 'suspend'],
          run: () => {
            void h
              .call<{ ok: boolean }>('pauseAll')
              .then((r) =>
                h.toast(r?.ok ? 'Paused all running sessions.' : "Couldn't pause sessions.", r?.ok ? 'info' : 'error')
              )
              .catch((err) =>
                h.toast(
                  `Couldn't pause sessions — ${err instanceof Error ? err.message : String(err)}`,
                  'error'
                )
              );
          }
        }
      ],
      // Sidebar nav badge: number of running sessions. Cheap + synchronous — it
      // reads the count the panel/poller stashes in the host cache after each
      // fetch (see CuPanel). null/0 → no badge.
      navBadge: (h: ModuleHost) => h.cache.get<number>(RUNNING_COUNT_CACHE_KEY) ?? null
    };
  }
};

export default entry;
