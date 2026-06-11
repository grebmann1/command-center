/**
 * Zana app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 */

import type { AppModule } from '@cctc/extension-sdk/renderer';
import ZanaPanel from './renderer/ZanaPanel';

export const zanaModule: AppModule = {
  id: 'zana',
  title: 'Zana',
  icon: 'LayoutDashboard',
  panel: ZanaPanel,
  // Declared, not yet enforced (curated-trust phase). See AppModule.permissions.
  permissions: ['storage', 'projects:read', 'projects:select', 'session:launch', 'inbox:push']
};
