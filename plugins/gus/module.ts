/**
 * GUS app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 *
 * Also exercises the Phase 2 contribution points (`commands`, `navBadge`) as a
 * built-in. These live on the AppModule, and the runtime extension loader does
 * not today carry them from a renderer bundle (`RendererEntry.activate` returns
 * only a panel component), so a built-in module is the surface that proves the
 * shell wiring (CommandPalette + Sidebar `.nav-badge`) end-to-end.
 */

import type { AppModule } from '@cctc/extension-sdk/renderer';
import GusPanel from './renderer/GusPanel';

export const gusModule: AppModule = {
  id: 'gus',
  title: 'GUS',
  icon: 'Ticket',
  panel: GusPanel,
  // A harmless command contributed to the command palette (⌘K), namespaced by
  // core as `ext:gus:say-hi`. Proves the palette merges + isolates module
  // commands; `run` closes over the live host.
  commands: (host) => [
    {
      id: 'say-hi',
      label: 'GUS: say hi',
      keywords: ['hello', 'greet', 'ping'],
      run: () => host.toast('Hello from the GUS module')
    }
  ],
  // Sidebar nav badge: the number of open projects. Cheap and synchronous (a
  // single store read via the host), as the contract requires.
  navBadge: (host) => host.listProjects().length,
  // Declared, not yet enforced (curated-trust phase). See AppModule.permissions.
  permissions: ['storage', 'projects:read', 'session:launch', 'external:open']
};
