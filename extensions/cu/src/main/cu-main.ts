/**
 * Claude Unleashed (cu) module — main process side.
 *
 * Drives the local `claude-unleashed` daemon by running its CLI. The CLI is
 * invoked exclusively through the brokered exec capability (NOT a raw node
 * builtin), so this module uses ONLY context capabilities + pure JS — survivable
 * under the disk-extension Node-builtin denylist. As an isolated disk extension
 * the brokered call (bin `claude-unleashed`) forwards to the permission-gated
 * broker (manifest `exec` + `execAllowlist: ['claude-unleashed']`).
 *
 * Binary choice: `claude-unleashed` ONLY — deliberately not `cu`. `/usr/bin/cu`
 * is the unrelated UUCP serial tool (a name collision); spawning it would yield
 * garbage. When `claude-unleashed` isn't on PATH the broker rejects and we raise
 * a tagged "CLI not found" error the renderer maps to a clean empty-state.
 *
 * Every data command runs with `--json`. The lone exception is `run`, which
 * emits JSON by DEFAULT and errors if passed `--json` — so we parse its plain
 * stdout. JSON shapes aren't pinned across cu versions, so parsing is tolerant.
 *
 * Capabilities exposed to the renderer via `ModuleHost.call`:
 *   daemonStatus(), listSessions(), getSession(id), vitals(id), postMortem(id),
 *   dashboard(), report(), pause/resume/unstick/kill(id),
 *   pauseAll/resumeAll/killAll(filters?), startDaemon/stopDaemon/restartDaemon(),
 *   run(opts), approvalsList(), approve/deny(id, reason?)
 */

import type { MainModule, MainModuleContext, ExecResult } from '@cctc/extension-sdk/main';
import {
  type CuSession,
  type CuStatus,
  type CuDaemonStatus,
  type CuVitals,
  type CuDashboard,
  type CuReport,
  type CuApproval,
  type CuPostMortem,
  type CuActionResult,
  type CuRunOptions,
  type CuRunResult,
  type CuFleetFilters,
  type CuProfile,
  type CuAgent,
  type CuAgentGroup,
  type CuWorkflow,
  type CuWorkflowRun,
  type CuSchedule,
  type CuSubscription
} from '../shared/types.js';

/** The one binary we run. NOT `cu` (see file header — UUCP collision). */
const BIN = 'claude-unleashed';
/** daemon/data commands can be slowish on a cold daemon; bound them. */
const TIMEOUT_MS = 30_000;
/** `daemon start` can take a moment to detach; give it more room. */
const DAEMON_TIMEOUT_MS = 45_000;

/** The brokered process-runner capability (from `MainModuleContext`). */
type Broker = NonNullable<MainModuleContext['exec']>;
type Log = MainModuleContext['log'];

/** Raised when the CLI binary can't be spawned — renderer → "not-installed". */
class CuUnavailableError extends Error {
  readonly kind = 'cu-unavailable';
}

/**
 * Run `claude-unleashed <args>` via the broker and return its result.
 *
 * The broker REJECTS on a spawn failure (binary missing / not on PATH) or a
 * watchdog kill (timeout / output-cap) — we translate that into a single,
 * renderer-friendly {@link CuUnavailableError}. A process that RAN and exited
 * non-zero RESOLVES with `code !== 0` and is returned unchanged, so callers can
 * inspect stdout/stderr (cu prints a precise message there).
 */
async function cuRun(
  broker: Broker,
  args: string[],
  log: Log,
  timeoutMs = TIMEOUT_MS
): Promise<ExecResult> {
  try {
    return await broker({ bin: BIN, args, timeoutMs });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log(`claude-unleashed spawn failed: ${detail}`);
    throw new CuUnavailableError(
      'Claude Unleashed CLI not found — install `claude-unleashed` and ensure it is on PATH.'
    );
  }
}

/**
 * Tolerant JSON parse: try the whole stdout, then fall back to the trailing
 * `{…}`/`[…]` block (some commands print a log line before the JSON). Returns
 * null on failure so callers decide whether that's "empty" or "error".
 */
function parseJson<T>(stdout: string): T | null {
  const s = stdout?.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (m) {
      try {
        return JSON.parse(m[1]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/** Pluck the first defined value among several candidate keys on a record. */
function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : v == null ? undefined : String(v);
}

/** Map one raw session row (unknown cu shape) onto our tolerant CuSession. */
function mapSession(row: Record<string, unknown>): CuSession {
  return {
    id: asString(pick(row, ['id', 'sessionId', 'session_id'])) ?? '',
    shortName: asString(pick(row, ['shortName', 'short_name', 'name'])),
    repoPath: asString(pick(row, ['repoPath', 'repo_path', 'repo', 'cwd'])),
    status: asString(pick(row, ['status', 'state'])) as CuStatus | undefined,
    turns: asNumber(pick(row, ['turns', 'turnCount', 'turn_count'])),
    costUsd: asNumber(pick(row, ['costUsd', 'cost_usd', 'cost'])),
    profile: asString(pick(row, ['profile', 'profileName', 'profile_name'])),
    model: asString(pick(row, ['model', 'modelId', 'model_id'])),
    title: asString(pick(row, ['title'])),
    startedAt: asString(pick(row, ['startedAt', 'started_at', 'createdAt', 'created_at']))
  };
}

/**
 * The mutating commands wrap a single `claude-unleashed` subprocess in a uniform
 * helper that resolves `{ ok, code, message }`. Used by all the mutating
 * actions (pause/resume/kill/daemon start/…), which emit prose, not JSON.
 */
async function action(
  broker: Broker,
  args: string[],
  log: Log,
  timeoutMs = TIMEOUT_MS
): Promise<CuActionResult> {
  const { stdout, stderr, code } = await cuRun(broker, args, log, timeoutMs);
  const ok = code === 0;
  if (!ok) log(`action failed [${args.join(' ')}]: code ${code} ${stderr || stdout}`);
  return { ok, code, message: (stderr || stdout || '').trim() || undefined };
}

/** Build the `cu sessions *-all` filter args from the optional filter object. */
function filterArgs(f?: CuFleetFilters): string[] {
  const a: string[] = [];
  if (f?.repo) a.push('--repo', f.repo);
  if (f?.status) a.push('--status', f.status);
  if (f?.profile) a.push('--profile', f.profile);
  if (f?.olderThan) a.push('--older-than', f.olderThan);
  return a;
}

/**
 * Normalize a `cu … ls --json` payload into an array of row records. The CLI
 * may return a bare array or an object wrapping the rows under one of the given
 * keys (e.g. `{ profiles: [...] }`). Non-object rows are dropped.
 */
function rowsFrom(parsed: unknown, ...wrapKeys: string[]): Record<string, unknown>[] {
  let arr: unknown = parsed;
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    arr = wrapKeys.map((k) => obj[k]).find(Array.isArray) ?? [];
  }
  return (Array.isArray(arr) ? arr : []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object'
  );
}

/** Coerce a value to a string[] (accepts a CSV string or an array). */
function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'enabled' || s === 'yes') return true;
    if (s === 'false' || s === 'disabled' || s === 'no') return false;
  }
  return undefined;
}

export const cuMainModule: MainModule = {
  id: 'cu',
  setup(ctx) {
    const { log } = ctx;
    // cu runs solely through the brokered process-runner capability. A disk
    // extension gets the permission-gated broker; if none is provided every
    // capability fails cleanly rather than silently returning empty data.
    const broker = ctx.exec;
    if (!broker) {
      throw new Error('cu: brokered exec capability is unavailable; cannot run the claude-unleashed CLI.');
    }

    return {
      /** Daemon liveness. The renderer reads this to drive the daemon-down UI. */
      async daemonStatus(): Promise<CuDaemonStatus> {
        const { stdout } = await cuRun(broker, ['daemon', 'status', '--json'], log);
        const parsed = parseJson<Record<string, unknown>>(stdout);
        // A parse miss here means the binary ran but produced no recognizable
        // status object — treat that as "CLI present but not the daemon we
        // expect" → surface as unavailable rather than a misleading "down".
        if (!parsed || typeof parsed.running !== 'boolean') {
          throw new CuUnavailableError(
            'Claude Unleashed CLI responded unexpectedly — is `claude-unleashed` the right binary on PATH?'
          );
        }
        return {
          running: parsed.running,
          pid: asNumber(parsed.pid),
          socket: asString(parsed.socket),
          uptime: asNumber(parsed.uptime)
        };
      },

      /** All sessions in the fleet. */
      async listSessions(): Promise<CuSession[]> {
        const { stdout } = await cuRun(broker, ['sessions', 'ls', '--json'], log);
        const parsed = parseJson<unknown>(stdout);
        // cu may return a bare array or an object wrapping `sessions`/`items`.
        const rows: unknown[] = Array.isArray(parsed)
          ? parsed
          : (parsed && typeof parsed === 'object'
              ? ((parsed as Record<string, unknown>).sessions ??
                 (parsed as Record<string, unknown>).items ??
                 [])
              : []) as unknown[];
        return rows
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(mapSession)
          .filter((s) => s.id);
      },

      /** One session by id or short name. */
      async getSession(id: string): Promise<CuSession | null> {
        if (typeof id !== 'string' || !id) return null;
        const { stdout } = await cuRun(broker, ['sessions', 'get', id, '--json'], log);
        const parsed = parseJson<Record<string, unknown>>(stdout);
        return parsed && typeof parsed === 'object' ? mapSession(parsed) : null;
      },

      /** Resource vitals (pid/rss/cpu) for one session. */
      async vitals(id: string): Promise<CuVitals> {
        if (typeof id !== 'string' || !id) return {};
        const { stdout } = await cuRun(broker, ['sessions', 'vitals', id, '--json'], log);
        const parsed = parseJson<Record<string, unknown>>(stdout) ?? {};
        return {
          pid: asNumber(pick(parsed, ['pid'])),
          rss: asNumber(pick(parsed, ['rss', 'rssBytes', 'memory'])),
          cpu: asNumber(pick(parsed, ['cpu', 'cpuPercent', 'cpu_percent']))
        };
      },

      /** Markdown post-mortem for a completed session (NOT --json). */
      async postMortem(id: string): Promise<CuPostMortem> {
        if (typeof id !== 'string' || !id) return { markdown: '' };
        const { stdout, stderr, code } = await cuRun(broker, ['sessions', 'post-mortem', id], log);
        if (code !== 0 && !stdout.trim()) {
          return { markdown: `_No post-mortem available._\n\n${(stderr || '').trim()}` };
        }
        return { markdown: stdout.trim() };
      },

      /** Fleet rollup. Recognized fields + a `raw` escape hatch. */
      async dashboard(): Promise<CuDashboard> {
        const { stdout } = await cuRun(broker, ['dashboard', '--json'], log);
        const parsed = parseJson<Record<string, unknown>>(stdout) ?? {};
        return {
          totalSessions: asNumber(pick(parsed, ['totalSessions', 'total', 'sessions'])),
          running: asNumber(pick(parsed, ['running', 'active'])),
          completed: asNumber(pick(parsed, ['completed'])),
          failed: asNumber(pick(parsed, ['failed'])),
          paused: asNumber(pick(parsed, ['paused'])),
          totalCostUsd: asNumber(pick(parsed, ['totalCostUsd', 'costUsd', 'cost'])),
          raw: parsed
        };
      },

      /** Weekly cost/turns summary. */
      async report(): Promise<CuReport> {
        const { stdout } = await cuRun(broker, ['report', '--json'], log);
        const parsed = parseJson<Record<string, unknown>>(stdout) ?? {};
        return {
          totalCostUsd: asNumber(pick(parsed, ['totalCostUsd', 'costUsd', 'cost'])),
          totalTurns: asNumber(pick(parsed, ['totalTurns', 'turns'])),
          sessions: asNumber(pick(parsed, ['sessions', 'sessionCount'])),
          raw: parsed
        };
      },

      // --- Per-session mutating actions (prose output → ok on code 0) ---------

      async pause(id: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing session id');
        return action(broker, ['sessions', 'pause', id], log);
      },
      async resume(id: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing session id');
        return action(broker, ['sessions', 'resume', id], log);
      },
      async unstick(id: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing session id');
        return action(broker, ['sessions', 'unstick', id], log);
      },
      async kill(id: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing session id');
        return action(broker, ['sessions', 'kill', id], log);
      },

      // --- Fleet-wide actions -------------------------------------------------

      async pauseAll(filters?: CuFleetFilters): Promise<CuActionResult> {
        return action(broker, ['sessions', 'pause-all', ...filterArgs(filters)], log);
      },
      async resumeAll(filters?: CuFleetFilters): Promise<CuActionResult> {
        return action(broker, ['sessions', 'resume-all', ...filterArgs(filters)], log);
      },
      async killAll(filters?: CuFleetFilters): Promise<CuActionResult> {
        return action(broker, ['sessions', 'kill-all', ...filterArgs(filters)], log);
      },

      // --- Daemon lifecycle ---------------------------------------------------

      async startDaemon(): Promise<CuActionResult> {
        return action(broker, ['daemon', 'start'], log, DAEMON_TIMEOUT_MS);
      },
      async stopDaemon(): Promise<CuActionResult> {
        return action(broker, ['daemon', 'stop'], log, DAEMON_TIMEOUT_MS);
      },
      async restartDaemon(): Promise<CuActionResult> {
        return action(broker, ['daemon', 'restart'], log, DAEMON_TIMEOUT_MS);
      },

      /**
       * Launch a new session. `cu run` emits JSON by DEFAULT and ERRORS if given
       * `--json`, so we never pass it and parse the plain stdout. Args go through
       * the broker without a shell, so the prompt is a single argv element — no
       * quoting or injection concern.
       */
      async run(opts: CuRunOptions): Promise<CuRunResult> {
        if (!opts?.repoPath) throw new Error('Missing repo path');
        if (!opts?.prompt) throw new Error('Missing prompt');
        const args = ['run', '--repo', opts.repoPath, '--prompt', opts.prompt];
        if (opts.model) args.push('--model', opts.model);
        if (opts.profile) args.push('--profile', opts.profile);
        if (opts.agent) args.push('--agent', opts.agent);
        if (typeof opts.maxTurns === 'number') args.push('--max-turns', String(opts.maxTurns));
        if (typeof opts.maxBudgetUsd === 'number')
          args.push('--max-budget-usd', String(opts.maxBudgetUsd));
        if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
        if (opts.allowedTools) args.push('--allowed-tools', opts.allowedTools);

        const { stdout, stderr, code } = await cuRun(broker, args, log);
        if (code !== 0) {
          const msg = (stderr || stdout || 'cu run failed').trim();
          log(`run failed: ${msg}`);
          throw new Error(msg);
        }
        const parsed = parseJson<Record<string, unknown>>(stdout);
        return {
          ok: true,
          sessionId: asString(pick(parsed ?? {}, ['id', 'sessionId', 'session_id'])),
          shortName: asString(pick(parsed ?? {}, ['shortName', 'short_name', 'name'])),
          raw: stdout.trim() || undefined
        };
      },

      // --- Catalogs: profiles / agents / agent-groups -------------------------

      async listProfiles(): Promise<CuProfile[]> {
        const { stdout } = await cuRun(broker, ['profiles', 'ls', '--json'], log);
        return rowsFrom(parseJson(stdout), 'profiles', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            description: asString(pick(r, ['description', 'desc'])),
            model: asString(pick(r, ['model'])),
            permissionMode: asString(pick(r, ['permissionMode', 'permission_mode'])),
            maxTurns: asNumber(pick(r, ['maxTurns', 'max_turns'])),
            maxBudgetUsd: asNumber(pick(r, ['maxBudgetUsd', 'max_budget_usd'])),
            raw: r
          }))
          .filter((p) => p.name);
      },

      async listAgents(repoPath?: string): Promise<CuAgent[]> {
        const args = ['agents', 'ls', '--json'];
        if (repoPath) args.push('--repo', repoPath);
        const { stdout } = await cuRun(broker, args, log);
        return rowsFrom(parseJson(stdout), 'agents', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            description: asString(pick(r, ['description', 'desc'])),
            archetype: asString(pick(r, ['archetype'])),
            model: asString(pick(r, ['model'])),
            allowedTools: asStringArray(pick(r, ['allowedTools', 'allowed_tools', 'tools'])),
            scope: asString(pick(r, ['scope'])) as CuAgent['scope'],
            raw: r
          }))
          .filter((a) => a.name);
      },

      async listAgentGroups(): Promise<CuAgentGroup[]> {
        const { stdout } = await cuRun(broker, ['agent-groups', 'ls', '--json'], log);
        return rowsFrom(parseJson(stdout), 'agentGroups', 'agent_groups', 'groups', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            description: asString(pick(r, ['description', 'desc'])),
            members: asStringArray(pick(r, ['members', 'agents'])),
            coordinator: asString(pick(r, ['coordinator'])),
            raw: r
          }))
          .filter((g) => g.name);
      },

      // --- Catalogs: workflows ------------------------------------------------

      async listWorkflows(): Promise<CuWorkflow[]> {
        const { stdout } = await cuRun(broker, ['workflow', 'ls', '--json'], log);
        return rowsFrom(parseJson(stdout), 'workflows', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            description: asString(pick(r, ['description', 'desc'])),
            nodeCount: asNumber(pick(r, ['nodeCount', 'node_count', 'nodes'])),
            scope: asString(pick(r, ['scope'])) as CuWorkflow['scope'],
            raw: r
          }))
          .filter((w) => w.name);
      },

      async listWorkflowRuns(): Promise<CuWorkflowRun[]> {
        const { stdout } = await cuRun(broker, ['workflow', 'runs', '--json'], log);
        return rowsFrom(parseJson(stdout), 'runs', 'items')
          .map((r) => ({
            token: asString(pick(r, ['token', 'runId', 'run_id', 'id'])) ?? '',
            workflow: asString(pick(r, ['workflow', 'name'])),
            status: asString(pick(r, ['status', 'state'])),
            startedAt: asString(pick(r, ['startedAt', 'started_at', 'createdAt'])),
            raw: r
          }))
          .filter((r) => r.token);
      },

      /** Kick off a workflow. Like `run`, emits JSON by default — no `--json`. */
      async runWorkflow(name: string, repoPath: string): Promise<CuRunResult> {
        if (!name) throw new Error('Missing workflow name');
        if (!repoPath) throw new Error('Missing repo path');
        const { stdout, stderr, code } = await cuRun(
          broker,
          ['workflow', 'run', name, '--repo', repoPath],
          log
        );
        if (code !== 0) {
          const msg = (stderr || stdout || 'cu workflow run failed').trim();
          log(`workflow run failed: ${msg}`);
          throw new Error(msg);
        }
        const parsed = parseJson<Record<string, unknown>>(stdout);
        return {
          ok: true,
          sessionId: asString(pick(parsed ?? {}, ['token', 'runId', 'run_id', 'id'])),
          shortName: asString(pick(parsed ?? {}, ['name', 'workflow'])),
          raw: stdout.trim() || undefined
        };
      },

      // --- Catalogs: schedules + GUS-CDC subscriptions ------------------------

      async listSchedules(): Promise<CuSchedule[]> {
        const { stdout } = await cuRun(broker, ['schedules', 'ls', '--json'], log);
        return rowsFrom(parseJson(stdout), 'schedules', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            kind: asString(pick(r, ['kind'])),
            cron: asString(pick(r, ['cron', 'cronExpr', 'cron_expr'])),
            enabled: asBool(pick(r, ['enabled'])),
            agent: asString(pick(r, ['agent', 'agentName'])),
            agentGroup: asString(pick(r, ['agentGroup', 'agent_group'])),
            target: asString(pick(r, ['target', 'repo', 'workflow'])),
            nextRun: asString(pick(r, ['nextRun', 'next_run', 'next'])),
            lastFailed: asBool(pick(r, ['lastFailed', 'last_failed', 'failing'])),
            raw: r
          }))
          .filter((s) => s.name);
      },

      async scheduleEnable(name: string): Promise<CuActionResult> {
        if (!name) throw new Error('Missing schedule name');
        return action(broker, ['schedules', 'enable', name], log);
      },
      async scheduleDisable(name: string): Promise<CuActionResult> {
        if (!name) throw new Error('Missing schedule name');
        return action(broker, ['schedules', 'disable', name], log);
      },
      async scheduleRunNow(name: string): Promise<CuActionResult> {
        if (!name) throw new Error('Missing schedule name');
        return action(broker, ['schedules', 'run-now', name, '--json'], log);
      },

      async listSubscriptions(): Promise<CuSubscription[]> {
        const { stdout } = await cuRun(
          broker,
          ['gus-cdc', 'subscriptions', 'ls', '--json'],
          log
        );
        return rowsFrom(parseJson(stdout), 'subscriptions', 'items')
          .map((r) => ({
            name: asString(pick(r, ['name'])) ?? '',
            targetType: asString(pick(r, ['targetType', 'target_type'])),
            changeTypes: asStringArray(pick(r, ['changeTypes', 'change_types', 'changeType'])),
            fields: asStringArray(pick(r, ['fields', 'field'])),
            enabled: asBool(pick(r, ['enabled'])),
            raw: r
          }))
          .filter((s) => s.name);
      },

      // --- Detail view (the `show` subcommands) -------------------------------

      /**
       * Dump one catalog item's full definition for the detail modal. Each kind
       * maps to its `cu <kind> show <name>` — which emits YAML for the rich
       * objects (profiles/agents/workflows include a systemPrompt and node DAG
       * that read best as YAML), so we return the raw text AND a best-effort
       * JSON parse (some `show`s emit JSON). The renderer shows the text body and
       * uses the parsed object when present.
       *
       * `kind` is one of: profile | agent | agent-group | workflow | schedule |
       * subscription. `repoPath` (agents only) scopes the lookup to the merged
       * user+repo catalog.
       */
      async showDetail(
        kind: string,
        name: string,
        repoPath?: string
      ): Promise<{ text: string; parsed: unknown }> {
        if (!name) throw new Error('Missing name');
        const argv: Record<string, string[]> = {
          profile: ['profiles', 'show', name],
          agent: ['agents', 'show', name],
          'agent-group': ['agent-groups', 'show', name],
          workflow: ['workflow', 'show', name],
          schedule: ['schedules', 'show', name],
          subscription: ['gus-cdc', 'subscriptions', 'show', name]
        };
        const args = argv[kind];
        if (!args) throw new Error(`Unknown detail kind: ${kind}`);
        if (kind === 'agent' && repoPath) args.push('--repo', repoPath);

        const { stdout, stderr, code } = await cuRun(broker, args, log);
        if (code !== 0 && !stdout.trim()) {
          const msg = (stderr || `cu ${args.join(' ')} failed`).trim();
          log(`show failed: ${msg}`);
          throw new Error(msg);
        }
        return { text: stdout.trim(), parsed: parseJson(stdout) };
      },

      // --- Approvals ----------------------------------------------------------

      async approvalsList(): Promise<CuApproval[]> {
        const { stdout } = await cuRun(broker, ['approvals', 'ls', '--json'], log);
        const parsed = parseJson<unknown>(stdout);
        const rows: unknown[] = Array.isArray(parsed)
          ? parsed
          : (parsed && typeof parsed === 'object'
              ? ((parsed as Record<string, unknown>).approvals ?? [])
              : []) as unknown[];
        return rows
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r) => ({
            id: asString(pick(r, ['id', 'approvalId'])) ?? '',
            sessionId: asString(pick(r, ['sessionId', 'session_id'])),
            tool: asString(pick(r, ['tool', 'toolName'])),
            summary: asString(pick(r, ['summary', 'description', 'reason'])),
            createdAt: asString(pick(r, ['createdAt', 'created_at']))
          }))
          .filter((a) => a.id);
      },
      async approve(id: string, reason?: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing approval id');
        return action(broker, ['approvals', 'approve', id, ...(reason ? [reason] : [])], log);
      },
      async deny(id: string, reason?: string): Promise<CuActionResult> {
        if (!id) throw new Error('Missing approval id');
        return action(broker, ['approvals', 'deny', id, ...(reason ? [reason] : [])], log);
      }
    };
  }
};
