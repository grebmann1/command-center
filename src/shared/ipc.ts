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
  }
} as const;
