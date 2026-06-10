/**
 * GUS app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 */

import type { AppModule } from '../../src/shared/module-api';
import GusPanel from './renderer/GusPanel';

export const gusModule: AppModule = {
  id: 'gus',
  title: 'GUS',
  icon: 'Ticket',
  panel: GusPanel
};
