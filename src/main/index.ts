import { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, nativeImage } from 'electron';
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
import type {
  CreateTerminalRequest,
  Result,
  Project,
  OpenTarget,
  SearchOptions,
  AppConfig
} from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function logMainError(context: string, err: unknown) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[main] ${context}: ${message}`);
}

function isWithin(child: string, parent: string): boolean {
  if (!isAbsolute(child)) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

let win: BrowserWindow | null = null;
const ptys = new PtyManager();

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
      sandbox: false
    }
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
  ipcMain.handle(IPC.projects.add, (_e, path: string): Result<Project> => {
    try {
      return { ok: true, value: store.addProject(path) };
    } catch (err) {
      return { ok: false, code: 'ADD_FAILED', message: String(err) };
    }
  });
  safeHandle(
    IPC.projects.remove,
    (id: string) => {
      ptys.list(id).forEach((s) => ptys.close(s.id));
      store.removeProject(id);
    },
    () => undefined
  );
  safeHandle(
    IPC.projects.update,
    (id: string, patch: { name?: string; color?: string }) => store.updateProject(id, patch),
    () => null
  );
  safeHandle(IPC.projects.touch, (id: string) => store.touchProject(id), () => null);
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
      const cwd = req.cwd && isWithin(req.cwd, project.path) ? req.cwd : project.path;
      const session = ptys.create({
        projectId: req.projectId,
        profile: req.profile,
        cwd,
        cols: req.cols,
        rows: req.rows,
        config: store.getConfig(),
        extraArgs: req.extraArgs,
        title: req.title
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ptys.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => ptys.killAll());

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
