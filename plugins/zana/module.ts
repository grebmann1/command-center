/**
 * Zana app-module manifest (renderer side). Declares the nav entry, panel, and
 * a couple of palette commands; core's renderer registry imports this and wires
 * it into the sidebar + shell.
 */

import type { AppModule, ModuleHost } from '@cctc/extension-sdk/renderer';
import type { ZanaSnapshot } from './shared/types';
import ZanaPanel from './renderer/ZanaPanel';

export const zanaModule: AppModule = {
  id: 'zana',
  title: 'Zana',
  icon: 'LayoutDashboard',
  panel: ZanaPanel,
  // Declared, not yet enforced (curated-trust phase). See AppModule.permissions.
  permissions: ['storage', 'projects:read', 'projects:select', 'session:launch', 'inbox:push'],
  commands: (host: ModuleHost) => [
    {
      // A real, host-surface-only command (no new ModuleHost methods): fetch the
      // snapshot for the active project — or the global ~/.zana fallback — and
      // toast a one-line KPI summary. Scoped per-project; `when` keeps it out of
      // the palette on core views where there's nothing to scope to.
      id: 'status',
      label: 'Zana: Status snapshot',
      icon: 'LayoutDashboard',
      category: 'Zana',
      keywords: ['kpi', 'tickets', 'sprint', 'dashboard'],
      run: () => {
        const project = host.getActiveProject();
        host
          .call<ZanaSnapshot>('getSnapshot', { projectPath: project?.path })
          .then((snap) => {
            const k = snap.kpis;
            host.toast(
              `Zana · ${snap.source.label}: ${k.openTickets} open / ${k.totalTickets} tickets` +
                (k.blockedTickets ? ` · ${k.blockedTickets} blocked` : '') +
                ` · ${k.sprintCount} sprint${k.sprintCount === 1 ? '' : 's'}`
            );
          })
          .catch(() => host.toast("Couldn't load Zana snapshot", 'error'));
      }
    }
  ]
};
