import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipc.js';
import type { CcApi, CreateTerminalRequest } from '../shared/types.js';

const api: CcApi = {
  projects: {
    list: () => ipcRenderer.invoke(IPC.projects.list),
    add: (path) => ipcRenderer.invoke(IPC.projects.add, path),
    remove: (id) => ipcRenderer.invoke(IPC.projects.remove, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.projects.update, id, patch),
    touch: (id) => ipcRenderer.invoke(IPC.projects.touch, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC.projects.reorder, orderedIds),
    pickDirectory: () => ipcRenderer.invoke(IPC.projects.pickDirectory)
  },
  terminals: {
    list: (projectId) => ipcRenderer.invoke(IPC.terminals.list, projectId),
    create: (req: CreateTerminalRequest) => ipcRenderer.invoke(IPC.terminals.create, req),
    write: (id, data) => ipcRenderer.invoke(IPC.terminals.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(IPC.terminals.resize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(IPC.terminals.close, id),
    onData: (cb) => {
      const handler = (_e: unknown, id: string, data: string) => cb(id, data);
      ipcRenderer.on(IPC.terminals.onData, handler);
      return () => ipcRenderer.off(IPC.terminals.onData, handler);
    },
    onExit: (cb) => {
      const handler = (_e: unknown, id: string, code: number) => cb(id, code);
      ipcRenderer.on(IPC.terminals.onExit, handler);
      return () => ipcRenderer.off(IPC.terminals.onExit, handler);
    },
    onTitle: (cb) => {
      const handler = (_e: unknown, id: string, title: string) => cb(id, title);
      ipcRenderer.on(IPC.terminals.onTitle, handler);
      return () => ipcRenderer.off(IPC.terminals.onTitle, handler);
    }
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.config.get),
    set: (patch) => ipcRenderer.invoke(IPC.config.set, patch)
  },
  claude: {
    listSessions: (projectPath) => ipcRenderer.invoke(IPC.claude.listSessions, projectPath)
  },
  fs: {
    listDir: (path) => ipcRenderer.invoke(IPC.fs.listDir, path),
    readFile: (path) => ipcRenderer.invoke(IPC.fs.readFile, path),
    writeFile: (path, content) => ipcRenderer.invoke(IPC.fs.writeFile, path, content),
    walkFiles: (path) => ipcRenderer.invoke(IPC.fs.walkFiles, path),
    searchFiles: (path, query, opts) =>
      ipcRenderer.invoke(IPC.fs.searchFiles, path, query, opts)
  },
  openers: {
    openIn: (target, path) => ipcRenderer.invoke(IPC.openers.openIn, target, path)
  },
  git: {
    status: (path) => ipcRenderer.invoke(IPC.git.status, path),
    showHead: (path) => ipcRenderer.invoke(IPC.git.showHead, path),
    discard: (path) => ipcRenderer.invoke(IPC.git.discard, path)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  app: {
    onMenuEvent: (cb: (event: string) => void) => {
      const events = [
        'app:openSettings',
        'app:newClaudeTab',
        'app:reopenTab',
        'app:closeTab',
        'app:toggleWorkspaceMode',
        'app:openPalette',
        'app:openShortcuts'
      ];
      const handlers = events.map((name) => {
        const h = () => cb(name);
        ipcRenderer.on(name, h);
        return { name, h };
      });
      return () => {
        for (const { name, h } of handlers) ipcRenderer.off(name, h);
      };
    }
  }
};

contextBridge.exposeInMainWorld('cc', api);
