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
      useData.getState().projects.map((p) => ({ id: p.id, name: p.name, path: p.path }))
  };
}
