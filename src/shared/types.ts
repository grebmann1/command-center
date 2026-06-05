export type LaunchProfileId = 'shell' | 'claude' | 'claude-resume' | 'claude-yolo';

export interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  sortIndex?: number;
  /**
   * Stable, regex-validated handle for the project (URL-safe slug).
   * Pattern: ^[a-z0-9][a-z0-9_-]{0,32}$ (matches OpenAlice's workspace tag).
   * Backfilled from `name` on first touch when absent.
   */
  tag?: string;
  /**
   * Ordered list of `LaunchProfileId` values. The first entry is used as
   * the default for one-click "+" terminal creation.
   */
  defaultAgents?: string[];
  /** Reserved for future templates work; no logic yet. */
  template?: string;
  /** Reserved for future lineage / upgrade-hint work; no logic yet. */
  spawnedFromVersion?: string;
  /**
   * If present, this Project's terminals are opened as SSH sessions to the
   * named host instead of local processes. Absent = local Project.
   */
  remote?: ProjectRemote;
}

export interface ProjectRemote {
  /** Host alias as it appears in ~/.ssh/config (e.g. "my-devbox"). */
  host: string;
  /** Optional override; otherwise ssh resolves it from ~/.ssh/config. */
  user?: string;
  /** Optional override path to start in. Otherwise the remote $HOME. */
  remotePath?: string;
}

export interface SshHostEntry {
  /** Host alias as it appears in ~/.ssh/config. */
  alias: string;
  /** Explicit HostName line, if present. */
  hostname?: string;
  /** Explicit User line, if present. */
  user?: string;
}

/** Pointer to a project file. Rendered live at view time, never snapshotted. */
export interface InboxDoc {
  /** Path relative to the project root. */
  path: string;
}

export interface InboxEntry {
  id: string;
  ts: number;
  projectId: string;
  /** Display snapshot of the project label. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /** Project files to render. Each entry is a pointer — content is fetched live at view time. */
  docs?: InboxDoc[];
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  title: string;
  profile: LaunchProfileId;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
  extraArgs?: string[];
  pinned?: boolean;
}

export interface AppConfig {
  version: 1;
  theme: 'dark' | 'light';
  shell: string;
  claudeBinary: string;
  fontSize: number;
  lastProjectId: string | null;
  workspaceModes?: Record<string, 'terminals' | 'explorer'>;
  listPaneWidth?: number;
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  /** Global default model passed to claude CLI (absent = let claude decide). */
  defaultModel?: 'opus' | 'sonnet' | 'haiku' | 'default';
  /** Global default permission mode for new claude sessions. */
  defaultPermissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** Show inbox guidance hints in the UI (default true). */
  inboxGuidanceEnabled?: boolean;
}

/** Which `.claude/settings*.json` file we're reading or writing. */
export type ClaudeSettingsScope = 'shared' | 'local';

/**
 * Curated subset of `.claude/settings.json` we surface in the UI. Anything
 * else round-trips through `_unknown` / `_unknownPermissions` so atomic
 * edits don't clobber user-edited keys (env, hooks, outputStyle, etc.).
 */
export interface ClaudeProjectSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
    additionalDirectories?: string[];
  };
  model?: string;
  /** Top-level keys we don't surface in the UI; preserved on write. */
  _unknown?: Record<string, unknown>;
  /** Keys under `permissions` we don't surface in the UI; preserved on write. */
  _unknownPermissions?: Record<string, unknown>;
}

export interface ClaudeSettingsResult {
  /** True if the file existed at read time. */
  exists: boolean;
  /** Absolute path of the file (whether or not it existed). */
  path: string;
  settings: ClaudeProjectSettings;
}

/** Per-project overrides passed to the claude CLI when launching a session. */
export interface ProjectSettings {
  /** Text appended to the system prompt (--append-system-prompt). */
  appendSystemPrompt?: string;
  /** Extra CLI arguments appended verbatim. */
  extraArgs?: string[];
  /** Additional directories to add to the context (--add-dir). */
  addDirs?: string[];
  /** Allowed tools (--allowedTools). */
  allowedTools?: string[];
  /** Denied tools (--deniedTools). */
  deniedTools?: string[];
  /** Model override for this project (--model). */
  model?: string;
  /** Permission mode override for this project. */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** MRU list of URLs visited in the preview pane (most recent first). */
  previewUrls?: string[];
}

export interface CreateTerminalRequest {
  projectId: string;
  profile: LaunchProfileId;
  cols: number;
  rows: number;
  extraArgs?: string[];
  title?: string;
  cwd?: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
  path: string;
}

export interface FsReadResult {
  ok: boolean;
  content?: string;
  bytes?: number;
  binary?: boolean;
  truncated?: boolean;
  message?: string;
}

export interface FsWriteResult {
  ok: boolean;
  bytes?: number;
  message?: string;
}

export interface WalkedFile {
  rel: string;
  path: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface SearchHit {
  rel: string;
  path: string;
  line: number;
  column: number;
  match: string;
  preview: string;
}

export interface SearchResult {
  hits: SearchHit[];
  scanned: number;
  truncated: boolean;
}

export type OpenTarget = 'cursor' | 'code' | 'finder' | 'terminal';

export interface OpenResult {
  ok: boolean;
  message?: string;
}

// Per-file git status code, matching VSCode's surface:
//   M = modified (staged or unstaged)
//   A = added (staged new file)
//   D = deleted
//   R = renamed
//   ? = untracked
//   ! = ignored (we don't surface these by default)
//   C = conflict (unmerged)
export type GitFileCode = 'M' | 'A' | 'D' | 'R' | '?' | 'C';

export interface GitStatus {
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  dirty: boolean;
  // Repo absolute path (toplevel) + per-file map keyed by absolute path. The
  // tree decoration consumer can look up `files[entry.path]` directly.
  toplevel?: string;
  files?: Record<string, GitFileCode>;
}

export interface ClaudeSessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
  firstUserPrompt: string | null;
}

export interface GitDiscardResult {
  ok: boolean;
  message?: string;
}

export interface GitShowResult {
  ok: boolean;
  /** UTF-8 contents of the file at HEAD; absent for binary or missing. */
  content?: string;
  /** True when HEAD has no entry for this path (e.g. newly added file). */
  notInHead?: boolean;
  /** True when HEAD blob looks binary; we can't render a text diff. */
  binary?: boolean;
  message?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

/** Per-fire record persisted in a schedule's status.runs ring buffer. */
export interface ScheduleRun {
  /** ISO-8601 timestamp of when the fire began. */
  at: string;
  result: 'success' | 'error' | 'skipped';
  /** PtyManager session id, if a terminal was actually spawned. */
  sessionId?: string;
  /** Time from spawn to pty exit (only set once the session ends). */
  durationMs?: number;
  /** Free-text reason — populated for `error` and `skipped`. */
  message?: string;
}

export interface ScheduleStatus {
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped';
  lastRunSessionId?: string;
  /** ISO-8601 timestamp of the next planned fire (informational; recomputed on load). */
  nextRunAt?: string;
  runCount: number;
  /** Newest first. Capped at history.retain (default 10). */
  runs: ScheduleRun[];
}

/**
 * One scheduled task. Persisted as JSON at:
 *  - `~/.cc-center/schedules/<id>.json` (global), or
 *  - `<project.path>/.cc-center/schedules/<id>.json` (per-project, optional).
 *
 * Hand-editable. The scheduler runs entirely in the Electron main process via
 * setTimeout — no daemon, no cron. When the app exits, fires stop; on next
 * launch, schedules are re-loaded from disk and the next fire is computed
 * from `every` against `status.lastRunAt`.
 */
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Project to spawn the terminal in (FK into projects.json). */
  projectId: string;
  profile: LaunchProfileId;
  extraArgs?: string[];
  /** Optional initial prompt — typed into the pty on first data event. */
  prompt?: string;
  schedule: {
    /** Human-friendly interval. Examples: "5m", "1h", "24h", "300000ms". Min 60s. */
    every: string;
  };
  /** Only 'skip' is honored in v1; the field is reserved for future modes. */
  overlap: 'skip';
  history: {
    retain: number;
  };
  status: ScheduleStatus;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Set by the loader for UI display; not persisted. */
  source?: 'global' | { projectId: string };
}

export interface ScheduleCreateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  projectId: string;
  profile: LaunchProfileId;
  extraArgs?: string[];
  prompt?: string;
  every: string;
  /** When omitted, the schedule is written to the global directory. */
  scope?: 'global' | { projectId: string };
  retain?: number;
}

/**
 * Reusable preset that pre-fills the New Schedule form. Templates are *seeds*,
 * not running schedules — once a user enables one, it becomes a normal
 * `ScheduledTask` in the schedules store. Discovered from three places:
 *  - built-in catalogue shipped with the app
 *  - `~/.cc-center/templates/<id>.json` (user-dropped, hand-editable)
 *  - `<project.path>/.cc-center/templates/<id>.json` (project-shipped)
 */
export interface ScheduleTemplate {
  id: string;
  name: string;
  description?: string;
  /** Free-form grouping in the picker UI ("QA", "Maintenance", "Reports"). */
  category?: string;
  /** Lucide icon name. Renderer falls back to a generic icon if missing or unknown. */
  icon?: string;
  defaults: {
    profile: LaunchProfileId;
    every: string;
    prompt?: string;
    extraArgs?: string[];
    /** Used as the default schedule name; user can override before enabling. */
    name?: string;
    description?: string;
  };
  /** Set by the loader for UI display; never read from disk. */
  source?: 'builtin' | 'user' | { projectId: string; projectName?: string };
}

export interface ScheduleUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  projectId?: string;
  profile?: LaunchProfileId;
  extraArgs?: string[];
  prompt?: string;
  every?: string;
  retain?: number;
}

export type SkillSource = 'user' | 'plugin' | 'project';

export interface SkillEntry {
  /** Stable handle: `${source}:${qualifiedName}`, e.g. `plugin:zana/team-status`. */
  id: string;
  /** Short display name (last path segment of the skill directory). */
  name: string;
  source: SkillSource;
  /** Plugin slug (only when source === 'plugin'). */
  pluginName?: string;
  /** Project id (only when source === 'project'). */
  projectId?: string;
  path: string;
  description?: string;
  allowedTools?: string[];
  enabled: boolean;
}

export interface SkillBundle {
  id: string;
  name: string;
  description?: string;
  /** SkillEntry.id values. */
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillBundleInput {
  name: string;
  description?: string;
  skillIds: string[];
}

export type SkillBundleApplyMode = 'additive' | 'exclusive';

export interface McpServer {
  name: string;
  scope: 'user' | 'project' | 'session';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface CcApi {
  projectSettings: {
    get(id: string): Promise<ProjectSettings>;
    set(id: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings>;
  };
  projects: {
    list(): Promise<Project[]>;
    add(path: string): Promise<Result<Project>>;
    remove(id: string): Promise<void>;
    update(id: string, patch: { name?: string; color?: string }): Promise<Project | null>;
    touch(id: string): Promise<Project | null>;
    reorder(orderedIds: string[]): Promise<Project[]>;
    pickDirectory(): Promise<string | null>;
    addRemote(input: {
      host: string;
      user?: string;
      remotePath?: string;
      name?: string;
    }): Promise<Result<Project>>;
  };
  ssh: {
    listHosts(): Promise<SshHostEntry[]>;
  };
  terminals: {
    list(projectId: string): Promise<TerminalSession[]>;
    create(req: CreateTerminalRequest): Promise<Result<TerminalSession>>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
    onData(cb: (sessionId: string, data: string) => void): () => void;
    onExit(cb: (sessionId: string, code: number) => void): () => void;
    onTitle(cb: (sessionId: string, title: string) => void): () => void;
  };
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
  };
  claude: {
    listSessions(projectPath: string): Promise<ClaudeSessionSummary[]>;
  };
  fs: {
    listDir(path: string): Promise<FsEntry[]>;
    readFile(path: string): Promise<FsReadResult>;
    writeFile(path: string, content: string): Promise<FsWriteResult>;
    walkFiles(path: string): Promise<WalkedFile[]>;
    searchFiles(path: string, query: string, opts?: SearchOptions): Promise<SearchResult>;
  };
  openers: {
    openIn(target: OpenTarget, path: string): Promise<OpenResult>;
  };
  git: {
    status(path: string): Promise<GitStatus | null>;
    showHead(path: string): Promise<GitShowResult>;
    discard(path: string): Promise<GitDiscardResult>;
  };
  files: {
    pathForFile(file: File): string;
  };
  app: {
    onMenuEvent(cb: (event: string) => void): () => void;
    homedir(): Promise<string>;
  };
  skills: {
    list(projectPath?: string): Promise<SkillEntry[]>;
    setEnabled(name: string, enabled: boolean): Promise<void>;
    setManyEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void>;
    readHooks(): Promise<unknown>;
    reveal(skillId: string, projectPath?: string): Promise<{ ok: boolean; path: string; message?: string }>;
    onChanged(cb: () => void): () => void;
    bundles: {
      list(): Promise<SkillBundle[]>;
      create(input: SkillBundleInput): Promise<SkillBundle>;
      update(id: string, patch: Partial<SkillBundleInput>): Promise<SkillBundle | null>;
      delete(id: string): Promise<boolean>;
      apply(
        id: string,
        mode: SkillBundleApplyMode,
        projectPath?: string
      ): Promise<{ ok: boolean; message?: string }>;
      onChanged(cb: (bundles: SkillBundle[]) => void): () => void;
    };
  };
  inbox: {
    history(opts?: {
      limit?: number;
      before?: string;
      projectId?: string;
    }): Promise<{ entries: InboxEntry[]; hasMore: boolean }>;
    delete(id: string): Promise<boolean>;
    onAppended(cb: (entry: InboxEntry) => void): () => void;
    onRemoved(cb: (id: string) => void): () => void;
  };
  mcp: {
    list(projectPath: string): Promise<McpServer[]>;
    setEnabled(projectPath: string, name: string, enabled: boolean): Promise<void>;
  };
  claudeSettings: {
    read(projectPath: string, scope: ClaudeSettingsScope): Promise<ClaudeSettingsResult>;
    write(
      projectPath: string,
      scope: ClaudeSettingsScope,
      patch: ClaudeProjectSettings
    ): Promise<ClaudeSettingsResult>;
  };
  scheduler: {
    list(): Promise<ScheduledTask[]>;
    create(input: ScheduleCreateInput): Promise<Result<ScheduledTask>>;
    update(id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>>;
    delete(id: string): Promise<Result<true>>;
    setEnabled(id: string, enabled: boolean): Promise<Result<ScheduledTask>>;
    runNow(id: string): Promise<Result<ScheduledTask>>;
    onChanged(cb: (tasks: ScheduledTask[]) => void): () => void;
    listTemplates(): Promise<ScheduleTemplate[]>;
    onTemplatesChanged(cb: (templates: ScheduleTemplate[]) => void): () => void;
    revealTemplatesDir(): Promise<{ ok: boolean; path: string; message?: string }>;
  };
}

declare global {
  interface Window {
    cc: CcApi;
  }
}
