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
//
// Phase 2 dogfood: this panel exercises two new ModuleHost surfaces.
//   - host.on('project:changed', …): the project list re-renders LIVE when the
//     shell's active project switches, instead of being read once at mount.
//   - host.cache: a mount counter (survives unmount — switch nav away and back
//     and it keeps climbing) plus the last-seen project list, cached so a
//     remount paints immediately before the first event arrives. host.cache is
//     in-memory + synchronous (vs host.storage, which is async + persisted).
//
// SDK-2 dogfood: activate() returns the RICHER shape — { panel, commands,
// navBadge } — instead of a bare component, so this RUNTIME-loaded bundle now
// contributes a command palette entry and a sidebar nav badge, not just a panel.
// commands/navBadge use the same (host)=>… signatures as the built-in AppModule.
//
// Command-API dogfood: the second command exercises the additive
// ExtensionCommand fields — `icon`, `category`, and a declarative host-evaluated
// `when` (string-only, fail-closed) — all backward-compatible on SDK v1.
const entry = {
  activate({ React, host }) {
    function HelloPanel() {
      // Seed from cache so a remount paints the previously-seen list at once,
      // then fall back to a fresh read. Cache is synchronous — no await.
      const [projects, setProjects] = React.useState(function () {
        return host.cache.get('projects') || host.listProjects();
      });

      // Count mounts across the panel's lifetime. Lives in host.cache, so it
      // survives unmount (React state would reset on every nav switch).
      const mounts = (host.cache.get('mounts') || 0) + 1;
      React.useEffect(function () {
        host.cache.set('mounts', mounts);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Re-render the list live on project switches. Returns an unsubscribe fn;
      // returning it from the effect tears the subscription down on unmount.
      React.useEffect(function () {
        const off = host.on('project:changed', function () {
          const next = host.listProjects();
          host.cache.set('projects', next);
          setProjects(next);
        });
        return off;
      }, []);

      const active = host.getActiveProject();

      return React.createElement(
        'div',
        { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
        React.createElement('h2', { style: { marginTop: 0 } }, 'Hello from an extension'),
        React.createElement(
          'p',
          null,
          'Loaded ' + projects.length + ' project' + (projects.length === 1 ? '' : 's') +
            (active ? ' · active: ' + active.name : '') + ':'
        ),
        React.createElement(
          'ul',
          null,
          projects.map(function (p) {
            return React.createElement('li', { key: p.id }, p.name + ' — ' + p.path);
          })
        ),
        React.createElement(
          'p',
          { style: { fontSize: 12, opacity: 0.7 } },
          'Panel mounted ' + mounts + ' time' + (mounts === 1 ? '' : 's') + ' this session (via host.cache).'
        ),
        React.createElement(
          'button',
          { onClick: function () { host.toast('hello from extension'); } },
          'Say hello'
        )
      );
    }

    return {
      panel: HelloPanel,
      // A palette command (⌘K), namespaced by core as ext:hello:ping.
      commands: function (h) {
        return [
          {
            id: 'ping',
            label: 'Hello: ping',
            keywords: ['pong', 'greet'],
            icon: 'Sparkles',
            run: function () { h.toast('pong from hello'); }
          },
          {
            // SDK-1 (additive) dogfood: `icon` (lucide name, resolved
            // core-side), `category` (empty-query grouping label), and a
            // declarative host-evaluated `when` — a STRING, never a function;
            // an unknown key / parse error fails closed (command hidden). This
            // one is omitted from the palette when no project is selected.
            id: 'project-toast',
            label: 'Hello: name the active project',
            category: 'Hello · Project',
            icon: 'FolderGit2',
            when: 'hasActiveProject',
            run: function () {
              const p = h.getActiveProject();
              h.toast(p ? 'active project: ' + p.name : 'no active project');
            }
          }
        ];
      },
      // Sidebar nav badge: the number of open projects. Cheap + synchronous.
      navBadge: function (h) { return h.listProjects().length; }
    };
  },
};

export default entry;
