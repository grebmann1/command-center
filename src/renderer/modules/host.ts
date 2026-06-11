/**
 * Builds a `ModuleHost` for a given module id. Each method routes through the
 * generic `window.cc.modules` bridge (multiplexed IPC) or existing core
 * surfaces (inbox push, toasts), keeping modules decoupled from core wiring.
 */

import type { ModuleHost } from '@shared/module-api';
import { useData, useUi } from '../store';

export function createModuleHost(moduleId: string): ModuleHost {
  return {
    moduleId,
    call: <T = unknown>(capability: string, ...args: unknown[]) =>
      window.cc.modules.call(moduleId, capability, args) as Promise<T>,
    storage: {
      get: <T = unknown>(key: string) =>
        window.cc.modules.storageGet(moduleId, key) as Promise<T | undefined>,
      set: (key: string, value: unknown) => window.cc.modules.storageSet(moduleId, key, value)
    },
    openExternal: (url: string) => {
      void window.cc.openers.openIn('browser', url);
    },
    pushInbox: async () => {
      // Inbox push is agent-driven (MCP); a renderer module pushing directly
      // isn't wired yet. Kept on the contract so the capability is stable.
      throw new Error('pushInbox is not available to renderer modules yet');
    },
    toast: (message: string, kind?: 'info' | 'error') => {
      useUi.getState().pushToast(message, kind);
    },
    getActiveProject: () => {
      const id = useUi.getState().selectedProjectId;
      if (!id) return null;
      const p = useData.getState().projects.find((p) => p.id === id);
      return p ? { id: p.id, name: p.name, path: p.path } : null;
    },
    listProjects: () =>
      useData.getState().projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    selectProject: (projectId: string | null) => {
      useUi.getState().selectProject(projectId);
    },
    launchSession: async ({ projectId, extraArgs, title, cwd }) => {
      // Mirror CommandPalette.launch: spawn a claude tab, then bring the shell
      // to it (nav → projects, select the project + new tab, show terminals).
      const session = await useData
        .getState()
        .createTerminal(projectId, 'claude', 80, 24, { extraArgs, title, cwd });
      if (!session) return null;
      const ui = useUi.getState();
      ui.setNav('projects');
      ui.selectProject(projectId);
      ui.selectTab(projectId, session.id);
      ui.setWorkspaceMode(projectId, 'terminals');
      return { id: session.id };
    }
  };
}
