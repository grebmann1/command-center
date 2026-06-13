/**
 * Slack app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 */

import type { AppModule } from '@cctc/extension-sdk/renderer';
import SlackPanel from './renderer/SlackPanel';

export const slackModule: AppModule = {
  id: 'slack',
  title: 'Slack',
  icon: 'MessageSquare',
  panel: SlackPanel,
  // Declared, not yet enforced (curated-trust phase). See AppModule.permissions.
  permissions: ['storage', 'net', 'inbox:push', 'external:open']
};
