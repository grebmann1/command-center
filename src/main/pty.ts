import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { LaunchProfileId, TerminalSession, AppConfig, ProjectSettings, ProjectRemote } from '../shared/types.js';
import { mcpConfigPathForProject } from './mcp-config.js';

interface Live {
  session: TerminalSession;
  proc: pty.IPty;
  /** Last ~256 bytes of stripped output, used to match permission-prompt phrases. */
  tail?: string;
  /** Set after we raise attention so we don't spam the renderer on every chunk. */
  attention?: boolean;
  /** Bytes of stripped output emitted *after* attention was raised. If the agent
   *  keeps streaming, it isn't actually waiting — auto-clear past a threshold. */
  bytesSinceAttention?: number;
}

/** If the session keeps producing this much non-trivial output after we raised
 *  attention, treat the original signal as a false positive and drop the pill.
 *  Real permission prompts halt the output stream until the user answers. */
const ATTENTION_AUTOCLEAR_BYTES = 4_096;

/**
 * Phrases Claude Code emits when it's blocking on the user. We keep this
 * intentionally small — false positives are far worse than false negatives,
 * since BEL (`\x07`) already covers most prompts.
 */
const ATTENTION_MARKERS = [
  'Do you want to proceed',
  'Do you want to make this edit',
  'Do you want to allow',
  'No, and tell Claude what to do differently'
];

/** ANSI / control byte stripper for the tail buffer. Cheap, allocation-light. */
function stripAnsi(s: string): string {
  // Drop CSI/OSC sequences and the bell char (we capture bell separately).
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f]/g, '');
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
  'Do NOT call inbox_push for routine acknowledgements, partial progress,',
  'or anything you could just answer in the chat. Push only when leaving',
  'the conversation or when the user is likely away from this tab.',
  '',
  '`docs` are paths relative to this project root, rendered live (no',
  'snapshot). `comments` is short markdown — your voice to the user. At',
  'least one of `docs` or `comments` must be present.'
].join(' ');

export class PtyManager extends EventEmitter {
  private live = new Map<string, Live>();
  /** Base URL of the local MCP server, set after the http listener boots. */
  private mcpBaseUrl: string | null = null;

  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((l) => l.session.projectId === projectId)
      .map((l) => l.session);
  }

  /**
   * Set the base URL of the local MCP server. Called once at boot from
   * `index.ts` after `startMcpServer()` resolves. Re-callable for tests.
   */
  setMcpBaseUrl(url: string | null) {
    this.mcpBaseUrl = url;
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
  }): TerminalSession {
    if (opts.remote) {
      return this.createRemote({ ...opts, remote: opts.remote });
    }
    const { command, args } = resolveLaunch(opts.profile, opts.config);
    // For claude-family profiles, point the CLI at the launcher-owned
    // .mcp.json so the agent picks up the cc-inbox server. The URL in
    // that file is `${CC_MCP_URL}`, which Claude evaluates against the
    // env we inject below — keeps the per-project config file static
    // (just one file per project) but identity-bearing at spawn time.
    const claudeMcpArgs = isClaudeProfile(opts.profile) && this.mcpBaseUrl
      ? [
          '--mcp-config',
          mcpConfigPathForProject(opts.projectId),
          // Teach the agent when to use inbox_push. Appended to the system
          // prompt at spawn so it doesn't pollute the user's global claude
          // config — the guidance only applies to launcher-spawned tabs.
          '--append-system-prompt',
          INBOX_USAGE_GUIDANCE
        ]
      : [];
    const psArgs =
      isClaudeProfile(opts.profile) && opts.projectSettings
        ? projectSettingsArgs(opts.projectSettings, opts.profile)
        : [];
    // Pre-approve the inbox push tool so the agent can use it without
    // prompting. We merge into the allowedTools list (rather than emit a
    // second --allowedTools flag) because some claude-cli versions take
    // last-occurrence-wins, which would silently drop this permission when
    // the project also configures allowedTools.
    const inboxAllow = isClaudeProfile(opts.profile) && this.mcpBaseUrl
      ? ['mcp__cc-inbox__inbox_push']
      : [];
    const fullArgs = mergeAllowedTools(
      [...args, ...claudeMcpArgs, ...psArgs, ...(opts.extraArgs ?? [])],
      inboxAllow
    );
    // Mint the session id up front so we can bake it into the per-session
    // MCP URL the agent connects back on. This lets `inbox_push` stamp
    // the originating terminal onto each entry — without it, the inbox UI
    // can only focus the project, not the specific tab the agent runs in.
    const sessionId = randomUUID();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color'
    };
    if (isClaudeProfile(opts.profile) && this.mcpBaseUrl) {
      env.CC_MCP_URL = `${this.mcpBaseUrl}/mcp/${opts.projectId}/${sessionId}`;
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
      extraArgs: opts.extraArgs
    };

    this.live.set(session.id, { session, proc });
    // Broadcast every newly-created session so scheduler-spawned tabs (which
    // bypass the renderer's create() return path) still light up the tab strip.
    this.emit('sessionUpdated', session);

    proc.onData((data) => {
      this.detectAttention(session.id, data);
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
      extraArgs: opts.extraArgs
    };

    this.live.set(session.id, { session, proc });
    this.emit('sessionUpdated', session);

    proc.onData((data) => {
      this.detectAttention(session.id, data);
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
    // Any user input is implicit acknowledgement that they've seen the
    // prompt — clear the attention flag so the badge / OS notification
    // don't keep nagging.
    this.clearAttention(id);
    this.live.get(id)?.proc.write(data);
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

  killAll() {
    for (const id of this.live.keys()) this.close(id);
  }

  /**
   * Inspect a chunk of pty output for "Claude is waiting on the user" signals
   * — an ASCII BEL or one of a small list of permission-prompt phrases at the
   * tail of the output. Raises `attention` on first match.
   *
   * Conservative on purpose:
   *  - `claude-yolo` runs with `--dangerously-skip-permissions`, so permission
   *    prompts are physically impossible. We skip phrase detection entirely
   *    for that profile (keeping BEL, since `\x07` is also an "alert" bell).
   *  - Phrase markers must appear in the last ~256 bytes of stripped output
   *    so a marker echoed mid-stream by the agent's own narration doesn't
   *    fire the badge.
   *  - Once raised, the flag auto-clears if the session keeps producing
   *    output (real prompts halt the stream until answered) — see the
   *    `bytesSinceAttention` accounting below.
   */
  private detectAttention(id: string, data: string) {
    const live = this.live.get(id);
    if (!live) return;
    const stripped = stripAnsi(data);
    // If attention is already raised, watch for auto-clear: continued output
    // is the cleanest "actually it wasn't waiting" signal we can get.
    if (live.attention) {
      live.bytesSinceAttention = (live.bytesSinceAttention ?? 0) + stripped.length;
      if (live.bytesSinceAttention > ATTENTION_AUTOCLEAR_BYTES) {
        this.clearAttention(id);
      }
      // Still keep the tail buffer fresh so a *subsequent* prompt re-fires.
      live.tail = ((live.tail ?? '') + stripped).slice(-512);
      return;
    }
    const tail = ((live.tail ?? '') + stripped).slice(-512);
    live.tail = tail;
    const isYolo = live.session.profile === 'claude-yolo';
    const hasBell = !isYolo && data.indexOf('\x07') !== -1;
    let matched = hasBell;
    if (!matched && !isYolo) {
      // Only count a marker if it lands in the trailing portion — phrases
      // echoed in the middle of a long agent response don't count.
      const window = tail.slice(-256);
      for (const marker of ATTENTION_MARKERS) {
        if (window.includes(marker)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) return;
    live.attention = true;
    live.bytesSinceAttention = 0;
    live.session.attention = 'waiting';
    this.emit('sessionUpdated', live.session);
    this.emit('attention', live.session);
  }

  /**
   * Drop the attention flag (called on user input or via explicit ack from
   * the renderer when the user opens / focuses the tab). Idempotent.
   */
  clearAttention(id: string) {
    const live = this.live.get(id);
    if (!live || !live.attention) return;
    live.attention = false;
    live.bytesSinceAttention = 0;
    live.session.attention = undefined;
    this.emit('sessionUpdated', live.session);
  }

  /**
   * Toggle the headless flag on a live session. Headless tabs stay visible
   * to `list()` but the renderer hides them from the tab strip — useful
   * when the user X's a tab they don't want killed (the pty keeps running
   * in the background). Returns the updated session, or null if missing.
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

function titleFor(profile: LaunchProfileId): string {
  return {
    shell: 'shell',
    claude: 'claude',
    'claude-resume': 'claude --resume',
    'claude-yolo': 'claude --yolo'
  }[profile];
}
