export const IPC = {
  projects: {
    list: 'projects:list',
    add: 'projects:add',
    remove: 'projects:remove',
    update: 'projects:update',
    touch: 'projects:touch',
    reorder: 'projects:reorder',
    pickDirectory: 'projects:pickDirectory',
    addRemote: 'projects:addRemote'
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
    onUpdated: 'terminals:onUpdated'
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
    searchFiles: 'fs:searchFiles'
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
    onAppended: 'inbox:onAppended',
    onRemoved: 'inbox:onRemoved'
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
  app: {
    homedir: 'app:homedir'
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
    storageSet: 'modules:storageSet'
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
    revealTemplatesDir: 'scheduler:revealTemplatesDir'
  }
} as const;
