import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipc.js';
import type {
  AgentState,
  CcApi,
  CreateTerminalRequest,
  ExtensionEntry,
  InboxEntry,
  LibraryDoc,
  McpServerEntry,
  Persona,
  PluginEntry,
  SavedRecord,
  TerminalSession,
  UpdateProgress,
  UpdateStatus
} from '../shared/types.js';

const api: CcApi = {
  projectSettings: {
    get: (id) => ipcRenderer.invoke(IPC.projectSettings.get, id),
    set: (id, patch) => ipcRenderer.invoke(IPC.projectSettings.set, id, patch)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projects.list),
    add: (path) => ipcRenderer.invoke(IPC.projects.add, path),
    remove: (id) => ipcRenderer.invoke(IPC.projects.remove, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.projects.update, id, patch),
    touch: (id) => ipcRenderer.invoke(IPC.projects.touch, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC.projects.reorder, orderedIds),
    pickDirectory: () => ipcRenderer.invoke(IPC.projects.pickDirectory),
    addRemote: (input) => ipcRenderer.invoke(IPC.projects.addRemote, input)
  },
  ssh: {
    listHosts: () => ipcRenderer.invoke(IPC.ssh.listHosts),
    syncHosts: () => ipcRenderer.invoke(IPC.ssh.syncHosts)
  },
  terminals: {
    list: (projectId) => ipcRenderer.invoke(IPC.terminals.list, projectId),
    create: (req: CreateTerminalRequest) => ipcRenderer.invoke(IPC.terminals.create, req),
    write: (id, data) => ipcRenderer.invoke(IPC.terminals.write, id, data),
    reply: (id, text) => ipcRenderer.invoke(IPC.terminals.reply, id, text),
    resize: (id, cols, rows) => ipcRenderer.invoke(IPC.terminals.resize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(IPC.terminals.close, id),
    setHeadless: (id, headless) =>
      ipcRenderer.invoke(IPC.terminals.setHeadless, id, headless),
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
    },
    onUpdated: (cb) => {
      const handler = (_e: unknown, session: TerminalSession) => cb(session);
      ipcRenderer.on(IPC.terminals.onUpdated, handler);
      return () => ipcRenderer.off(IPC.terminals.onUpdated, handler);
    },
    onAgentStatus: (cb) => {
      const handler = (_e: unknown, id: string, state: AgentState) => cb(id, state);
      ipcRenderer.on(IPC.terminals.onAgentStatus, handler);
      return () => ipcRenderer.off(IPC.terminals.onAgentStatus, handler);
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
      ipcRenderer.invoke(IPC.fs.searchFiles, path, query, opts),
    readDataUrl: (path) => ipcRenderer.invoke(IPC.fs.readDataUrl, path)
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
  inbox: {
    history: (opts) => ipcRenderer.invoke(IPC.inbox.history, opts),
    delete: (id) => ipcRenderer.invoke(IPC.inbox.delete, id),
    deleteMany: (ids) => ipcRenderer.invoke(IPC.inbox.deleteMany, ids),
    exportPdf: (input) => ipcRenderer.invoke(IPC.inbox.exportPdf, input),
    onAppended: (cb) => {
      const handler = (_e: unknown, entry: InboxEntry) => cb(entry);
      ipcRenderer.on(IPC.inbox.onAppended, handler);
      return () => ipcRenderer.off(IPC.inbox.onAppended, handler);
    },
    onRemoved: (cb) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(IPC.inbox.onRemoved, handler);
      return () => ipcRenderer.off(IPC.inbox.onRemoved, handler);
    }
  },
  saved: {
    save: (input) => ipcRenderer.invoke(IPC.saved.save, input),
    list: () => ipcRenderer.invoke(IPC.saved.list),
    delete: (id) => ipcRenderer.invoke(IPC.saved.delete, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, records: SavedRecord[]) => cb(records);
      ipcRenderer.on(IPC.saved.onChanged, handler);
      return () => ipcRenderer.off(IPC.saved.onChanged, handler);
    }
  },
  personas: {
    list: () => ipcRenderer.invoke(IPC.personas.list),
    revealDir: () => ipcRenderer.invoke(IPC.personas.revealDir),
    onChanged: (cb) => {
      const handler = (_e: unknown, personas: Persona[]) => cb(personas);
      ipcRenderer.on(IPC.personas.onChanged, handler);
      return () => ipcRenderer.off(IPC.personas.onChanged, handler);
    }
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.library.list),
    add: (input) => ipcRenderer.invoke(IPC.library.add, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.library.update, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.library.remove, id),
    reveal: (scope, projectId) => ipcRenderer.invoke(IPC.library.reveal, scope, projectId),
    onChanged: (cb) => {
      const handler = (_e: unknown, docs: LibraryDoc[]) => cb(docs);
      ipcRenderer.on(IPC.library.onChanged, handler);
      return () => ipcRenderer.off(IPC.library.onChanged, handler);
    }
  },
  mcp: {
    list: (projectPath) => ipcRenderer.invoke(IPC.mcp.list, projectPath),
    setEnabled: (projectPath, name, enabled) =>
      ipcRenderer.invoke(IPC.mcp.setEnabled, projectPath, name, enabled),
    listAll: () => ipcRenderer.invoke(IPC.mcp.listAll),
    setEnabledById: (id, enabled) =>
      ipcRenderer.invoke(IPC.mcp.setEnabledById, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.mcp.reveal, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: McpServerEntry[]) => cb(entries);
      ipcRenderer.on(IPC.mcp.onChanged, handler);
      return () => ipcRenderer.off(IPC.mcp.onChanged, handler);
    }
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.plugins.list),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.plugins.setEnabled, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.plugins.reveal, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: PluginEntry[]) => cb(entries);
      ipcRenderer.on(IPC.plugins.onChanged, handler);
      return () => ipcRenderer.off(IPC.plugins.onChanged, handler);
    }
  },
  extensions: {
    list: () => ipcRenderer.invoke(IPC.extensions.list),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.extensions.setEnabled, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.extensions.reveal, id),
    readRendererEntry: (id) => ipcRenderer.invoke(IPC.extensions.readRendererEntry, id),
    grantConsent: (id) => ipcRenderer.invoke(IPC.extensions.grantConsent, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: ExtensionEntry[]) => cb(entries);
      ipcRenderer.on(IPC.extensions.onChanged, handler);
      return () => ipcRenderer.off(IPC.extensions.onChanged, handler);
    }
  },
  claudeSettings: {
    read: (projectPath, scope) => ipcRenderer.invoke(IPC.claudeSettings.read, projectPath, scope),
    write: (projectPath, scope, patch) =>
      ipcRenderer.invoke(IPC.claudeSettings.write, projectPath, scope, patch)
  },
  skills: {
    list: (projectPath?: string) => ipcRenderer.invoke(IPC.skills.list, projectPath),
    setEnabled: (name: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC.skills.setEnabled, name, enabled),
    setManyEnabled: (updates) => ipcRenderer.invoke(IPC.skills.setManyEnabled, updates),
    readHooks: () => ipcRenderer.invoke(IPC.skills.readHooks),
    reveal: (skillId: string, projectPath?: string) =>
      ipcRenderer.invoke(IPC.skills.reveal, skillId, projectPath),
    onChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.skills.onChanged, handler);
      return () => ipcRenderer.off(IPC.skills.onChanged, handler);
    },
    bundles: {
      list: () => ipcRenderer.invoke(IPC.skills.bundles.list),
      create: (input) => ipcRenderer.invoke(IPC.skills.bundles.create, input),
      update: (id, patch) => ipcRenderer.invoke(IPC.skills.bundles.update, id, patch),
      delete: (id) => ipcRenderer.invoke(IPC.skills.bundles.delete, id),
      apply: (id, mode, projectPath) =>
        ipcRenderer.invoke(IPC.skills.bundles.apply, id, mode, projectPath),
      onChanged: (cb) => {
        const handler = (_e: unknown, bundles: Parameters<typeof cb>[0]) => cb(bundles);
        ipcRenderer.on(IPC.skills.bundles.onChanged, handler);
        return () => ipcRenderer.off(IPC.skills.bundles.onChanged, handler);
      }
    }
  },
  commands: {
    list: (projectPath?: string) => ipcRenderer.invoke(IPC.commands.list, projectPath)
  },
  scheduler: {
    list: () => ipcRenderer.invoke(IPC.scheduler.list),
    create: (input) => ipcRenderer.invoke(IPC.scheduler.create, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.scheduler.update, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.scheduler.delete, id),
    setEnabled: (id, enabled) =>
      ipcRenderer.invoke(IPC.scheduler.setEnabled, id, enabled),
    runNow: (id) => ipcRenderer.invoke(IPC.scheduler.runNow, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, tasks: Parameters<typeof cb>[0]) => cb(tasks);
      ipcRenderer.on(IPC.scheduler.onChanged, handler);
      return () => ipcRenderer.off(IPC.scheduler.onChanged, handler);
    },
    listTemplates: () => ipcRenderer.invoke(IPC.scheduler.listTemplates),
    onTemplatesChanged: (cb) => {
      const handler = (_e: unknown, templates: Parameters<typeof cb>[0]) => cb(templates);
      ipcRenderer.on(IPC.scheduler.onTemplatesChanged, handler);
      return () => ipcRenderer.off(IPC.scheduler.onTemplatesChanged, handler);
    },
    revealTemplatesDir: () => ipcRenderer.invoke(IPC.scheduler.revealTemplatesDir),
    groups: {
      list: () => ipcRenderer.invoke(IPC.scheduler.groupsList),
      create: (input) => ipcRenderer.invoke(IPC.scheduler.groupsCreate, input),
      update: (id, patch) => ipcRenderer.invoke(IPC.scheduler.groupsUpdate, id, patch),
      delete: (id) => ipcRenderer.invoke(IPC.scheduler.groupsDelete, id),
      reorder: (orderedIds) => ipcRenderer.invoke(IPC.scheduler.groupsReorder, orderedIds),
      onChanged: (cb) => {
        const handler = (_e: unknown, groups: Parameters<typeof cb>[0]) => cb(groups);
        ipcRenderer.on(IPC.scheduler.groupsOnChanged, handler);
        return () => ipcRenderer.off(IPC.scheduler.groupsOnChanged, handler);
      }
    }
  },
  modules: {
    call: (moduleId, capability, args) =>
      ipcRenderer.invoke(IPC.modules.call, moduleId, capability, args),
    storageGet: (moduleId, key) => ipcRenderer.invoke(IPC.modules.storageGet, moduleId, key),
    storageSet: (moduleId, key, value) =>
      ipcRenderer.invoke(IPC.modules.storageSet, moduleId, key, value),
    pushInbox: (moduleId, msg) => ipcRenderer.invoke(IPC.modules.pushInbox, moduleId, msg)
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
    },
    homedir: () => ipcRenderer.invoke(IPC.app.homedir),
    version: () => ipcRenderer.invoke(IPC.app.version),
    onFocusSession: (cb: (sessionId: string, projectId: string) => void) => {
      const handler = (_e: unknown, sessionId: string, projectId: string) =>
        cb(sessionId, projectId);
      ipcRenderer.on('app:focusSession', handler);
      return () => ipcRenderer.off('app:focusSession', handler);
    },
    onOpenScheduler: (cb: (taskId?: string) => void) => {
      const handler = (_e: unknown, taskId?: string) => cb(taskId);
      ipcRenderer.on('app:openScheduler', handler);
      return () => ipcRenderer.off('app:openScheduler', handler);
    }
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updates.check),
    quitAndInstall: () => ipcRenderer.invoke(IPC.updates.quitAndInstall),
    onStatus: (cb: (status: UpdateStatus) => void) => {
      const handler = (_e: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on(IPC.updates.onStatus, handler);
      return () => ipcRenderer.off(IPC.updates.onStatus, handler);
    },
    onProgress: (cb: (progress: UpdateProgress) => void) => {
      const handler = (_e: unknown, progress: UpdateProgress) => cb(progress);
      ipcRenderer.on(IPC.updates.onProgress, handler);
      return () => ipcRenderer.off(IPC.updates.onProgress, handler);
    }
  }
};

contextBridge.exposeInMainWorld('cc', api);
