/**
 * Shared Claude Unleashed (cu) domain types — used by both the main capability
 * (which fills them from `cu … --json` stdout) and the renderer panel (which
 * renders them). Plain data only; safe to import from either process.
 *
 * The `cu` CLI's exact JSON shapes are not strictly pinned across versions, so
 * EVERY field here is optional and the main module's parsers read defensively
 * (with a `raw` escape hatch on the rollup shapes). The renderer renders only
 * the fields it recognizes and degrades silently on the rest.
 */

/** A session's lifecycle status, as reported by `cu sessions ls`. */
export type CuStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'paused:cap'
  | 'paused:user'
  | (string & {});

/** One session in the fleet, flattened from a `cu sessions ls --json` row. */
export interface CuSession {
  /** Stable session id (long form). */
  id: string;
  /** Human short name, e.g. `plucky-lynx`. Falls back to the id when absent. */
  shortName?: string;
  /** Absolute repo path the session was launched against. */
  repoPath?: string;
  status?: CuStatus;
  /** Turns consumed so far. */
  turns?: number;
  /** Spend so far, in USD. */
  costUsd?: number;
  /** Saved launch profile name, if any. */
  profile?: string;
  /** Model id the session runs on. */
  model?: string;
  /** Prompt-derived title. */
  title?: string;
  /** ISO start timestamp. */
  startedAt?: string;
}

/** `cu daemon status --json` shape. */
export interface CuDaemonStatus {
  /** Whether the local daemon is up. The one field we always rely on. */
  running: boolean;
  pid?: number;
  socket?: string;
  /** Uptime in seconds (or whatever unit the daemon reports). */
  uptime?: number;
}

/** Per-session resource vitals from `cu sessions vitals --json`. */
export interface CuVitals {
  pid?: number;
  /** Resident set size in bytes. */
  rss?: number;
  /** CPU percent. */
  cpu?: number;
}

/** Fleet rollup from `cu dashboard --json`. Recognized fields + raw escape hatch. */
export interface CuDashboard {
  totalSessions?: number;
  running?: number;
  completed?: number;
  failed?: number;
  paused?: number;
  /** Total spend across the fleet, USD. */
  totalCostUsd?: number;
  /** The unparsed/extra payload, so nothing is silently dropped. */
  raw?: unknown;
}

/** Weekly cost/turns summary from `cu report --json`. */
export interface CuReport {
  totalCostUsd?: number;
  totalTurns?: number;
  sessions?: number;
  raw?: unknown;
}

/** One pending approval from `cu approvals ls --json`. */
export interface CuApproval {
  id: string;
  sessionId?: string;
  tool?: string;
  summary?: string;
  createdAt?: string;
}

/** Markdown post-mortem from `cu sessions post-mortem` (NOT --json). */
export interface CuPostMortem {
  markdown: string;
}

/** Result of a mutating session/daemon action (pause/resume/kill/start/…). */
export interface CuActionResult {
  ok: boolean;
  /** Process exit code (`cu` exits 0 on success, non-zero on error). */
  code: number | null;
  /** Stdout/stderr text, surfaced to the user on failure. */
  message?: string;
}

/** Result of `cu run` — emits JSON by default (rejects an explicit `--json`). */
export interface CuRunResult {
  ok: boolean;
  sessionId?: string;
  shortName?: string;
  /** Raw stdout, so unparsed fields aren't lost. */
  raw?: string;
}

/** Options for launching a session via `cu run`. */
export interface CuRunOptions {
  repoPath: string;
  prompt: string;
  model?: string;
  profile?: string;
  agent?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode?: CuPermissionMode;
  allowedTools?: string;
}

/** Filters accepted by the fleet-wide `cu sessions *-all` commands. */
export interface CuFleetFilters {
  repo?: string;
  status?: string;
  profile?: string;
  olderThan?: string;
}

/** The permission postures `cu run --permission-mode` accepts. */
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'plan',
  'dontAsk'
] as const;
export type CuPermissionMode = (typeof PERMISSION_MODES)[number];

/** Statuses we treat as "running" (drives the nav badge + grouping order). */
const RUNNING_STATUSES = new Set<string>(['running']);

/** A session is actively running (vs. paused/terminal). Case-insensitive. */
export function isRunning(status?: string): boolean {
  return !!status && RUNNING_STATUSES.has(status.trim().toLowerCase());
}

/** A session is paused (any paused:* variant). */
export function isPaused(status?: string): boolean {
  return !!status && status.trim().toLowerCase().startsWith('paused');
}

/** A session has reached a terminal state (no further turns). */
export function isTerminal(status?: string): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'completed' || s === 'failed' || s === 'cancelled';
}

/** The host-cache key the panel writes the running count to for the nav badge. */
export const RUNNING_COUNT_CACHE_KEY = 'cu.runningCount';

/** The host-cache key the panel stashes its last fleet snapshot under. */
export const FLEET_CACHE_KEY = 'cu.fleet';

/** Display label for a session: its short name, else a trimmed id. */
export function sessionLabel(s: CuSession): string {
  if (s.shortName) return s.shortName;
  return s.id.length > 12 ? `${s.id.slice(0, 12)}…` : s.id;
}

/** Last path segment of a repo path, for grouping headers. */
export function repoBasename(repoPath?: string): string {
  if (!repoPath) return '(no repo)';
  const parts = repoPath.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

// ===========================================================================
// CU "vocabulary" catalogs — profiles, agents, agent-groups, workflows,
// schedules, GUS-CDC subscriptions. These back the panel's read-only tabs
// alongside the live Fleet (sessions) view. Every field is optional; the main
// module's parsers read defensively and keep a `raw` escape hatch where shapes
// aren't pinned.
// ===========================================================================

/** A saved launch shape from `cu profiles ls --json`. */
export interface CuProfile {
  name: string;
  description?: string;
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  raw?: unknown;
}

/** A reusable behavior contract from `cu agents ls --json`. */
export interface CuAgent {
  name: string;
  description?: string;
  archetype?: string;
  model?: string;
  /** The agent's tool allowlist — the security boundary (ADR 0021). */
  allowedTools?: string[];
  /** Whether this came from repo scope (vs user scope). */
  scope?: 'user' | 'repo';
  raw?: unknown;
}

/** A bundle of agents from `cu agent-groups ls --json`. */
export interface CuAgentGroup {
  name: string;
  description?: string;
  /** Member agent names. */
  members?: string[];
  /** Optional coordinator member. */
  coordinator?: string;
  raw?: unknown;
}

/** A saved multi-node workflow from `cu workflow ls --json`. */
export interface CuWorkflow {
  name: string;
  description?: string;
  /** Number of nodes in the DAG, when reported. */
  nodeCount?: number;
  /** Scope the definition lives in. */
  scope?: 'user' | 'repo';
  raw?: unknown;
}

/** A past workflow run from `cu workflow runs --json`. */
export interface CuWorkflowRun {
  /** Run token / id. */
  token: string;
  workflow?: string;
  status?: string;
  startedAt?: string;
  raw?: unknown;
}

/** A cron schedule from `cu schedules ls --json`. */
export interface CuSchedule {
  name: string;
  /** `run` or `workflow`. */
  kind?: string;
  /** Cron expression. */
  cron?: string;
  enabled?: boolean;
  /** Bound agent / agent-group. */
  agent?: string;
  agentGroup?: string;
  /** Target repo (run) or workflow name. */
  target?: string;
  /** ISO timestamp of the next tick, when reported. */
  nextRun?: string;
  /** Did the last run error? */
  lastFailed?: boolean;
  raw?: unknown;
}

/** A GUS-CDC subscription from `cu gus-cdc subscriptions ls --json`. */
export interface CuSubscription {
  name: string;
  /** `session` or `workflow`. */
  targetType?: string;
  /** CREATE | UPDATE | DELETE | UNDELETE (one or more). */
  changeTypes?: string[];
  /** Field filters that narrow UPDATE firing. */
  fields?: string[];
  enabled?: boolean;
  raw?: unknown;
}

/** The panel's top-level tabs. */
export const CU_TABS = ['fleet', 'profiles', 'agents', 'workflows', 'schedules'] as const;
export type CuTab = (typeof CU_TABS)[number];
