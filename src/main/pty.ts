import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { LaunchProfileId, TerminalSession, AppConfig, ProjectSettings, ProjectRemote } from '../shared/types.js';
import { ensureMcpConfigForProjectSync } from './mcp-config.js';

interface Live {
  session: TerminalSession;
  proc: pty.IPty;
}

/** Profiles that run a Claude-family CLI (i.e. an MCP host). */
function isClaudeProfile(profile: LaunchProfileId): boolean {
  return profile === 'claude' || profile === 'claude-resume' || profile === 'claude-yolo';
}

/**
 * Appended to the agent's system prompt so it knows the `inbox_push` MCP
 * tool exists and *when* to call it. Kept short and concrete — the LLM
 * doesn't need a tutorial, just a list of triggers.
 */
const INBOX_USAGE_GUIDANCE = [
  'You are running inside Claude Code Terminal Center. The MCP tool',
  '`inbox_push` (server: cc-inbox) sends an entry to the user’s inbox in',
  'this app. The user does not see your terminal output in real time —',
  '`inbox_push` is the only way to surface something proactively.',
  '',
  'Call inbox_push when ANY of these are true:',
  '- A long-running task you started has finished (link the report via `docs`).',
  '- You are blocked and need a decision or input from the user (use `comments`).',
  '- You hit an unexpected error you cannot recover from on your own.',
  '- You completed a multi-step plan and want to summarise the outcome.',
  '',
  'The user is NOT watching your terminal scrollback. Assume any of the',
  'four triggers above is, by default, something they would miss unless',
  'you push it — do not talk yourself out of a push by reasoning that you',
  '"could just answer in the chat" or that they "might still be looking".',
  'When a trigger fires, push; the chat reply and the inbox entry are not',
  'redundant — the chat is only seen if they happen to be on this tab.',
  '',
  'The ONE thing not to push is genuine noise: routine acknowledgements',
  '("ok, done"), mid-task progress with nothing for the user to act on, or',
  'a clarifying question you are about to answer yourself in the same turn.',
  '',
  'If you are asking a QUESTION and need an answer to continue, push it via',
  '`comments` and then WAIT for input on this same session rather than',
  'exiting — the user can reply directly from the inbox, and their answer',
  'arrives here as if typed at your prompt. Do not end your turn assuming',
  'the question was rhetorical.',
  '',
  '`docs` are paths relative to this project root, rendered live (no',
  'snapshot). `comments` is short markdown — your voice to the user. At',
  'least one of `docs` or `comments` must be present.'
].join(' ');

/**
 * Appended (in addition to INBOX_USAGE_GUIDANCE) for scheduled runs only.
 * Teaches the agent to leave a per-run summary via the `schedule_report` MCP
 * tool so the scheduler history shows what each run did.
 */
const SCHEDULE_REPORT_GUIDANCE = [
  'This is a SCHEDULED run. Before you finish, call the MCP tool',
  '`schedule_report` (server: cc-inbox) with a short markdown `summary` of',
  'what this run did — what you checked, what you found or changed, and',
  'whether anything needs the user. Optionally set `status` to',
  "'success' | 'partial' | 'failure'. This summary is attached to the run in",
  'the scheduler history; it is a REPORT, not a log — summarize, don\'t paste',
  'raw output.',
  '',
  'File the report on EVERY scheduled run. It is separate from `inbox_push`:',
  'report = always-on per-run record; inbox = only when you need the user to',
  'act. If this session auto-closes when you finish, you MUST call',
  '`schedule_report` BEFORE ending your turn — the session is killed the',
  'moment you stop, so a report left for "later" never gets sent.',
  '',
  'Do ALL of your work INLINE, within this single turn. Do NOT dispatch',
  'background / run_in_background agents and do NOT hand work off to "finish',
  'later": this session is torn down the instant your turn ends, which kills',
  'the entire process tree and orphans any background agent mid-flight — its',
  'work is lost and never lands. If a task would normally be delegated to a',
  'background agent, perform it yourself and wait for the result before you',
  'call `schedule_report` and stop.'
].join(' ');

export class PtyManager extends EventEmitter {
  private live = new Map<string, Live>();
  /** Base URL of the local MCP server, set after the http listener boots. */
  private mcpBaseUrl: string | null = null;
  /**
   * Session ids the launcher itself asked to close (e.g. a scheduler
   * auto-close Stop hook). On exit we report code 0 for these so the run is
   * logged as a clean "success" rather than the non-zero code `proc.kill()`
   * actually yields. See `closeExpected`.
   */
  private expectedClose = new Set<string>();

  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((l) => l.session.projectId === projectId)
      .map((l) => l.session);
  }

  /** Look up a single live session by id, or null if it isn't running. */
  getSession(sessionId: string): TerminalSession | null {
    return this.live.get(sessionId)?.session ?? null;
  }

  /** Count of live ptys still running (used for the quit-confirmation prompt). */
  liveCount(): number {
    return this.live.size;
  }

  /**
   * Set the base URL of the local MCP server. Called once at boot from
   * `index.ts` after `startMcpServer()` resolves. Re-callable for tests.
   */
  setMcpBaseUrl(url: string | null) {
    this.mcpBaseUrl = url;
  }

  /**
   * Ensure the per-project `.mcp.json` exists on disk and return its path,
   * or null if the write failed. Null makes the caller skip MCP injection
   * entirely (terminal still opens) rather than launch claude with a
   * `--mcp-config` that points at nothing.
   */
  private safeEnsureMcpConfig(projectId: string): string | null {
    try {
      return ensureMcpConfigForProjectSync(projectId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pty] ensureMcpConfigForProjectSync(${projectId}) failed:`, err);
      return null;
    }
  }

  create(opts: {
    projectId: string;
    profile: LaunchProfileId;
    cwd: string;
    cols: number;
    rows: number;
    config: AppConfig;
    projectSettings?: ProjectSettings;
    extraArgs?: string[];
    title?: string;
    remote?: ProjectRemote;
    /**
     * Inject a Stop hook so the session auto-closes when Claude finishes its
     * response. Used by scheduler fires that opt into `autoCloseOnFinish`.
     * Ignored for non-claude profiles (shell has no Stop event) and when the
     * local callback server URL isn't known yet.
     */
    autoCloseOnFinish?: boolean;
    /**
     * Spawn the session already detached from the tab strip. The pty runs
     * normally; `visibleTerminals()` in the renderer filters it out until the
     * user promotes it (e.g. the inbox "Open in session" deep-link). Used by
     * scheduler fires so background runs don't pile up visible tabs — yet stay
     * alive and replyable from the inbox.
     */
    headless?: boolean;
    /**
     * Marks this spawn as a scheduled run. When set (and the profile is
     * claude-family), we append `SCHEDULE_REPORT_GUIDANCE` to the system prompt
     * so the agent knows to file a run report via `schedule_report`. Off for
     * user-opened tabs so they aren't nagged to report.
     */
    scheduled?: boolean;
  }): TerminalSession {
    if (opts.remote) {
      return this.createRemote({ ...opts, remote: opts.remote });
    }
    const { command, args } = resolveLaunch(opts.profile, opts.config);
    // Mint the session id up front so we can bake it into the per-session
    // MCP + hook URLs the agent/CLI connect back on. This lets `inbox_push`
    // stamp the originating terminal onto each entry and lets a Stop hook
    // name the exact tab to close — without it, callbacks can only target
    // the project, not the specific session.
    const sessionId = randomUUID();
    // For claude-family profiles, point the CLI at the launcher-owned
    // .mcp.json so the agent picks up the cc-inbox server. The URL in
    // that file is `${CC_MCP_URL}`, which Claude evaluates against the
    // env we inject below — keeps the per-project config file static
    // (just one file per project) but identity-bearing at spawn time.
    //
    // Guarantee the file exists *now*, synchronously, rather than trusting an
    // earlier async write to have landed. The async writers race app boot;
    // pointing `--mcp-config` at a not-yet-written file would silently drop
    // the inbox server. If even the sync write fails, fall back to no MCP
    // injection so the terminal still opens.
    const mcpConfigPath =
      isClaudeProfile(opts.profile) && this.mcpBaseUrl
        ? this.safeEnsureMcpConfig(opts.projectId)
        : null;
    const claudeMcpArgs = mcpConfigPath
      ? [
          '--mcp-config',
          mcpConfigPath,
          // Teach the agent when to use inbox_push. Appended to the system
          // prompt at spawn so it doesn't pollute the user's global claude
          // config — the guidance only applies to launcher-spawned tabs.
          '--append-system-prompt',
          // Scheduled runs also learn to file a run report; user-opened tabs
          // get only the inbox guidance.
          opts.scheduled
            ? `${INBOX_USAGE_GUIDANCE}\n\n${SCHEDULE_REPORT_GUIDANCE}`
            : INBOX_USAGE_GUIDANCE
        ]
      : [];
    const psArgs =
      isClaudeProfile(opts.profile) && opts.projectSettings
        ? projectSettingsArgs(opts.projectSettings, opts.profile)
        : [];
    // Stop hook: inject a `--settings` hook (additive — merges with, never
    // replaces, the user's own settings files) that pings our local callback
    // server when the agent finishes its turn. We want this for EVERY scheduled
    // run, not only auto-close ones: a non-auto-close scheduled session stays
    // open at the prompt after finishing, and the hook is how the scheduler
    // learns the turn ended (so the UI can show "done" instead of "running"
    // forever). `autoClose` only decides whether the callback *kills* the pty
    // (handled in index.ts via the task's autoCloseOnFinish flag). Claude
    // profiles only, and only when we know the callback URL.
    const claudeWithCallback = isClaudeProfile(opts.profile) && !!this.mcpBaseUrl;
    const autoClose = !!opts.autoCloseOnFinish && claudeWithCallback;
    const wantsStopHook = claudeWithCallback && (autoClose || !!opts.scheduled);
    // Notification hook: light a "blocked — needs you" status when the agent
    // is waiting on the user (permission prompt / interactive question). This
    // is the ONLY reliable signal for that — the OSC title shows the same `✳`
    // glyph whether idle or blocked. Wanted for EVERY interactive claude tab,
    // not just scheduled ones, so it rides on claudeWithCallback alone.
    const wantsNotifyHook = claudeWithCallback;
    const hookArgs =
      wantsStopHook || wantsNotifyHook
        ? ['--settings', buildHookSettings({ stop: wantsStopHook, notify: wantsNotifyHook })]
        : [];
    // Pre-approve the inbox push tool so the agent can use it without
    // prompting. We merge into the allowedTools list (rather than emit a
    // second --allowedTools flag) because some claude-cli versions take
    // last-occurrence-wins, which would silently drop this permission when
    // the project also configures allowedTools.
    // Gate the inbox allowlist on the config file actually being in place
    // (mcpConfigPath), not just mcpBaseUrl — no point pre-approving a tool
    // whose server we failed to wire up.
    const inboxAllow = mcpConfigPath
      ? opts.scheduled
        ? ['mcp__cc-inbox__inbox_push', 'mcp__cc-inbox__schedule_report']
        : ['mcp__cc-inbox__inbox_push']
      : [];
    const fullArgs = mergeAllowedTools(
      [...args, ...claudeMcpArgs, ...psArgs, ...hookArgs, ...(opts.extraArgs ?? [])],
      inboxAllow
    );
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color'
    };
    if (mcpConfigPath) {
      env.CC_MCP_URL = `${this.mcpBaseUrl}/mcp/${opts.projectId}/${sessionId}`;
    }
    if (wantsStopHook) {
      // The Stop hook command reads this — full URL with identity baked in,
      // so the agent never sees (or could forge) the session id in a schema.
      env.CC_HOOK_URL = `${this.mcpBaseUrl}/hook/stop/${opts.projectId}/${sessionId}`;
    }
    if (wantsNotifyHook) {
      // The Notification/UserPromptSubmit hooks POST here. Same identity-in-URL
      // pattern as the stop hook; the path's trailing segment selects the
      // event (`blocked` vs `unblocked`) so one base URL serves both.
      env.CC_NOTIFY_URL = `${this.mcpBaseUrl}/hook/notify/${opts.projectId}/${sessionId}`;
    }
    const proc = pty.spawn(command, fullArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env
    });

    const session: TerminalSession = {
      id: sessionId,
      projectId: opts.projectId,
      title: opts.title ?? titleFor(opts.profile),
      profile: opts.profile,
      cwd: opts.cwd,
      pid: proc.pid,
      status: 'running',
      createdAt: Date.now(),
      extraArgs: opts.extraArgs,
      headless: opts.headless || undefined,
      scheduled: opts.scheduled || undefined
    };

    this.live.set(session.id, { session, proc });
    // Broadcast every newly-created session so scheduler-spawned tabs (which
    // bypass the renderer's create() return path) still light up the tab strip.
    this.emit('sessionUpdated', session);

    proc.onData((data) => {
      this.emit('data', session.id, data);
    });
    proc.onExit(({ exitCode }) => {
      // A launcher-initiated close (auto-close Stop hook) reports as a clean
      // exit so the scheduler logs the run as success, not a kill-signal error.
      const expected = this.expectedClose.delete(session.id);
      const reportedCode = expected ? 0 : exitCode;
      const live = this.live.get(session.id);
      if (live) {
        live.session.status = 'exited';
        live.session.exitCode = reportedCode;
      }
      this.emit('exit', session.id, reportedCode);
      this.live.delete(session.id);
    });

    return session;
  }

  /**
   * Spawn a local `ssh` subprocess that allocates a PTY on the remote host
   * (`-t`) and runs either the user's login shell or a claude CLI session.
   *
   * For claude-family profiles we apply the same global / per-project
   * flag stack as local spawns, but we deliberately skip MCP injection
   * (`--mcp-config`, `CC_MCP_URL`, the inbox allowlist) — those point at
   * our local http listener and aren't reachable from the remote without
   * a reverse tunnel. Inbox push is a local-only feature in v1.
   */
  private createRemote(opts: {
    projectId: string;
    profile: LaunchProfileId;
    cwd: string;
    cols: number;
    rows: number;
    config: AppConfig;
    projectSettings?: ProjectSettings;
    extraArgs?: string[];
    title?: string;
    remote: ProjectRemote;
    headless?: boolean;
    scheduled?: boolean;
  }): TerminalSession {
    const { remote } = opts;
    // Defense in depth: addRemoteProject already rejects leading-dash values,
    // but reject again here so a hand-edited projects.json can't smuggle
    // `-oProxyCommand=...` into ssh's argv as a flag.
    if (remote.host.startsWith('-')) throw new Error(`refusing ssh host starting with '-': ${remote.host}`);
    if (remote.user && remote.user.startsWith('-')) throw new Error(`refusing ssh user starting with '-': ${remote.user}`);
    const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
    const remoteCmd = buildRemoteCmd(opts);
    const sshArgs = ['-t', target, remoteCmd];

    const proc = pty.spawn('ssh', sshArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.env.HOME ?? '/',
      env: {
        ...(process.env as Record<string, string>),
        TERM: 'xterm-256color'
      }
    });

    const session: TerminalSession = {
      id: randomUUID(),
      projectId: opts.projectId,
      title: opts.title ?? `${titleFor(opts.profile)} · ${remote.host}`,
      profile: opts.profile,
      cwd: opts.cwd,
      pid: proc.pid,
      status: 'running',
      createdAt: Date.now(),
      extraArgs: opts.extraArgs,
      headless: opts.headless || undefined,
      scheduled: opts.scheduled || undefined
    };

    this.live.set(session.id, { session, proc });
    this.emit('sessionUpdated', session);

    proc.onData((data) => {
      this.emit('data', session.id, data);
    });
    proc.onExit(({ exitCode }) => {
      const live = this.live.get(session.id);
      if (live) {
        live.session.status = 'exited';
        live.session.exitCode = exitCode;
      }
      this.emit('exit', session.id, exitCode);
      this.live.delete(session.id);
    });

    return session;
  }

  write(id: string, data: string) {
    this.live.get(id)?.proc.write(data);
  }

  /**
   * Send a line of input to a session — the text, then a carriage return, as
   * if the user typed it and hit Enter. Backs `terminals.reply`, used by the
   * inbox to answer a question an agent pushed via `inbox_push` without
   * leaving the inbox. Returns false when no live pty matches (e.g. the
   * session exited), so callers can surface a "session ended" message.
   *
   * The CR is sent as a SEPARATE, deferred write rather than appended to the
   * body. Claude Code's TUI watches for input that arrives as one fast burst
   * and treats it as a paste — buffering the whole chunk (trailing CR
   * included) as literal text instead of submitting. That's why an inbox
   * reply would land in the prompt box but never run. Writing the CR on its
   * own, a tick later, makes the TUI register it as a discrete Enter keypress.
   */
  reply(id: string, text: string): boolean {
    const live = this.live.get(id);
    if (!live) return false;
    live.proc.write(text);
    setTimeout(() => {
      // Re-resolve: the session may have exited during the delay.
      this.live.get(id)?.proc.write('\r');
    }, 50);
    return true;
  }

  resize(id: string, cols: number, rows: number) {
    const l = this.live.get(id);
    if (!l) return;
    try {
      l.proc.resize(cols, rows);
    } catch {
      /* pty may have exited */
    }
  }

  close(id: string) {
    const l = this.live.get(id);
    if (!l) return;
    try {
      l.proc.kill();
    } catch {
      /* ignore */
    }
  }

  /**
   * Close a session the launcher itself decided to end (the auto-close Stop
   * hook fired). Marks the exit as expected so `onExit` reports code 0 — a
   * scheduled run that finished cleanly shouldn't log as an error just
   * because `proc.kill()` delivers a signal. Returns false if already gone.
   */
  closeExpected(id: string): boolean {
    const l = this.live.get(id);
    if (!l) return false;
    this.expectedClose.add(id);
    try {
      l.proc.kill();
    } catch {
      /* already dead — the onExit (if any) will still clear the flag */
    }
    return true;
  }

  killAll() {
    for (const id of this.live.keys()) this.close(id);
  }

  /**
   * Toggle the headless flag on a live session. Headless tabs stay visible
   * to `list()` but the renderer hides them from the tab strip — used when
   * the user detaches a tab to the background ("Send to background"; the pty
   * keeps running). Returns the updated session, or null if missing.
   */
  setHeadless(id: string, headless: boolean): TerminalSession | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.session.headless === headless) return live.session;
    live.session.headless = headless || undefined;
    this.emit('sessionUpdated', live.session);
    return live.session;
  }
}

function resolveLaunch(profile: LaunchProfileId, config: AppConfig): { command: string; args: string[] } {
  switch (profile) {
    case 'shell':
      return { command: config.shell, args: [] };
    case 'claude':
      return { command: config.claudeBinary, args: globalClaudeArgs(config) };
    case 'claude-resume':
      return { command: config.claudeBinary, args: ['--resume', ...globalClaudeArgs(config)] };
    case 'claude-yolo':
      // --dangerously-skip-permissions takes precedence; do NOT inject --permission-mode.
      return { command: config.claudeBinary, args: ['--dangerously-skip-permissions'] };
  }
}

/**
 * Build the global CLI flags derived from AppConfig for claude / claude-resume
 * profiles. These are inserted BEFORE extraArgs so the caller can override.
 */
function globalClaudeArgs(config: AppConfig): string[] {
  const args: string[] = [];
  if (config.defaultModel && config.defaultModel !== 'default') {
    args.push('--model', config.defaultModel);
  }
  if (config.defaultPermissionMode && config.defaultPermissionMode !== 'default') {
    args.push('--permission-mode', config.defaultPermissionMode);
  }
  return args;
}

/**
 * Build CLI flags derived from per-project ProjectSettings.
 * Inserted AFTER the global AppConfig flags (T2) and claudeMcpArgs so they
 * override globals, and BEFORE per-tab extraArgs so per-tab args win.
 *
 * Assembly order (lowest → highest precedence):
 *   base profile args → AppConfig globals → ProjectSettings flags +
 *   ProjectSettings.extraArgs → CreateTerminalRequest.extraArgs
 */
function projectSettingsArgs(s: ProjectSettings, profile: LaunchProfileId): string[] {
  const args: string[] = [];
  if (s.appendSystemPrompt) {
    args.push('--append-system-prompt', s.appendSystemPrompt);
  }
  for (const dir of s.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if ((s.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', s.allowedTools!.join(','));
  }
  if ((s.deniedTools ?? []).length > 0) {
    args.push('--disallowedTools', s.deniedTools!.join(','));
  }
  // model / permissionMode appended last so they override any global value
  // (claude CLI: last occurrence wins for these flags).
  if (s.model) {
    args.push('--model', s.model);
  }
  if (s.permissionMode && profile !== 'claude-yolo') {
    args.push('--permission-mode', s.permissionMode);
  }
  if (s.extraArgs) {
    args.push(...s.extraArgs);
  }
  return args;
}

/**
 * Ensure a single `--allowedTools` flag in the argv with `extras` (plus any
 * existing values from earlier flags) merged and deduped. Pure: returns a
 * new array. If neither side mentions allowed tools, returns argv unchanged.
 */
function mergeAllowedTools(argv: string[], extras: string[]): string[] {
  if (extras.length === 0 && !argv.includes('--allowedTools')) return argv;
  const collected: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--allowedTools' && i + 1 < argv.length) {
      const next = argv[i + 1];
      next.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => collected.push(v));
      i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  for (const v of extras) collected.push(v);
  if (collected.length === 0) return out;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const v of collected) {
    if (!seen.has(v)) { seen.add(v); merged.push(v); }
  }
  out.push('--allowedTools', merged.join(','));
  return out;
}

/**
 * POSIX shell quoting — wrap `s` in single quotes and escape any embedded
 * single quote. Used to safely inject `cd <path>` and to assemble argv
 * into the remote command line we hand to ssh.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function shellQuoteArgv(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

/**
 * Build the single command string we hand to the remote sshd. For shell
 * profiles we exec the login shell; for claude profiles we run the
 * claude CLI with the same global / per-project flag stack the local
 * path uses, minus MCP injection (the cc-inbox server isn't reachable
 * from the remote in v1).
 */
function buildRemoteCmd(opts: {
  profile: LaunchProfileId;
  config: AppConfig;
  projectSettings?: ProjectSettings;
  extraArgs?: string[];
  remote: ProjectRemote;
}): string {
  const cdPrefix = opts.remote.remotePath
    ? `cd ${shellQuote(opts.remote.remotePath)} && `
    : '';

  if (opts.profile === 'shell') {
    // The remote shell expands ${SHELL:-/bin/sh}; we keep the braces literal
    // here by building the string outside a template literal so a future
    // edit can't accidentally interpolate it locally.
    const shellExec = 'exec "${SHELL:-/bin/sh}" -l';
    const tail = shellQuoteArgv(opts.extraArgs ?? []);
    return `${cdPrefix}${shellExec}${tail ? ' ' + tail : ''}`;
  }

  // Claude family: build argv locally, ship as a quoted command. We rely
  // on `claude` being on the remote PATH (default for sfwork workspaces).
  const { args: baseArgs } = resolveLaunch(opts.profile, opts.config);
  const psArgs = opts.projectSettings ? projectSettingsArgs(opts.projectSettings, opts.profile) : [];
  const argv = ['claude', ...baseArgs, ...psArgs, ...(opts.extraArgs ?? [])];
  return `${cdPrefix}exec ${shellQuoteArgv(argv)}`;
}

/**
 * Build the inline `--settings` JSON that registers our per-session hooks.
 * `--settings` MERGES with the user's settings files, so this adds hooks
 * without disturbing their config. Every command relies only on `sh` + `curl`
 * (both present on macOS) and exits 0 so it stays fire-and-forget — a hook
 * must never block the agent.
 *
 *  - `stop` (opt-in): a Stop hook that POSTs to `$CC_HOOK_URL` so the scheduler
 *    learns the turn ended (and, for auto-close tasks, the pty gets killed).
 *    Guards on `stop_hook_active` so a re-entrant Stop fire can't race the kill.
 *  - `notify` (opt-in): the live-status hooks that let the UI show
 *    "blocked — needs you". Two independent producers cover the two ways a
 *    Claude turn can stop for the user:
 *      · Notification → POST `/blocked`, but ONLY for the notification types
 *        that mean "waiting on the user" (permission_prompt / elicitation_dialog).
 *        idle_prompt / auth_success / elicitation_complete are skipped — idle is
 *        already covered by the OSC title, and treating it as blocked would make
 *        every finished turn look stuck.
 *      · PreToolUse/PostToolUse matched to `AskUserQuestion` → POST
 *        `/blocked` and `/unblocked`. AskUserQuestion is the built-in
 *        interactive multi-choice prompt (a TOOL, not a notification — it
 *        doesn't reliably fire Notification), so the tool boundary is the
 *        dependable signal: Pre fires as the prompt opens, Post when answered.
 *    Both are cleared by UserPromptSubmit / Stop → POST `/unblocked`, so the
 *    overlay drops the moment the user answers or the turn ends.
 */
function buildHookSettings(opts: { stop: boolean; notify: boolean }): string {
  // node-pty passes argv without a shell, so the whole JSON needs no shell
  // escaping — but each command itself runs under `sh -c`, hence the inner
  // quoting care (single-quoted literals embedded in a single-quoted argv).
  const hooks: Record<string, unknown[]> = {};

  if (opts.stop) {
    const stopCmd =
      'CC_IN=$(cat); ' +
      'case "$CC_IN" in *\'"stop_hook_active":true\'*) exit 0;; esac; ' +
      'if [ -n "$CC_HOOK_URL" ]; then ' +
      'curl -s -m 5 -X POST "$CC_HOOK_URL" >/dev/null 2>&1 || true; ' +
      'fi; exit 0';
    hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: stopCmd }] }];
  }

  if (opts.notify) {
    // POST /blocked. Reads (and discards) the event JSON on stdin first so the
    // hook stays well-behaved, then pings the callback.
    const postBlocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$CC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$CC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true; exit 0';
    // POST /unblocked — the user answered / the turn ended.
    const postUnblocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$CC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$CC_NOTIFY_URL/unblocked" >/dev/null 2>&1 || true; exit 0';
    // Notification: only the types that mean "waiting on the user". We match
    // notification_type substrings (no jq dependency) and deliberately list
    // them explicitly rather than match-all — elicitation_complete /
    // elicitation_response / idle_prompt / auth_success are NOT blocked states,
    // so a match-all would produce false reds.
    const notifyBlocked =
      'CC_IN=$(cat); ' +
      'case "$CC_IN" in ' +
      '*\'"permission_prompt"\'*|*\'"elicitation_dialog"\'*) ' +
      '[ -n "$CC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$CC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true;; ' +
      'esac; exit 0';

    hooks.Notification = [{ matcher: '', hooks: [{ type: 'command', command: notifyBlocked }] }];
    // AskUserQuestion is a built-in TOOL (the interactive multi-choice prompt),
    // not a notification — so we catch it at the tool boundary, which is the
    // reliable signal: PreToolUse fires just before the prompt is shown, and
    // PostToolUse fires once the user picks. The matcher scopes these to that
    // one tool, so no other tool call is touched.
    hooks.PreToolUse = [
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postBlocked }] }
    ];
    hooks.PostToolUse = [
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postUnblocked }] }
    ];
    // Submitting a prompt, and the turn ending, both mean we're no longer
    // waiting on the user.
    hooks.UserPromptSubmit = [
      { matcher: '', hooks: [{ type: 'command', command: postUnblocked }] }
    ];
    const stopUnblock = { type: 'command', command: postUnblocked };
    if (Array.isArray(hooks.Stop)) {
      (hooks.Stop[0] as { hooks: unknown[] }).hooks.push(stopUnblock);
    } else {
      hooks.Stop = [{ matcher: '', hooks: [stopUnblock] }];
    }
  }

  return JSON.stringify({ hooks });
}

function titleFor(profile: LaunchProfileId): string {
  return {
    shell: 'shell',
    claude: 'claude',
    'claude-resume': 'claude --resume',
    'claude-yolo': 'claude --yolo'
  }[profile];
}
