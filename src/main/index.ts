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
import { AgentStatusTracker } from './agent-status.js';
import { listClaudeSessions } from './claude.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, walkFiles, searchFiles, readDataUrl } from './fs.js';
import { openIn } from './openers.js';
import { getGitStatus, showHead, discardChanges } from './git.js';
import { createInboxStore, type IInboxStore, type InboxEntry } from './inbox-store.js';
import { exportInboxPdf } from './inbox-pdf.js';
import { createSavedStore, type ISavedStore } from './saved-store.js';
import type { SavedRecord, SavedRecordInput } from '../shared/types.js';
import { LibraryStore, type ILibraryStore } from './library-store.js';
import type { LibraryDoc, LibraryAddInput, LibraryScope } from '../shared/types.js';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { ensureMcpConfigForProject } from './mcp-config.js';
import { installCcCenterSkill, installSavedReportsSkill } from './skill-installer.js';
import { listMcpServers, setMcpServerEnabled } from './mcp.js';
import {
  listMcpServersAll,
  revealMcpServer,
  setMcpServerEnabledById
} from './mcp-catalogue.js';
import { listPlugins, revealPlugin, setPluginEnabled } from './plugins.js';
import { readClaudeProjectSettings, writeClaudeProjectSettings } from './claude-settings.js';
import {
  listSkills,
  setSkillEnabled,
  setManyEnabled as setManySkillsEnabled,
  readHooks,
  revealSkillDir
} from './skills.js';
import { SkillBundlesStore } from './skill-bundles-store.js';
import { ScheduleGroupsStore } from './schedule-groups-store.js';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { listSshHosts, syncWorkspaceHosts } from './ssh-config.js';
import { ensureProcessPath } from './env.js';
import { SchedulerManager } from './scheduler.js';
import { TrayController } from './tray.js';
import { TemplateStore } from './template-store.js';
import { MainModuleHost } from './modules/registry.js';
import { MAIN_MODULES } from './modules/index.js';
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
  ScheduleGroup,
  ScheduleGroupInput,
  SkillBundleInput,
  SkillBundleApplyMode,
  InboxPdfExport
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
    // Plugins and MCP share the same on-disk roots (~/.claude/plugins/ and
    // ~/.claude/settings.json) — fan out the same debounced tick to them
    // instead of installing duplicate watchers.
    void emitPluginsChanged();
    void emitMcpChanged();
  }, 250);
}

async function emitPluginsChanged() {
  try {
    const entries = await listPlugins();
    safeSend(IPC.plugins.onChanged, entries);
  } catch (err) {
    logMainError('emit plugins changed', err);
  }
}

async function emitMcpChanged() {
  try {
    const entries = await listMcpServersAll(store.listProjects());
    safeSend(IPC.mcp.onChanged, entries);
  } catch (err) {
    logMainError('emit mcp changed', err);
  }
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
    join(home, '.claude', 'settings.json'),
    // ~/.claude.json is the canonical source for user-scope MCP servers;
    // without watching it, McpPanel goes stale after `claude mcp add`.
    join(home, '.claude.json')
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
const agentStatus = new AgentStatusTracker();
const inboxStore: IInboxStore = createInboxStore();
const savedStore: ISavedStore = createSavedStore();
const libraryStore: ILibraryStore = new LibraryStore(() => store.listProjects());
const scheduler = new SchedulerManager();
let tray: TrayController | null = null;
const templates = new TemplateStore(() => store.listProjects());
const moduleHost = new MainModuleHost({ log: logMainError });
const skillBundles = new SkillBundlesStore();
const scheduleGroups = new ScheduleGroupsStore();
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

/** Bring the main window forward, recreating it if it was closed (macOS). */
function showMainWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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
    // Feed the raw PTY stream through the OSC-title detector. Cheap and
    // off the render path — only emits when the agent state actually changes.
    agentStatus.observeData(sessionId, data);
  });
  ptys.on('exit', (sessionId: string, code: number) => {
    safeSend(IPC.terminals.onExit, sessionId, code);
    agentStatus.remove(sessionId);
  });
  ptys.on('sessionUpdated', (session) => {
    safeSend(IPC.terminals.onUpdated, session);
  });
  agentStatus.on('status', (sessionId: string, state) => {
    safeSend(IPC.terminals.onAgentStatus, sessionId, state);
    // Diagnostic: the debounced state actually pushed to the renderer (drives
    // the dot + Agents tray). Pairs with [notify-hook] to show the full chain.
    console.log(`[agent-status] session=${sessionId.slice(0, 8)} → ${state}`);
  });
  // Claude's auto-generated task summary (parsed from the idle OSC title) —
  // the renderer adopts it as the tab name unless the user has manually
  // renamed the tab.
  agentStatus.on('title', (sessionId: string, title: string) => {
    safeSend(IPC.terminals.onTitle, sessionId, title);
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
      libraryStore.rebindProjects?.();
      scheduler.rebindWatchers();
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
  safeHandle(IPC.ssh.syncHosts, () => syncWorkspaceHosts(), () => ({ hosts: [] }));
  safeHandle(
    IPC.projects.remove,
    (id: string) => {
      ptys.list(id).forEach((s) => ptys.close(s.id));
      store.removeProject(id);
      scheduler.onProjectRemoved(id);
      scheduler.rebindWatchers();
      templates.rebindProjects();
      libraryStore.rebindProjects?.();
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
    IPC.terminals.reply,
    (id: string, text: string) => {
      ptys.reply(id, text);
    },
    () => undefined
  );
  safeHandle(
    IPC.terminals.resize,
    (id: string, cols: number, rows: number) => ptys.resize(id, cols, rows),
    () => undefined
  );
  safeHandle(IPC.terminals.close, (id: string) => ptys.close(id), () => undefined);
  safeHandle(
    IPC.terminals.setHeadless,
    (id: string, headless: boolean) => ptys.setHeadless(id, headless),
    () => null
  );

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
  safeHandle(
    IPC.inbox.deleteMany,
    (ids: string[]) => inboxStore.deleteMany(ids),
    () => 0
  );
  safeHandle(
    IPC.inbox.exportPdf,
    (input: InboxPdfExport) => exportInboxPdf(win, input),
    (err) => ({ ok: false, message: err instanceof Error ? err.message : String(err) })
  );
  inboxStore.onAppended((entry: InboxEntry) => {
    safeSend(IPC.inbox.onAppended, entry);
  });
  inboxStore.onRemoved((id: string) => {
    safeSend(IPC.inbox.onRemoved, id);
  });

  // Saved reports: save/list/delete RPCs + full-list change pushes. The save
  // onError returns null so a failed write surfaces as a toast in the renderer
  // rather than throwing across IPC (the bridge type is SavedRecord | null).
  safeHandle(
    IPC.saved.save,
    (input: SavedRecordInput) => savedStore.save(input),
    () => null
  );
  safeHandle(IPC.saved.list, () => savedStore.list(), () => []);
  safeHandle(
    IPC.saved.delete,
    (id: string) => savedStore.delete(id),
    () => false
  );
  savedStore.onChanged((records: SavedRecord[]) => {
    safeSend(IPC.saved.onChanged, records);
  });

  // Library: add/list/update/remove/reveal RPCs + full-list change pushes.
  safeHandle(IPC.library.list, () => libraryStore.list(), () => []);
  safeHandle(
    IPC.library.add,
    (input: LibraryAddInput) => libraryStore.add(input),
    () => null
  );
  safeHandle(
    IPC.library.update,
    (id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>) =>
      libraryStore.update(id, patch),
    () => null
  );
  safeHandle(
    IPC.library.remove,
    (id: string) => libraryStore.remove(id),
    () => false
  );
  safeHandle(
    IPC.library.reveal,
    (scope: LibraryScope, projectId?: string) => libraryStore.revealDir(scope, projectId),
    () => ({ ok: false, path: '', message: 'Reveal failed' })
  );
  libraryStore.onChanged(() => {
    const docs = libraryStore.list();
    safeSend(IPC.library.onChanged, docs);
  });

  safeHandle(IPC.fs.readDataUrl, (p: string) => readDataUrl(p), () => ({ ok: false, message: 'Read failed' }));

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
    IPC.mcp.listAll,
    () => listMcpServersAll(store.listProjects()),
    () => []
  );
  safeHandle(
    IPC.mcp.setEnabledById,
    async (id: string, enabled: boolean) => {
      const res = await setMcpServerEnabledById(id, enabled, store.listProjects());
      if (res.ok) void emitMcpChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.mcp.reveal,
    (id: string) => revealMcpServer(id, store.listProjects()),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );

  safeHandle(IPC.plugins.list, () => listPlugins(), () => []);
  safeHandle(
    IPC.plugins.setEnabled,
    async (id: string, enabled: boolean) => {
      const res = await setPluginEnabled(id, enabled);
      if (res.ok) {
        void emitPluginsChanged();
        // Plugin enable/disable cascades to plugin-source MCPs; refresh.
        void emitMcpChanged();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.plugins.reveal,
    (id: string) => revealPlugin(id),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
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
    () => ({ ok: false, applied: 0, skippedPlugin: 0, message: 'apply failed' })
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

  safeHandle(IPC.scheduler.groupsList, () => scheduleGroups.list(), () => []);
  ipcMain.handle(
    IPC.scheduler.groupsCreate,
    async (_e, input: ScheduleGroupInput): Promise<Result<ScheduleGroup>> => {
      try {
        return { ok: true, value: scheduleGroups.create(input) };
      } catch (err) {
        return { ok: false, code: 'GROUP_CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsUpdate,
    async (_e, id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>> => {
      try {
        const group = scheduleGroups.update(id, patch);
        if (!group) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: group };
      } catch (err) {
        return { ok: false, code: 'GROUP_UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsDelete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        const ok = scheduleGroups.delete(id);
        if (!ok) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'GROUP_DELETE_FAILED', message: String(err) };
      }
    }
  );
  safeHandle(
    IPC.scheduler.groupsReorder,
    (orderedIds: string[]) => scheduleGroups.reorder(orderedIds),
    () => []
  );
  scheduleGroups.on('changed', (groups: ScheduleGroup[]) => {
    safeSend(IPC.scheduler.groupsOnChanged, groups);
  });

  // App-module multiplexer: one handler set serves every module (plugins/*).
  // `call` dispatches to the module's capability; `storage*` back its KV store.
  safeHandle(
    IPC.modules.call,
    (moduleId: string, capability: string, args: unknown[]) =>
      moduleHost.dispatch(moduleId, capability, Array.isArray(args) ? args : []),
    (err) => {
      // Re-throw so the renderer's invoke() rejects with the real message,
      // which the module panel renders in its error state.
      throw err instanceof Error ? err : new Error(String(err));
    }
  );
  safeHandle(
    IPC.modules.storageGet,
    (moduleId: string, key: string) => moduleHost.storageGet(moduleId, key),
    () => undefined
  );
  safeHandle(
    IPC.modules.storageSet,
    (moduleId: string, key: string, value: unknown) => {
      moduleHost.storageSet(moduleId, key, value);
    },
    () => undefined
  );
  // Inbox push on a module's behalf. `inboxStore.append` validates projectId +
  // (docs|comments) and throws on a malformed push; re-throw so the module
  // panel's call() rejects with the real message. `moduleId` is currently
  // unused server-side but is threaded for future per-extension attribution.
  safeHandle(
    IPC.modules.pushInbox,
    async (
      _moduleId: string,
      msg: { projectId: string; comments?: string; docs?: Array<{ path: string }> }
    ) => {
      const entry = await inboxStore.append({
        projectId: msg.projectId,
        comments: msg.comments,
        docs: msg.docs
      });
      return { id: entry.id };
    },
    (err) => {
      throw err instanceof Error ? err : new Error(String(err));
    }
  );
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
                // Display the hint only — the renderer's capture-phase keydown
                // handler (shortcuts.ts) owns this chord. Without this, the
                // native accelerator AND the JS handler both fire on one press.
                registerAccelerator: false,
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
          // Hint only; shortcuts.ts owns the keystroke (see Settings… above).
          registerAccelerator: false,
          click: () => win?.webContents.send('app:newClaudeTab')
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          registerAccelerator: false,
          click: () => win?.webContents.send('app:reopenTab')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          registerAccelerator: false,
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
          registerAccelerator: false,
          click: () => win?.webContents.send('app:toggleWorkspaceMode')
        },
        {
          label: 'Toggle Inbox',
          accelerator: 'CmdOrCtrl+I',
          registerAccelerator: false,
          click: () => win?.webContents.send('app:toggleInbox')
        },
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+P',
          registerAccelerator: false,
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
          registerAccelerator: false,
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
  // Repair PATH before any pty/opener/scheduler spawn. A GUI launch
  // (Finder/Dock) inherits a minimal PATH that omits ~/.local/bin,
  // /opt/homebrew/bin, etc. — so a bare `claude` spawn would ENOENT and
  // the tab would open already-exited. Must run before the first spawn.
  ensureProcessPath();
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
  scheduler.setDeps({ ptys, store, inbox: inboxStore, logger: logMainError });
  scheduler.loadAll(store.listProjects());
  // Watch schedule dirs so a skill- or hand-authored schedule file goes live
  // without restart. Self-writes (run-history churn) are suppressed internally.
  scheduler.startWatching();
  // macOS menu-bar presence for the scheduler: live schedule list, a
  // running-count badge, and show/quit controls. Reads the same scheduler +
  // pty state the window does. Non-fatal if it fails to start.
  try {
    tray = new TrayController({
      scheduler,
      ptys,
      projectName: (id) => store.listProjects().find((p) => p.id === id)?.name ?? 'project',
      iconPath,
      showWindow: showMainWindow,
      focusSession: (sessionId, projectId) => {
        showMainWindow();
        safeSend('app:focusSession', sessionId, projectId);
      },
      openScheduler: (taskId) => safeSend('app:openScheduler', taskId),
      logger: logMainError
    });
    tray.start();
  } catch (err) {
    logMainError('tray.start', err);
  }
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
  libraryStore.start?.();
  skillBundles.start();
  scheduleGroups.start();
  startSkillsWatchers();
  // Deploy the bundled `cc-center` skill into ~/.claude/skills so it shows up
  // in the skill catalogue and teaches agents how to author schedules/templates
  // in .cc-center. Idempotent + best-effort — never blocks boot.
  installCcCenterSkill(logMainError).catch((err) =>
    logMainError('installCcCenterSkill', err)
  );
  // Deploy the bundled `saved-reports` skill so agents can find & reuse the
  // reports the user saved from the inbox (read-only JSON under ~/.cc-center/saved).
  installSavedReportsSkill(logMainError).catch((err) =>
    logMainError('installSavedReportsSkill', err)
  );
  // Boot app modules (plugins/*). Each module's setup() runs once; failures
  // are isolated per-module so a broken module never blocks app start.
  moduleHost.setupAll(MAIN_MODULES).catch((err) => logMainError('moduleHost.setupAll', err));
  // Boot the local MCP server, then plumb its URL into PtyManager so any
  // claude-family terminal spawns get `CC_MCP_URL` injected. Errors here
  // are logged but non-fatal — the app still works without inbox push.
  startMcpServer({
    inboxStore,
    projects: {
      get: (id: string) => store.listProjects().find((p) => p.id === id) ?? null
    },
    // A scheduled session's Stop hook pinged back — the agent finished its
    // turn. The scheduler stamps the run as finished (so the UI stops showing
    // "running"), and, for auto-close tasks, closes the pty as an *expected*
    // close so the run logs success rather than a kill-signal error. Non-
    // scheduled sessions (or any we can't match) fall back to a plain expected
    // close so nothing regresses.
    onStopHook: (_projectId: string, sessionId: string) => {
      scheduler.onAgentFinished(sessionId);
      // A finished turn is no longer waiting on the user — drop any blocked
      // overlay so the dot doesn't stick red after the agent moves on.
      agentStatus.clearBlocked(sessionId);
    },
    // Notification/UserPromptSubmit callback → live "blocked — needs you"
    // status. The agent is waiting on the user on `blocked`, and resumed (or
    // the user answered) on `unblocked`.
    onNotifyHook: (_projectId: string, sessionId: string, action) => {
      if (action === 'blocked') agentStatus.markBlocked(sessionId);
      else agentStatus.clearBlocked(sessionId);
      // Diagnostic: confirms the hook reached the main process. The emit to the
      // renderer is debounced (~250ms), so the red/grey dot is the real proof
      // the state landed — this line just proves the curl callback arrived.
      console.log(`[notify-hook] session=${sessionId.slice(0, 8)} action=${action}`);
    },
    // A scheduled agent filed a run report via schedule_report. Attach it to
    // the matching run by sessionId (projectId is implied by the session).
    onReport: (_projectId: string, sessionId: string, summary: string, status) => {
      scheduler.attachReport(sessionId, summary, status);
    },
    // Lets inbox_push stamp `scheduled` so the sidebar groups background-run
    // entries instead of flooding the per-project list with them.
    isSessionScheduled: (sessionId: string) => ptys.getSession(sessionId)?.scheduled ?? false
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
  // On macOS the app stays alive after the last window closes (standard
  // behavior), so we must NOT kill the ptys here — background sessions are
  // meant to keep running. Teardown happens in `before-quit`. On other
  // platforms closing the last window quits, which routes through
  // before-quit and its confirmation below.
  if (process.platform !== 'darwin') app.quit();
});

// Set once the user has confirmed (or there was nothing to confirm) so the
// teardown path runs exactly once and re-entrant before-quit events don't
// re-prompt.
let quitConfirmed = false;

app.on('before-quit', (event) => {
  // Guard the user's running work: if any ptys are still alive, make quitting
  // a deliberate choice instead of silently killing in-flight agents and
  // background sessions (the previous behavior). Sessions aren't persisted, so
  // quitting really does end them.
  if (!quitConfirmed) {
    const live = ptys.liveCount();
    if (live > 0) {
      const opts = {
        type: 'warning' as const,
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Quit and end ${live} running session${live > 1 ? 's' : ''}?`,
        detail:
          'Terminals (including background ones) are not saved between launches. Quitting will terminate them.'
      };
      const choice = win
        ? dialog.showMessageBoxSync(win, opts)
        : dialog.showMessageBoxSync(opts);
      if (choice === 1) {
        event.preventDefault();
        return;
      }
    }
    quitConfirmed = true;
  }
  scheduler.stopWatching();
  scheduler.stopAll();
  tray?.stop();
  tray = null;
  templates.stop();
  libraryStore.stop?.();
  skillBundles.stop();
  scheduleGroups.stop();
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
