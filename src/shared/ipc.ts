export const IPC = {
  projects: {
    list: 'projects:list',
    add: 'projects:add',
    remove: 'projects:remove',
    update: 'projects:update',
    touch: 'projects:touch',
    reorder: 'projects:reorder',
    pickDirectory: 'projects:pickDirectory'
  },
  terminals: {
    list: 'terminals:list',
    create: 'terminals:create',
    write: 'terminals:write',
    resize: 'terminals:resize',
    close: 'terminals:close',
    onData: 'terminals:onData',
    onExit: 'terminals:onExit',
    onTitle: 'terminals:onTitle'
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
    setEnabled: 'mcp:setEnabled'
  },
  skills: {
    list: 'skills:list',
    setEnabled: 'skills:setEnabled',
    readHooks: 'skills:readHooks'
  },
  app: {
    homedir: 'app:homedir'
  }
} as const;
