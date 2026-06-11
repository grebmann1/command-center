/**
 * GUS app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 */

import type { AppModule } from '@cctc/extension-sdk/renderer';
import GusPanel from './renderer/GusPanel';

export const gusModule: AppModule = {
  id: 'gus',
  title: 'GUS',
  icon: 'Ticket',
  panel: GusPanel,
  // Declared, not yet enforced (curated-trust phase). See AppModule.permissions.
  permissions: ['storage', 'projects:read', 'session:launch', 'external:open']
};
