import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  screen,
  Menu,
  nativeImage,
  powerMonitor
} from 'electron';
import { join, relative, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { IPC } from '../shared/ipc.js';
import { store } from './store.js';
import { PtyManager } from './pty.js';
import { listClaudeSessions } from './claude.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, walkFiles, searchFiles } from './fs.js';
import { openIn } from './openers.js';
import { getGitStatus, showHead, discardChanges } from './git.js';
import { createInboxStore, type IInboxStore, type InboxEntry } from './inbox-store.js';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { ensureMcpConfigForProject } from './mcp-config.js';
import { listMcpServers, setMcpServerEnabled } from './mcp.js';
import { readClaudeProjectSettings, writeClaudeProjectSettings } from './claude-settings.js';
import {
  listSkills,
  setSkillEnabled,
  setManyEnabled as setManySkillsEnabled,
  readHooks,
  revealSkillDir
} from './skills.js';
import { SkillBundlesStore } from './skill-bundles-store.js';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { listSshHosts } from './ssh-config.js';
import { SchedulerManager } from './scheduler.js';
import { TemplateStore } from './template-store.js';
import { homedir } from 'node:os';
import type {
  CreateTerminalRequest,
  Result,
  Project,
  OpenTarget,
  SearchOptions,
  AppConfig,
  ProjectSettings,
  ClaudeProjectSettings,
  ClaudeSettingsScope,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ScheduledTask,
  SkillBundleInput,
  SkillBundleApplyMode
} from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function logMainError(context: string, err: unknown) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[main] ${context}: ${message}`);
}

function isWithin(child: string, parent: string): boolean {
  if (!isAbsolute(child)) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Resolve `projectPath` (passed by the renderer) to listSkills options. */
function projectPathToOptions(projectPath?: string) {
  if (!projectPath) return {};
  const project = store.listProjects().find((p) => p.path === projectPath);
  return project ? { projectPath, projectId: project.id } : { projectPath };
}

function emitSkillsChangedDebounced() {
  if (skillChangeDebounce) clearTimeout(skillChangeDebounce);
  skillChangeDebounce = setTimeout(() => {
    skillChangeDebounce = null;
    safeSend(IPC.skills.onChanged);
  }, 250);
}

function watchSkillsTarget(target: string): FSWatcher | null {
  if (!existsSync(target)) return null;
  try {
    return fsWatch(target, { persistent: false, recursive: true }, () =>
      emitSkillsChangedDebounced()
    );
  } catch {
    try {
      return fsWatch(target, { persistent: false }, () => emitSkillsChangedDebounced());
    } catch {
      // Watcher unsupported on this fs — panel still works without live updates.
      return null;
    }
  }
}

function startSkillsWatchers() {
  const home = homedir();
  const targets = [
    join(home, '.claude', 'skills'),
    join(home, '.claude', 'plugins'),
    join(home, '.claude', 'settings.json')
  ];
  for (const target of targets) {
    const w = watchSkillsTarget(target);
    if (w) skillWatchers.push(w);
  }
}

function stopSkillsWatchers() {
  for (const w of skillWatchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  skillWatchers.length = 0;
  stopActiveProjectSkillsWatcher();
  if (skillChangeDebounce) {
    clearTimeout(skillChangeDebounce);
    skillChangeDebounce = null;
  }
}

function stopActiveProjectSkillsWatcher() {
  if (activeProjectSkillsWatcher) {
    try {
      activeProjectSkillsWatcher.close();
    } catch {
      /* ignore */
    }
    activeProjectSkillsWatcher = null;
  }
  activeProjectSkillsPath = null;
  activeProjectSkillsId = null;
}

/**
 * Re-point the per-project skills watcher at the currently active project.
 * Called from the `projects.touch` IPC handler so that switching projects
 * (or selecting one for the first time) lights up live updates for files
 * dropped into `<project>/.claude/skills/`.
 */
function setActiveProjectSkillsWatcher(
  projectPath: string | null,
  projectId: string | null
) {
  const target = projectPath ? join(projectPath, '.claude', 'skills') : null;
  if (target === activeProjectSkillsPath && projectId === activeProjectSkillsId) return;
  stopActiveProjectSkillsWatcher();
  if (!target) return;
  const w = watchSkillsTarget(target);
  if (w) {
    activeProjectSkillsWatcher = w;
    activeProjectSkillsPath = target;
    activeProjectSkillsId = projectId;
  }
}

let win: BrowserWindow | null = null;
const ptys = new PtyManager();
const inboxStore: IInboxStore = createInboxStore();
const scheduler = new SchedulerManager();
const templates = new TemplateStore(() => store.listProjects());
const skillBundles = new SkillBundlesStore();
const skillWatchers: FSWatcher[] = [];
let activeProjectSkillsWatcher: FSWatcher | null = null;
let activeProjectSkillsPath: string | null = null;
let activeProjectSkillsId: string | null = null;
let skillChangeDebounce: NodeJS.Timeout | null = null;
let mcpServer: McpServerHandle | null = null;

// Resolve packaged or unpackaged icon location. In dev electron-vite runs from
// repo root with __dirname=out/main, so the parent is the project root. Once
// packaged, electron-builder copies resources/ next to app.asar via `extraResources`,
// surfaced as process.resourcesPath.
function resolveIconPath(): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'icon.icns') : null,
    process.resourcesPath ? join(process.resourcesPath, 'icon-1024.png') : null,
    join(__dirname, '../../resources/icon.icns'),
    join(__dirname, '../../resources/icon-1024.png')
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function safeSend(channel: string, ...args: unknown[]) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isDestroyed()) return;
  try {
    win.webContents.send(channel, ...args);
  } catch (err) {
    logMainError(`send ${channel}`, err);
  }
}

function safeHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>,
  onError: (err: unknown, ...args: TArgs) => TResult
) {
  ipcMain.handle(channel, async (_event, ...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (err) {
      logMainError(`ipc ${channel}`, err);
      return onError(err, ...args);
    }
  });
}

function createWindow() {
  const saved = store.getConfig().windowBounds;
  // Only honor a saved position when it still lies on a connected display —
  // otherwise the window can open offscreen if a monitor was unplugged.
  const validBounds = (() => {
    if (!saved || saved.x === undefined || saved.y === undefined) return null;
    const displays = screen.getAllDisplays();
    const onScreen = displays.some((d) => {
      const { x, y, width, height } = d.workArea;
      return (
        saved.x! >= x &&
        saved.y! >= y &&
        saved.x! + saved.width <= x + width + 1 &&
        saved.y! + saved.height <= y + height + 1
      );
    });
    return onScreen ? saved : null;
  })();

  const iconPath = resolveIconPath();
  win = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: validBounds?.x,
    y: validBounds?.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Code Terminal Center',
    icon: iconPath ?? undefined,
    backgroundColor: '#0b0f15',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  // Harden every <webview> the renderer attaches: rewrite their preferences to
  // safe defaults and reject schemes other than http(s)/file/about. The user
  // never points the preview pane at app:// or javascript:, so any such URL is
  // either a typo or untrusted scrollback content — we drop it.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    delete (webPreferences as { preload?: string }).preload;
    const src = params.src ?? '';
    const ok =
      src === 'about:blank' ||
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('file://');
    if (!ok) event.preventDefault();
  });

  // Persist bounds on resize/move (debounced) so a relaunch restores them.
  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds();
      store.setConfig({ windowBounds: b });
    }, 400);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });

  ptys.on('data', (sessionId: string, data: string) => {
    safeSend(IPC.terminals.onData, sessionId, data);
  });
  ptys.on('exit', (sessionId: string, code: number) => {
    safeSend(IPC.terminals.onExit, sessionId, code);
  });
}

function registerIpc() {
  safeHandle(IPC.projects.list, () => store.listProjects(), () => []);
  ipcMain.handle(IPC.projects.add, async (_e, path: string): Promise<Result<Project>> => {
    try {
      const project = store.addProject(path);
      // Fire-and-forget the .mcp.json write; failure shouldn't block
      // adding a project (terminal still works without inbox push). Logged
      // for visibility.
      ensureMcpConfigForProject(project.id).catch((err) =>
        logMainError(`ensureMcpConfigForProject(${project.id})`, err)
      );
      templates.rebindProjects();
      return { ok: true, value: project };
    } catch (err) {
      return { ok: false, code: 'ADD_FAILED', message: String(err) };
    }
  });
  ipcMain.handle(
    IPC.projects.addRemote,
    async (
      _e,
      input: { host: string; user?: string; remotePath?: string; name?: string }
    ): Promise<Result<Project>> => {
      try {
        const project = store.addRemoteProject(input);
        return { ok: true, value: project };
      } catch (err) {
        return { ok: false, code: 'ADD_REMOTE_FAILED', message: String(err) };
      }
    }
  );
  safeHandle(IPC.ssh.listHosts, () => listSshHosts(), () => []);
  safeHandle(
    IPC.projects.remove,
    (id: string) => {
      ptys.list(id).forEach((s) => ptys.close(s.id));
      store.removeProject(id);
      scheduler.onProjectRemoved(id);
      templates.rebindProjects();
      // If the removed project was the one whose .claude/skills we were watching,
      // tear the watcher down — its path is now gone or owned by no-one.
      if (activeProjectSkillsId === id) setActiveProjectSkillsWatcher(null, null);
    },
    () => undefined
  );
  safeHandle(
    IPC.projects.update,
    (id: string, patch: { name?: string; color?: string }) => store.updateProject(id, patch),
    () => null
  );
  safeHandle(
    IPC.projects.touch,
    (id: string) => {
      const touched = store.touchProject(id);
      // Re-point the per-project skills watcher whenever the renderer signals
      // a project switch — `projects.touch` is the canonical "selected" signal.
      setActiveProjectSkillsWatcher(touched?.path ?? null, touched?.id ?? null);
      return touched;
    },
    () => null
  );
  safeHandle(
    IPC.projects.reorder,
    (orderedIds: string[]) => store.reorderProjects(orderedIds),
    () => []
  );
  safeHandle(
    IPC.projects.pickDirectory,
    async () => {
      if (!win || win.isDestroyed()) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    },
    () => null
  );

  safeHandle(IPC.terminals.list, (projectId: string) => ptys.list(projectId), () => []);
  ipcMain.handle(IPC.terminals.create, (_e, req: CreateTerminalRequest): Result<unknown> => {
    const project = store.listProjects().find((p) => p.id === req.projectId);
    if (!project) return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
    try {
      // Remote projects ignore req.cwd entirely — the cwd is on the remote
      // host and is set via the in-shell `cd` we inject into the ssh argv.
      const cwd =
        project.remote
          ? project.path
          : req.cwd && isWithin(req.cwd, project.path)
          ? req.cwd
          : project.path;
      const session = ptys.create({
        projectId: req.projectId,
        profile: req.profile,
        cwd,
        cols: req.cols,
        rows: req.rows,
        config: store.getConfig(),
        projectSettings: store.getProjectSettings(req.projectId),
        extraArgs: req.extraArgs,
        title: req.title,
        remote: project.remote
      });
      return { ok: true, value: session };
    } catch (err) {
      return { ok: false, code: 'PTY_SPAWN_FAILED', message: String(err) };
    }
  });
  safeHandle(
    IPC.terminals.write,
    (id: string, data: string) => ptys.write(id, data),
    () => undefined
  );
  safeHandle(
    IPC.terminals.resize,
    (id: string, cols: number, rows: number) => ptys.resize(id, cols, rows),
    () => undefined
  );
  safeHandle(IPC.terminals.close, (id: string) => ptys.close(id), () => undefined);

  safeHandle(IPC.config.get, () => store.getConfig(), () => store.getConfig());
  safeHandle<[Partial<AppConfig>], AppConfig>(
    IPC.config.set,
    (patch) => store.setConfig(patch),
    () => store.getConfig()
  );

  safeHandle(
    IPC.projectSettings.get,
    (id: string) => store.getProjectSettings(id),
    () => ({} as ProjectSettings)
  );
  safeHandle<[string, Partial<ProjectSettings>], ProjectSettings>(
    IPC.projectSettings.set,
    (id, patch) => store.setProjectSettings(id, patch),
    (_, id) => store.getProjectSettings(id)
  );

  safeHandle(
    IPC.claude.listSessions,
    (projectPath: string) => listClaudeSessions(projectPath),
    () => []
  );

  safeHandle(IPC.fs.listDir, (p: string) => listDir(p), () => []);
  safeHandle(IPC.fs.readFile, (p: string) => fsReadFile(p), () => ({ ok: false, message: 'Read failed' }));
  safeHandle(
    IPC.fs.writeFile,
    (p: string, content: string) => fsWriteFile(p, content),
    () => ({ ok: false, message: 'Write failed' })
  );
  safeHandle(IPC.fs.walkFiles, (p: string) => walkFiles(p), () => []);
  safeHandle(
    IPC.fs.searchFiles,
    (p: string, q: string, opts?: SearchOptions) => searchFiles(p, q, opts),
    () => ({ hits: [], scanned: 0, truncated: false })
  );
  safeHandle(
    IPC.openers.openIn,
    (target: OpenTarget, p: string) => openIn(target, p),
    () => ({ ok: false, message: 'Open failed' })
  );
  safeHandle(IPC.git.status, (p: string) => getGitStatus(p), () => null);
  safeHandle(IPC.git.showHead, (p: string) => showHead(p), () => ({ ok: false, message: 'git show failed' }));
  safeHandle(IPC.git.discard, (p: string) => discardChanges(p), () => ({ ok: false, message: 'git discard failed' }));

  // Inbox: history/delete RPCs + push subscriptions. We subscribe to the
  // store once at registration (registerIpc is called exactly once from
  // app.whenReady) and let `safeSend` no-op if the renderer isn't ready
  // yet — that way late subscribers in the renderer pick up the next
  // event without us re-binding listeners on window reactivation.
  safeHandle(
    IPC.inbox.history,
    (opts?: { limit?: number; before?: string; projectId?: string }) =>
      inboxStore.read(opts),
    () => ({ entries: [], hasMore: false })
  );
  safeHandle(
    IPC.inbox.delete,
    (id: string) => inboxStore.delete(id),
    () => false
  );
  inboxStore.onAppended((entry: InboxEntry) => {
    safeSend(IPC.inbox.onAppended, entry);
  });
  inboxStore.onRemoved((id: string) => {
    safeSend(IPC.inbox.onRemoved, id);
  });

  safeHandle(
    IPC.mcp.list,
    (projectPath: string) => listMcpServers(projectPath),
    () => []
  );
  safeHandle(
    IPC.mcp.setEnabled,
    (projectPath: string, name: string, enabled: boolean) =>
      setMcpServerEnabled(projectPath, name, enabled),
    () => undefined
  );

  safeHandle(
    IPC.claudeSettings.read,
    (projectPath: string, scope: ClaudeSettingsScope) =>
      readClaudeProjectSettings(projectPath, scope),
    (_err, projectPath: string, scope: ClaudeSettingsScope) => ({
      exists: false,
      path: `${projectPath}/.claude/${scope === 'shared' ? 'settings.json' : 'settings.local.json'}`,
      settings: {}
    })
  );
  safeHandle(
    IPC.claudeSettings.write,
    (projectPath: string, scope: ClaudeSettingsScope, patch: ClaudeProjectSettings) =>
      writeClaudeProjectSettings(projectPath, scope, patch),
    (_err, projectPath: string, scope: ClaudeSettingsScope) => ({
      exists: false,
      path: `${projectPath}/.claude/${scope === 'shared' ? 'settings.json' : 'settings.local.json'}`,
      settings: {}
    })
  );

  safeHandle(
    IPC.skills.list,
    (projectPath?: string) => listSkills(projectPathToOptions(projectPath)),
    () => []
  );
  safeHandle(
    IPC.skills.setEnabled,
    (name: string, enabled: boolean) => setSkillEnabled(name, enabled),
    () => undefined
  );
  safeHandle(
    IPC.skills.setManyEnabled,
    (updates: Array<{ name: string; enabled: boolean }>) => setManySkillsEnabled(updates),
    () => undefined
  );
  safeHandle(IPC.skills.readHooks, () => readHooks(), () => null);
  safeHandle(
    IPC.skills.reveal,
    (skillId: string, projectPath?: string) =>
      revealSkillDir(skillId, projectPathToOptions(projectPath)),
    () => ({ ok: false, path: '', message: 'reveal failed' })
  );

  safeHandle(IPC.skills.bundles.list, () => skillBundles.list(), () => []);
  safeHandle(
    IPC.skills.bundles.create,
    (input: SkillBundleInput) => skillBundles.create(input),
    () => null
  );
  safeHandle(
    IPC.skills.bundles.update,
    (id: string, patch: Partial<SkillBundleInput>) => skillBundles.update(id, patch),
    () => null
  );
  safeHandle(
    IPC.skills.bundles.delete,
    (id: string) => skillBundles.delete(id),
    () => false
  );
  safeHandle(
    IPC.skills.bundles.apply,
    (id: string, mode: SkillBundleApplyMode, projectPath?: string) =>
      skillBundles.apply(id, mode, projectPathToOptions(projectPath)),
    () => ({ ok: false, message: 'apply failed' })
  );
  skillBundles.on('changed', (bundles) => {
    safeSend(IPC.skills.bundles.onChanged, bundles);
  });
  safeHandle(IPC.app.homedir, () => homedir(), () => '');

  safeHandle(IPC.scheduler.list, () => scheduler.list(), () => []);
  ipcMain.handle(
    IPC.scheduler.create,
    async (_e, input: ScheduleCreateInput): Promise<Result<ScheduledTask>> => {
      try {
        return { ok: true, value: scheduler.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.update,
    async (_e, id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>> => {
      try {
        return { ok: true, value: scheduler.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        scheduler.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.setEnabled,
    async (_e, id: string, enabled: boolean): Promise<Result<ScheduledTask>> => {
      try {
        const task = scheduler.setEnabled(id, enabled);
        if (!task) return { ok: false, code: 'NOT_FOUND', message: `schedule not found: ${id}` };
        return { ok: true, value: task };
      } catch (err) {
        return { ok: false, code: 'SET_ENABLED_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.runNow,
    async (_e, id: string): Promise<Result<ScheduledTask>> => {
      try {
        return { ok: true, value: scheduler.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    }
  );
  scheduler.on('changed', () => {
    safeSend(IPC.scheduler.onChanged, scheduler.list());
  });

  safeHandle(IPC.scheduler.listTemplates, () => templates.list(), () => []);
  safeHandle(
    IPC.scheduler.revealTemplatesDir,
    () => templates.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal templates directory' })
  );
  templates.on('changed', () => {
    safeSend(IPC.scheduler.onTemplatesChanged, templates.list());
  });
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const appName = 'Claude Code Terminal Center';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: 'about' as const, label: `About ${appName}` },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => win?.webContents.send('app:openSettings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Claude Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => win?.webContents.send('app:newClaudeTab')
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => win?.webContents.send('app:reopenTab')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => win?.webContents.send('app:closeTab')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Terminals / Explorer',
          accelerator: 'CmdOrCtrl+B',
          click: () => win?.webContents.send('app:toggleWorkspaceMode')
        },
        {
          label: 'Toggle Inbox',
          accelerator: 'CmdOrCtrl+I',
          click: () => win?.webContents.send('app:toggleInbox')
        },
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+P',
          click: () => win?.webContents.send('app:openPalette')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ] satisfies Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' as const }] satisfies Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => win?.webContents.send('app:openShortcuts')
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/grebmann/claude-code-terminal-center')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Apply branding before any window opens so the dock + About panel pick it up.
  app.setName('Claude Code Terminal Center');
  const iconPath = resolveIconPath();
  if (process.platform === 'darwin' && iconPath && app.dock) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch (err) {
      logMainError('dock.setIcon', err);
    }
  }
  app.setAboutPanelOptions({
    applicationName: 'Claude Code Terminal Center',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: '© 2026 grebmann',
    website: 'https://github.com/grebmann/claude-code-terminal-center',
    iconPath: iconPath ?? undefined
  });
  buildAppMenu();
  registerIpc();
  scheduler.setDeps({ ptys, store, logger: logMainError });
  scheduler.loadAll(store.listProjects());
  // Wake-from-sleep can leave many schedules well past their armed delay;
  // a re-load triggers our `arm()` drift fix so each one re-arms fresh
  // rather than firing in a stampede the moment the laptop wakes up.
  try {
    powerMonitor.on('resume', () => {
      scheduler.loadAll(store.listProjects());
    });
  } catch (err) {
    logMainError('powerMonitor.resume', err);
  }
  templates.start();
  skillBundles.start();
  startSkillsWatchers();
  // Boot the local MCP server, then plumb its URL into PtyManager so any
  // claude-family terminal spawns get `CC_MCP_URL` injected. Errors here
  // are logged but non-fatal — the app still works without inbox push.
  startMcpServer({
    inboxStore,
    projects: {
      get: (id: string) => store.listProjects().find((p) => p.id === id) ?? null
    }
  })
    .then(async (handle) => {
      mcpServer = handle;
      ptys.setMcpBaseUrl(handle.url);
      // Backfill .mcp.json for any project that doesn't already have one
      // (idempotent — safe to re-run on every boot).
      for (const project of store.listProjects()) {
        try {
          await ensureMcpConfigForProject(project.id);
        } catch (err) {
          logMainError(`ensureMcpConfigForProject(${project.id})`, err);
        }
      }
    })
    .catch((err) => logMainError('startMcpServer', err));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ptys.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  scheduler.stopAll();
  templates.stop();
  skillBundles.stop();
  stopSkillsWatchers();
  ptys.killAll();
  if (mcpServer) {
    const handle = mcpServer;
    mcpServer = null;
    handle.close().catch((err) => logMainError('mcpServer.close', err));
  }
});

process.on('uncaughtException', (err) => {
  logMainError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logMainError('unhandledRejection', reason);
});

// Disable navigation to external URLs in the renderer; open in browser instead
app.on('web-contents-created', (_e, contents) => {
  contents.on('render-process-gone', (_event, details) => {
    logMainError('render-process-gone', details.reason);
  });
  contents.on('did-fail-load', (_event, code, description, url) => {
    logMainError('did-fail-load', `${code} ${description} (${url})`);
  });
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('child-process-gone', (_event, details) => {
  logMainError('child-process-gone', details.type + ':' + details.reason);
});
