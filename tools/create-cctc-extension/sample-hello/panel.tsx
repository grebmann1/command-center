/**
 * Source for the `hello` sample extension. This is the MAINTAINABLE source; the
 * runnable artifact (the built ESM) is committed at examples/extensions/hello/
 * so QA can copy it straight into ~/.cc-center/extensions/hello/ with no build.
 *
 * If you change this file, hand-port the change into
 * examples/extensions/hello/renderer.js (it's intentionally tiny and authored
 * directly as valid ESM — see the note there).
 *
 * Contract reminders:
 *   - DO NOT import react. The host injects React via activate({ React, host }).
 *   - Build with React.createElement (not JSX) so nothing references the
 *     externalized jsx-runtime.
 */
import type { RendererEntry, ModuleHost } from '@cctc/extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    return function HelloPanel(_props: { host: ModuleHost }) {
      const projects = host.listProjects();

      return React.createElement(
        'div',
        { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
        React.createElement('h2', { style: { marginTop: 0 } }, 'Hello from an extension'),
        React.createElement(
          'p',
          null,
          `Loaded ${projects.length} project${projects.length === 1 ? '' : 's'}:`
        ),
        React.createElement(
          'ul',
          null,
          projects.map((p) =>
            React.createElement('li', { key: p.id }, `${p.name} — ${p.path}`)
          )
        ),
        React.createElement(
          'button',
          { onClick: () => host.toast('hello from extension') },
          'Say hello'
        )
      );
    };
  },
};

export default entry;
