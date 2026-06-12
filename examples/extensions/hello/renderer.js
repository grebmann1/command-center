// Built renderer bundle for the `hello` sample extension.
//
// This is the runnable artifact the CCTC loader imports: valid ESM that imports
// NOTHING (React is injected by the host via activate({ React, host })) and
// default-exports a RendererEntry ({ activate }). It is equivalent to a Vite
// library-mode build of tools/create-cctc-extension/sample-hello/panel.tsx with
// react/react-dom/react/jsx-runtime externalized — since React comes from the
// activate context, the bundle has no bare imports at all.
//
// Hand-authored (it's tiny); keep it in sync with the .tsx source.
const entry = {
  activate({ React, host }) {
    return function HelloPanel() {
      const projects = host.listProjects();

      return React.createElement(
        'div',
        { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
        React.createElement('h2', { style: { marginTop: 0 } }, 'Hello from an extension'),
        React.createElement(
          'p',
          null,
          'Loaded ' + projects.length + ' project' + (projects.length === 1 ? '' : 's') + ':'
        ),
        React.createElement(
          'ul',
          null,
          projects.map(function (p) {
            return React.createElement('li', { key: p.id }, p.name + ' — ' + p.path);
          })
        ),
        React.createElement(
          'button',
          { onClick: function () { host.toast('hello from extension'); } },
          'Say hello'
        )
      );
    };
  },
};

export default entry;
