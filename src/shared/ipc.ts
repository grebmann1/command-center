export const IPC = {
  projects: {
    list: 'projects:list',
    add: 'projects:add',
    remove: 'projects:remove',
    update: 'projects:update',
    touch: 'projects:touch',
    reorder: 'projects:reorder',
    pickDirectory: 'projects:pickDirectory',
    addRemote: 'projects:addRemote',
    ensureQuickAgent: 'projects:ensureQuickAgent',
    onChanged: 'projects:onChanged'
  },
  ssh: {
    listHosts: 'ssh:listHosts',
    syncHosts: 'ssh:syncHosts'
  },
  terminals: {
    list: 'terminals:list',
    create: 'terminals:create',
    write: 'terminals:write',
    reply: 'terminals:reply',
    resize: 'terminals:resize',
    close: 'terminals:close',
    setHeadless: 'terminals:setHeadless',
    onData: 'terminals:onData',
    onExit: 'terminals:onExit',
    onTitle: 'terminals:onTitle',
    onUpdated: 'terminals:onUpdated',
    /** Live agent-state pushes (working/blocked/done/idle). Dedicated channel —
     *  kept off `onUpdated` so status ticks don't rebuild the session list. */
    onAgentStatus: 'terminals:onAgentStatus'
  },
  config: {
    get: 'config:get',
    set: 'config:set'
  },
  projectSettings: {
    get: 'projectSettings:get',
    set: 'projectSettings:set'
  },
  claude: {
    listSessions: 'claude:listSessions'
  },
  fs: {
    listDir: 'fs:listDir',
    readFile: 'fs:readFile',
    writeFile: 'fs:writeFile',
    walkFiles: 'fs:walkFiles',
    searchFiles: 'fs:searchFiles',
    readDataUrl: 'fs:readDataUrl'
  },
  openers: {
    openIn: 'openers:openIn'
  },
  git: {
    status: 'git:status',
    showHead: 'git:showHead',
    discard: 'git:discard'
  },
  inbox: {
    history: 'inbox:history',
    delete: 'inbox:delete',
    deleteMany: 'inbox:deleteMany',
    exportPdf: 'inbox:exportPdf',
    onAppended: 'inbox:onAppended',
    onRemoved: 'inbox:onRemoved'
  },
  saved: {
    save: 'saved:save',
    list: 'saved:list',
    delete: 'saved:delete',
    onChanged: 'saved:onChanged'
  },
  library: {
    list: 'library:list',
    add: 'library:add',
    update: 'library:update',
    remove: 'library:remove',
    reveal: 'library:reveal',
    onChanged: 'library:onChanged'
  },
  mcp: {
    list: 'mcp:list',
    setEnabled: 'mcp:setEnabled',
    listAll: 'mcp:listAll',
    setEnabledById: 'mcp:setEnabledById',
    reveal: 'mcp:reveal',
    onChanged: 'mcp:onChanged'
  },
  plugins: {
    list: 'plugins:list',
    setEnabled: 'plugins:setEnabled',
    reveal: 'plugins:reveal',
    onChanged: 'plugins:onChanged'
  },
  /**
   * Runtime extensions under `~/.cc-center/extensions/<id>/`. Mirrors the
   * `plugins:` shape. `readRendererEntry` returns the extension's renderer
   * bundle JS as a string for the renderer to blob-import (P1-C).
   */
  extensions: {
    list: 'extensions:list',
    setEnabled: 'extensions:setEnabled',
    reveal: 'extensions:reveal',
    readRendererEntry: 'extensions:readRendererEntry',
    onChanged: 'extensions:onChanged',
    // P3-D: persist the user's consent to an extension's CURRENT declared
    // permissions, then re-discover (which spawns/mounts it). The renderer reads
    // `consented`/`needsConsent` on each ExtensionEntry to decide when to prompt.
    grantConsent: 'extensions:grantConsent'
  },
  claudeSettings: {
    read: 'claudeSettings:read',
    write: 'claudeSettings:write'
  },
  skills: {
    list: 'skills:list',
    setEnabled: 'skills:setEnabled',
    setManyEnabled: 'skills:setManyEnabled',
    readHooks: 'skills:readHooks',
    reveal: 'skills:reveal',
    onChanged: 'skills:onChanged',
    bundles: {
      list: 'skills:bundles:list',
      create: 'skills:bundles:create',
      update: 'skills:bundles:update',
      delete: 'skills:bundles:delete',
      apply: 'skills:bundles:apply',
      onChanged: 'skills:bundles:onChanged'
    }
  },
  commands: {
    list: 'commands:list'
  },
  app: {
    homedir: 'app:homedir',
    version: 'app:version'
  },
  /**
   * Auto-update (electron-updater). `check`/`quitAndInstall` are renderer→main
   * requests; `onStatus`/`onProgress` are main→renderer pushes driven by the
   * autoUpdater event stream. Only core can push (modules can't), so this lives
   * here rather than in a module.
   */
  updates: {
    check: 'updates:check',
    quitAndInstall: 'updates:quitAndInstall',
    onStatus: 'updates:onStatus',
    onProgress: 'updates:onProgress'
  },
  /**
   * Generic multiplexer for app modules (plugins/*). One channel pair for
   * all modules: `call` dispatches `{ moduleId, capability, args }` to the
   * module's main-side capability map; `storage*` back `ModuleHost.storage`.
   * Modules add nothing else to this file.
   */
  modules: {
    call: 'modules:call',
    storageGet: 'modules:storageGet',
    storageSet: 'modules:storageSet',
    pushInbox: 'modules:pushInbox'
  },
  scheduler: {
    list: 'scheduler:list',
    create: 'scheduler:create',
    update: 'scheduler:update',
    delete: 'scheduler:delete',
    setEnabled: 'scheduler:setEnabled',
    runNow: 'scheduler:runNow',
    onChanged: 'scheduler:onChanged',
    listTemplates: 'scheduler:listTemplates',
    onTemplatesChanged: 'scheduler:onTemplatesChanged',
    revealTemplatesDir: 'scheduler:revealTemplatesDir',
    groupsList: 'scheduler:groups:list',
    groupsCreate: 'scheduler:groups:create',
    groupsUpdate: 'scheduler:groups:update',
    groupsDelete: 'scheduler:groups:delete',
    groupsReorder: 'scheduler:groups:reorder',
    groupsOnChanged: 'scheduler:groups:onChanged'
  },
  personas: {
    list: 'personas:list',
    onChanged: 'personas:onChanged',
    revealDir: 'personas:revealDir'
  },
  quickPrompts: {
    list: 'quickPrompts:list',
    onChanged: 'quickPrompts:onChanged',
    revealDir: 'quickPrompts:revealDir'
  }
} as const;
