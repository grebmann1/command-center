/**
 * Renderer entry for a CCTC extension.
 *
 * IMPORTANT: do NOT `import React from 'react'` here. The host injects its own
 * React instance into `activate({ React, host })`. A second React copy in the
 * bundle breaks hooks ("Invalid hook call"). The build externalizes `react`,
 * `react-dom`, `react/jsx-runtime`, and `lucide-react` so nothing ships a copy.
 *
 * Because React is injected (not imported), build your tree with
 * `React.createElement` rather than JSX — JSX would compile to an import of the
 * runtime this bundle deliberately externalizes.
 */
import type { RendererEntry, ModuleHost } from '@cctc/extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    function Panel(_props: { host: ModuleHost }) {
      const [count, setCount] = React.useState(0);

      return React.createElement(
        'div',
        { style: { padding: 16 } },
        React.createElement('h2', null, host.moduleId),
        React.createElement(
          'button',
          { onClick: () => setCount((n) => n + 1) },
          `clicked ${count} times`
        )
      );
    }

    // activate() may return the panel directly, or — as here — the richer
    // ActivateResult so your extension also contributes to the command palette
    // (⌘K) and the sidebar nav badge. All three fields are optional; drop the
    // ones you don't need (returning just `Panel` also works).
    return {
      panel: Panel,
      // Palette commands, namespaced by core as ext:<your-id>:<id>.
      commands: (h: ModuleHost) => [
        { id: 'say-hi', label: `${h.moduleId}: say hi`, run: () => h.toast('hi') }
      ],
      // A number | string | null badge on your sidebar nav entry (null = none).
      navBadge: (h: ModuleHost) => h.listProjects().length
    };
  },
};

export default entry;
