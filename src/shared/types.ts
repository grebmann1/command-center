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

/** Result of a `sfwork list`-backed host refresh. */
export interface SshSyncResult {
  /** Hosts parsed from ~/.ssh/config after the sync attempt. */
  hosts: SshHostEntry[];
  /** Non-fatal warning when `sfwork list` couldn't refresh the config
   *  (CLI missing, not logged in, timeout). The hosts are still whatever was
   *  on disk, so the picker stays usable. */
  warning?: string;
}

/** Pointer to a project file. Rendered live at view time, never snapshotted. */
export interface InboxDoc {
  /** Path relative to the project root. */
  path: string;
}

/**
 * How loudly a schedule's inbox entries should surface.
 *  - `silent` — runs are not recorded in the inbox at all.
 *  - `quiet`  — recorded, but collapsed into the per-project "Scheduled"
 *               group and excluded from the unread badge (the default — keeps
 *               recurring jobs from nagging).
 *  - `loud`   — surfaced as a normal entry and counted in the unread badge.
 */
export type InboxNotifyLevel = 'silent' | 'quiet' | 'loud';

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
  /**
   * Originating terminal session, when the creation path knows it. Set by
   * the scheduler when a notify-on-exit run completes. Absent for legacy
   * entries on disk and for paths that don't track session identity —
   * readers must treat undefined as "no preferred tab; fall back to the
   * project's last active tab."
   */
  sessionId?: string;
  /**
   * True when the originating session was a scheduled (background) run.
   * Stamped at write time — the originating session is often dead by the
   * time the renderer reads the entry, so this can't be inferred client-side.
   * The sidebar collapses scheduled entries into a single group so recurring
   * jobs don't flood the per-project list.
   */
  scheduled?: boolean;
  /**
   * Loudness of a scheduled entry, copied from the owning schedule at write
   * time (`silent` entries are never written, so only `quiet`/`loud` appear on
   * disk). Absent on non-scheduled (manual / agent-on-a-real-tab) entries,
   * which are always treated as loud. The renderer reads this to decide badge
   * counting and whether the entry shows inline or in the collapsed group —
   * it can't be re-derived client-side once the originating session is gone,
   * same rationale as {@link scheduled}.
   */
  notify?: InboxNotifyLevel;
}

/** A frozen snapshot of an inbox doc, captured at save time. */
export interface SavedDoc {
  /** Original path relative to the project root (for reference/search). */
  path: string;
  /** File content at save time. Absent if it couldn't be read. */
  content?: string;
  /** True if content was truncated by the fs read cap (mirrors FsReadResult). */
  truncated?: boolean;
  /** True if the file was binary and not snapshotted. */
  binary?: boolean;
  /** Set when the snapshot read failed (project tombstoned, missing file). */
  error?: string;
}

/**
 * A saved inbox report — a durable, frozen copy of an inbox entry's docs +
 * comments, kept for later reuse. Persisted GLOBAL-only, one JSON file per
 * record at `~/.cc-center/saved/<id>.json`. Doc contents are SNAPSHOTTED at
 * save time (unlike live inbox docs) so the record survives project file
 * changes / moves / deletion. The bundled `saved-reports` skill reads these
 * files directly. Each record carries `projectId` so it can be filtered.
 */
export interface SavedRecord {
  id: string;
  savedAt: number;
  /** Originating inbox entry id, when known. */
  sourceEntryId?: string;
  projectId: string;
  /** Display snapshot of the project label; readers fall back to projectId. */
  projectLabel?: string;
  /** Short title derived from the first comment line or first doc path. */
  title: string;
  comments?: string;
  docs?: SavedDoc[];
  tags?: string[];
}

/** Library document types. */
export type LibraryDocKind = 'md' | 'pdf' | 'image' | 'code' | 'other';
export type LibraryScope = 'project' | 'global';

export interface LibraryDoc {
  id: string;
  relPath: string;            // posix, relative to its library dir
  title: string;
  summary?: string;
  tags?: string[];
  kind: LibraryDocKind;       // derived from ext
  createdAt: number;
  updatedAt: number;
  bytes?: number;
  source?: {
    kind: 'agent' | 'user' | 'schedule' | 'inbox';
    sessionId?: string;
    scheduleId?: string;
    projectId?: string;
  };
  // stamped at list() time, not persisted:
  scope?: LibraryScope;
  absPath?: string;
  projectId?: string;         // owning project (for 'project' scope)
  projectName?: string;
}

export interface LibraryManifest {
  version: 1;
  docs: LibraryDoc[];
}

export interface LibraryAddInput {
  scope: LibraryScope;
  projectId?: string;         // required when scope==='project'
  relPath: string;
  title: string;
  content?: string;           // text write; omit if file already on disk
  tags?: string[];
  summary?: string;
  source?: LibraryDoc['source'];
}

/** Input to SavedStore.save — the record minus the store-assigned id/savedAt. */
export interface SavedRecordInput {
  sourceEntryId?: string;
  projectId: string;
  projectLabel?: string;
  title: string;
  comments?: string;
  docs?: SavedDoc[];
  tags?: string[];
}

/**
 * Live agent state for a session, inferred from detection signals (OSC title
 * spinner, screen-scan, lifecycle hooks). Deliberately separate from
 * {@link TerminalSession.status}, which tracks the pty *process* lifecycle
 * (starting/running/exited) — `AgentState` tracks what the *agent inside* the
 * pty is doing. The two are orthogonal: a `running` pty can be `idle`, and a
 * just-`exited` pty has no agent state at all.
 *
 *  - `working` — agent is actively producing output / running a tool.
 *  - `blocked` — agent is waiting on the user (permission prompt, question).
 *  - `done`    — agent finished its turn but the user hasn't looked yet.
 *  - `idle`    — at the prompt, nothing pending, and the user has seen it.
 *  - `unknown` — plain shell, or no detector has a confident read yet.
 *
 * See `docs/live-agent-status-plan.md`. State lives in a dedicated main-side
 * store and streams over the `onAgentStatus` IPC channel — NOT on this object
 * — so status ticks don't rebuild the `terminals` map (render-storm guard).
 */
export type AgentState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';

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
  /**
   * Set once the user manually renames the tab. Suppresses the OSC-title
   * auto-rename (Claude's generated task summary) so an explicit name is never
   * overwritten. Renderer-only — titles are renderer-authoritative after the
   * session is created.
   */
  titleLocked?: boolean;
  /**
   * Headless sessions are hidden from the tab strip but their pty keeps
   * running. The user produces them by clicking the tab's X — we intentionally
   * don't kill the pty so background work survives. Restore via the new-tab
   * popover's "Hidden" section.
   */
  headless?: boolean;
  /**
   * Spawned by the scheduler — a background job, not a tab the user opened.
   * Persisted on the session so the renderer can treat it as background work
   * even after it's been promoted to a visible tab (e.g. opened from the
   * inbox): when its process exits, its tab is auto-removed rather than left
   * as a tombstone. User-opened tabs keep their exited tombstone.
   */
  scheduled?: boolean;
  /**
   * For scheduled sessions, the owning schedule's inbox loudness, baked in at
   * spawn so an `inbox_push` from the agent can be stamped with the right
   * {@link InboxNotifyLevel} (and dropped entirely when `silent`) — even after
   * the schedule itself has been edited or deleted mid-run. Absent on
   * user-opened tabs. Not surfaced in the UI.
   */
  inboxLevel?: InboxNotifyLevel;
}

export interface AppConfig {
  version: 1;
  theme: 'dark' | 'light';
  shell: string;
  claudeBinary: string;
  fontSize: number;
  lastProjectId: string | null;
  /**
   * Non-null ⇒ the project list column is drilled into that project's focused
   * session view. Persisted so focus survives relaunch, like lastProjectId.
   */
  focusedProjectId?: string | null;
  workspaceModes?: Record<string, 'terminals' | 'explorer' | 'library'>;
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
  /**
   * Optional opening prompt for claude-family profiles — appended as the
   * positional `[prompt]` argv element so the spawned interactive session runs
   * it on first turn (e.g. a slash command like `/eq-craft`). Ignored for the
   * `shell` profile, where it would be parsed as a shell command.
   */
  prompt?: string;
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

export interface FsReadDataUrlResult {
  ok: boolean;
  dataUrl?: string;
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

export type OpenTarget = 'cursor' | 'code' | 'finder' | 'terminal' | 'browser';

export interface OpenResult {
  ok: boolean;
  message?: string;
}

/**
 * Payload for `inbox.exportPdf`. The renderer serializes the already-rendered
 * inbox detail into a self-contained HTML document (inlined CSS, mermaid SVGs,
 * highlighted code) and passes it here for the main process to print to PDF.
 */
export interface InboxPdfExport {
  /** Full standalone HTML document to render and print. */
  html: string;
  /** Suggested filename (without extension) for the save dialog. */
  suggestedName: string;
}

export interface InboxPdfExportResult {
  ok: boolean;
  /** Absolute path the PDF was written to, when ok. */
  path?: string;
  /** Absent on user-cancel; set when something actually failed. */
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
  /** Stable per-run id (uuid). Older records may not have it; renderer
   *  falls back to `at + sessionId` for keys. */
  id?: string;
  /** ISO-8601 timestamp of when the fire began. */
  at: string;
  result: 'success' | 'error' | 'skipped';
  /** PtyManager session id, if a terminal was actually spawned. */
  sessionId?: string;
  /** Time from spawn to pty exit (only set once the session ends). */
  durationMs?: number;
  /**
   * ISO-8601 time the agent's turn ended (Stop hook), independent of pty exit.
   * Set for interactive scheduled runs that finish their turn but stay open at
   * the prompt — lets the UI show "done · session open" rather than "running"
   * forever. Absent until the agent stops (claude profiles).
   */
  finishedAt?: string;
  /** Free-text reason — populated for `error` and `skipped`. */
  message?: string;
  /**
   * Agent-authored markdown summary of what this run did. Set via the
   * `schedule_report` MCP tool, keyed by `sessionId`. This is a human-readable
   * report, NOT pty output. Absent until the agent files one (claude profiles).
   */
  report?: string;
  /** ISO-8601 time the report was attached. */
  reportedAt?: string;
  /** Agent's self-assessment of the run, independent of the pty exit code. */
  reportStatus?: 'success' | 'partial' | 'failure';
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
  /**
   * How loudly this schedule's runs surface in the inbox. Governs BOTH the
   * scheduler's own run-completion summary AND any `inbox_push` the agent makes
   * during a scheduled run:
   *  - `silent` — nothing recorded.
   *  - `quiet` (default) — recorded in the collapsed "Scheduled" group, no badge.
   *  - `loud` — surfaced inline and counted in the unread badge.
   * Replaces the legacy boolean `notifyInbox` (migrated on load: true→loud,
   * false/absent→quiet). See {@link InboxNotifyLevel}.
   */
  inboxLevel?: InboxNotifyLevel;
  /**
   * When true (claude-family profiles only), a Stop hook is injected into the
   * spawned session so the terminal auto-closes once Claude finishes its
   * response. Without it, a scheduled `claude` tab idles open forever — the
   * interactive CLI never exits on its own. Default false.
   */
  autoCloseOnFinish?: boolean;
  /**
   * Group id ({@link ScheduleGroup}) for organising global schedules in the
   * rail (e.g. "Personal" / "Work"). Absent or unresolvable = Ungrouped.
   * Ignored for project-scoped schedules.
   */
  group?: string;
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
  /** Inbox loudness; defaults to `quiet` when omitted. See {@link InboxNotifyLevel}. */
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  /** Group id (see {@link ScheduleGroup}). Only meaningful for global scope. */
  group?: string;
}

/**
 * A user-defined bucket for grouping global (non-project) schedules — e.g.
 * "Personal" vs "Work". Persisted as a single hand-editable file at
 * `~/.cc-center/groups.json`. Groups are an orthogonal axis to scope: a global
 * `ScheduledTask` references one by `group` id; project-scoped schedules ignore
 * grouping (they live under their project). A schedule whose `group` doesn't
 * resolve to a known group is treated as Ungrouped — deleting a group never
 * loses schedules, it just drops them back into the Ungrouped bucket.
 */
export interface ScheduleGroup {
  /** URL-safe slug, unique. Pattern: ^[a-z0-9][a-z0-9_-]{0,32}$. */
  id: string;
  name: string;
  /** Hex color for the dot/pill. */
  color?: string;
  /** Lucide icon name; renderer falls back to a generic icon if unknown. */
  icon?: string;
  /** Ascending display order in the rail. */
  sortIndex?: number;
}

export interface ScheduleGroupInput {
  name: string;
  color?: string;
  icon?: string;
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
  /** Inbox loudness. Omit to leave unchanged. See {@link InboxNotifyLevel}. */
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  /** Group id, or null to clear (move to Ungrouped). Omit to leave unchanged. */
  group?: string | null;
}

export type SkillSource = 'user' | 'plugin' | 'project';

/**
 * A Claude Code *slash command* discovered from `.claude/commands/**\/*.md`.
 * Surfaced in the command palette so the user can launch it straight into a new
 * or existing Claude session. `scope` mirrors Claude's own resolution order.
 */
export interface SlashCommand {
  /** Stable handle: `${scope}:${name}`, e.g. `plugin:zana:status`. */
  id: string;
  /** Command name with `:` namespacing, e.g. `eq`, `git:commit`, `zana:status`. */
  name: string;
  /** The literal a user types / we send to Claude, e.g. `/git:commit`. */
  invocation: string;
  scope: 'user' | 'project' | 'plugin';
  /** Plugin slug (only when scope === 'plugin'). */
  pluginName?: string;
  /** Project id (only when scope === 'project'). */
  projectId?: string;
  /** Absolute path of the backing `.md` file. */
  path: string;
  /** From frontmatter `description`, else the first body line. */
  description?: string;
  /** From frontmatter `argument-hint`, e.g. `<pr-url>` — hints args exist. */
  argumentHint?: string;
}

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

/**
 * Result of applying a bundle. `applied` is the count of user/project skills
 * the apply actually wrote to settings. `skippedPlugin` is the count of plugin
 * skills in the bundle that were ignored — plugin skills are managed via
 * Claude Code's `/plugin` command and can't be toggled from settings.json.
 */
export interface SkillBundleApplyResult {
  ok: boolean;
  applied: number;
  skippedPlugin: number;
  message?: string;
}

/** @deprecated Legacy per-project MCP shape; replaced by McpServerEntry. */
export interface McpServer {
  name: string;
  scope: 'user' | 'project' | 'session';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export type PluginSource = 'user' | 'marketplace';

export interface PluginProvides {
  skills: string[];
  commands: string[];
  mcpServers: string[];
}

export interface PluginEntry {
  /** `<name>@<marketplace>` — matches `enabledPlugins` key in
   *  `~/.claude/settings.json`. */
  id: string;
  name: string;
  source: PluginSource;
  /** Undefined when source === 'user'. */
  marketplace?: string;
  version?: string;
  description?: string;
  /** Root install dir of the plugin. */
  path: string;
  provides: PluginProvides;
  enabled: boolean;
  /** False if .claude-plugin/plugin.json is missing or malformed. */
  manifestValid: boolean;
}

/**
 * One discovered runtime extension under `~/.cc-center/extensions/<id>/`, as
 * surfaced to the renderer by `cc.extensions.list()`. Mirrors the SDK's
 * `ExtensionManifest` shape inline so this IPC-contract file stays dependency-
 * free (no `@cctc/extension-sdk` import in the shared types surface).
 */
export interface ExtensionEntry {
  /** Stable, URL-safe id — the `<id>` directory name and storage namespace. */
  id: string;
  /** Absolute root dir of the extension (`~/.cc-center/extensions/<id>`). */
  path: string;
  /**
   * The parsed `extension.json` manifest, or null when missing/malformed.
   * Null implies the extension was skipped (see `error`).
   */
  manifest: ExtensionManifestView | null;
  /** Enabled-map state; defaults to true unless explicitly disabled. */
  enabled: boolean;
  /**
   * True when the extension passed validation + version gate AND (if it
   * declares a main entry) its main module imported + registered cleanly.
   */
  loaded: boolean;
  /**
   * Whether the extension's MAIN side (its capabilities, reached via
   * `host.call`) is currently live in this process.
   *
   * - A renderer-only extension (no `entry.main`) is always `true` — there's
   *   nothing to activate, so its panel works the moment it's enabled.
   * - A main-bearing extension is `true` only when its `MainModule` was
   *   `import()`-ed into the host at THIS boot. Main modules are
   *   **relaunch-required to (re)activate**: enabling one that wasn't loaded at
   *   boot leaves `mainActive:false` until the next relaunch, so the renderer
   *   can surface a relaunch hint rather than mount a panel whose `host.call()`
   *   would reject with "Unknown module". Disable tears the main side down live
   *   (also `false`).
   */
  mainActive: boolean;
  /**
   * Why the extension was skipped or failed to load, if any. One of:
   * `bad-manifest` (missing/unparseable/invalid shape), `version-mismatch`
   * (engines.cctcApi rejects the host), `disabled` (enabled-map says off),
   * `main-load-failed` (the main entry threw on import/setup). Absent on a
   * clean load.
   */
  error?: ExtensionLoadError;
  /**
   * P3-D install-time consent. True when the user has approved this extension's
   * CURRENT declared permissions. A disk extension does NOT run its main / mount
   * its panel until consented — distinct from `enabled` (the user may enable it,
   * but it stays inactive until consent is granted). Built-in modules never need
   * consent and don't appear in the discovered list.
   */
  consented: boolean;
  /**
   * Why this extension needs a consent prompt, or null when fully consented:
   *  - `'new'`     — never approved (first install).
   *  - `'widened'` — an update DECLARED more permissions than the user approved;
   *                  re-prompt showing the new ones. The extension stays inactive
   *                  (effective grant = declared ∩ consented) until re-approved.
   * Null for: a consented ext, OR an entry with no manifest / not a candidate to
   * run (bad-manifest / version-mismatch — nothing to consent to).
   */
  needsConsent: 'new' | 'widened' | null;
}

export type ExtensionLoadError =
  | 'bad-manifest'
  | 'version-mismatch'
  | 'disabled'
  | 'main-load-failed';

/** Renderer-safe projection of the SDK `ExtensionManifest`. */
export interface ExtensionManifestView {
  id: string;
  title: string;
  icon: string;
  titleLabel?: string;
  entry: { renderer?: string; main?: string };
  engines: { cctcApi: string };
  permissions?: string[];
  /**
   * Scoping for the brokered permissions (exec bins / fs roots / egress hosts).
   * Surfaced so the renderer host can apply advisory scope checks and the P3-D
   * consent screen can render what an extension may run/read/reach.
   */
  permissionScopes?: {
    execAllowlist?: string[];
    fsRoots?: string[];
    egressAllowlist?: string[];
  };
}

export type McpSource = 'user' | 'plugin' | 'project';

export type McpTransport = 'stdio' | 'http' | 'unknown';

export interface McpServerEntry {
  /** `${source}[:${pluginName}|:${projectId}]:${name}` — collision-free. */
  id: string;
  name: string;
  source: McpSource;
  pluginName?: string;
  projectId?: string;
  projectPath?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  /** Set when toggle is disabled in UI (plugin-scope rows). */
  enabledLockedBy?: 'plugin';
}

/**
 * Auto-update lifecycle, mirrored from electron-updater's autoUpdater events
 * onto a single renderer-facing union. `disabled` is our own state for the dev
 * build (electron-updater is a no-op when the app isn't packaged).
 */
export type UpdateStatusKind =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  /** Target version for available/downloading/downloaded; absent otherwise. */
  version?: string;
  /** Present when kind === 'error'. */
  message?: string;
}

/** Download progress as emitted by electron-updater's `download-progress`. */
export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
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
    /** Regenerate the sfwork-managed ssh config (`sfwork list`), then re-parse.
     *  Returns hosts plus an optional non-fatal warning if the sync failed. */
    syncHosts(): Promise<SshSyncResult>;
  };
  terminals: {
    list(projectId: string): Promise<TerminalSession[]>;
    create(req: CreateTerminalRequest): Promise<Result<TerminalSession>>;
    write(sessionId: string, data: string): Promise<void>;
    /**
     * Send a line of user input to a live session, as if typed at the prompt
     * (the text plus a trailing carriage return). Used by the inbox reply box
     * to answer a question an agent pushed via inbox_push, without leaving the
     * inbox. Thin intent-named wrapper over `write` so the carriage-return
     * convention lives in one place.
     */
    reply(sessionId: string, text: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
    /**
     * Toggle the headless flag on a live session. Used to "hide" a tab
     * (X button / ⌘W) without killing its pty, and to restore one from
     * the Hidden picker.
     */
    setHeadless(sessionId: string, headless: boolean): Promise<TerminalSession | null>;
    onData(cb: (sessionId: string, data: string) => void): () => void;
    onExit(cb: (sessionId: string, code: number) => void): () => void;
    onTitle(cb: (sessionId: string, title: string) => void): () => void;
    /** Fired when any session metadata changes (e.g. title/headless/exit). */
    onUpdated(cb: (session: TerminalSession) => void): () => void;
    /**
     * Live agent-state pushes (working/blocked/done/idle). Dedicated channel,
     * deliberately not folded into {@link onUpdated}: it fires far more often
     * and must land in a separate store slice so it can't rebuild the session
     * list on every tick. See `docs/live-agent-status-plan.md`.
     */
    onAgentStatus(cb: (sessionId: string, state: AgentState) => void): () => void;
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
    readDataUrl(path: string): Promise<FsReadDataUrlResult>;
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
    /** The running app version (package.json `version`), for the About section. */
    version(): Promise<string>;
    /** Fired when an OS notification click asks the UI to focus a session. */
    onFocusSession(cb: (sessionId: string, projectId: string) => void): () => void;
    /**
     * Fired when the menu-bar tray asks the UI to open the Scheduler. A task id
     * means "reveal this schedule in its scope"; absent means the overview.
     */
    onOpenScheduler(cb: (taskId?: string) => void): () => void;
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
      ): Promise<SkillBundleApplyResult>;
      onChanged(cb: (bundles: SkillBundle[]) => void): () => void;
    };
  };
  commands: {
    /** Discover Claude Code slash commands (user + enabled-plugin + project). */
    list(projectPath?: string): Promise<SlashCommand[]>;
  };
  inbox: {
    history(opts?: {
      limit?: number;
      before?: string;
      projectId?: string;
    }): Promise<{ entries: InboxEntry[]; hasMore: boolean }>;
    delete(id: string): Promise<boolean>;
    /**
     * Bulk-delete entries by explicit id list (the entries to REMOVE). Used by
     * "Clear inbox", which passes every non-kept id. Resolves the count removed.
     */
    deleteMany(ids: string[]): Promise<number>;
    /**
     * Render a standalone HTML document (the inbox detail, already rendered
     * in the renderer — mermaid SVGs and highlighted code included) to a PDF
     * via a hidden BrowserWindow, prompting the user for a save location.
     * Resolves the result of the save (cancelled is `{ ok: false }`).
     */
    exportPdf(input: InboxPdfExport): Promise<InboxPdfExportResult>;
    onAppended(cb: (entry: InboxEntry) => void): () => void;
    onRemoved(cb: (id: string) => void): () => void;
  };
  saved: {
    /** Persist a saved report. Resolves null on failure (caller toasts). */
    save(input: SavedRecordInput): Promise<SavedRecord | null>;
    list(): Promise<SavedRecord[]>;
    delete(id: string): Promise<boolean>;
    onChanged(cb: (records: SavedRecord[]) => void): () => void;
  };
  library: {
    list(): Promise<LibraryDoc[]>;
    add(input: LibraryAddInput): Promise<LibraryDoc | null>;
    update(id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>): Promise<LibraryDoc | null>;
    remove(id: string): Promise<boolean>;
    reveal(scope: LibraryScope, projectId?: string): Promise<{ ok: boolean; path: string; message?: string }>;
    onChanged(cb: (docs: LibraryDoc[]) => void): () => void;
  };
  mcp: {
    list(projectPath: string): Promise<McpServer[]>;
    setEnabled(projectPath: string, name: string, enabled: boolean): Promise<void>;
    listAll(): Promise<McpServerEntry[]>;
    setEnabledById(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    onChanged(cb: (entries: McpServerEntry[]) => void): () => void;
  };
  plugins: {
    list(): Promise<PluginEntry[]>;
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    onChanged(cb: (entries: PluginEntry[]) => void): () => void;
  };
  /**
   * Runtime extensions discovered under `~/.cc-center/extensions/<id>/`.
   * Mirrors `plugins`. `setEnabled(id, false)` tears down the extension's main
   * module; `readRendererEntry(id)` returns the renderer bundle JS as a string
   * (or null) for the renderer to blob-import.
   */
  extensions: {
    list(): Promise<ExtensionEntry[]>;
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    readRendererEntry(id: string): Promise<string | null>;
    /**
     * P3-D: record the user's consent to the extension's CURRENT declared
     * permissions, then re-discover (spawning/mounting it). After this the
     * entry's `consented` is true / `needsConsent` is null until an update
     * widens the declared set.
     */
    grantConsent(id: string): Promise<Result<true>>;
    onChanged(cb: (entries: ExtensionEntry[]) => void): () => void;
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
    groups: {
      list(): Promise<ScheduleGroup[]>;
      create(input: ScheduleGroupInput): Promise<Result<ScheduleGroup>>;
      update(id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>>;
      /** Removes the group; schedules referencing it fall back to Ungrouped. */
      delete(id: string): Promise<Result<true>>;
      reorder(orderedIds: string[]): Promise<ScheduleGroup[]>;
      onChanged(cb: (groups: ScheduleGroup[]) => void): () => void;
    };
  };
  /**
   * Generic bridge for app modules (plugins/*). `call` invokes a module's
   * main-side capability; `storage*` back the per-module KV store. Backs
   * `ModuleHost` in the renderer — modules never touch this directly.
   */
  modules: {
    call(moduleId: string, capability: string, args: unknown[]): Promise<unknown>;
    storageGet(moduleId: string, key: string): Promise<unknown>;
    storageSet(moduleId: string, key: string, value: unknown): Promise<void>;
    /**
     * Append an entry to the user's inbox on the module's behalf. `moduleId`
     * is threaded for future per-extension attribution/permission checks. The
     * inbox store requires `projectId` and at least one of `comments`/`docs`.
     */
    pushInbox(
      moduleId: string,
      msg: { projectId: string; comments?: string; docs?: Array<{ path: string }> }
    ): Promise<{ id: string }>;
  };
  /**
   * Auto-update (electron-updater). `check` kicks a manual check (auto-download
   * follows). `quitAndInstall` applies a downloaded update by relaunching.
   * `onStatus`/`onProgress` push the autoUpdater event stream; both return an
   * unsubscribe fn (same shape as inbox.onAppended).
   */
  updates: {
    check(): Promise<void>;
    quitAndInstall(): Promise<void>;
    onStatus(cb: (status: UpdateStatus) => void): () => void;
    onProgress(cb: (progress: UpdateProgress) => void): () => void;
  };
}

declare global {
  interface Window {
    cc: CcApi;
  }
}
