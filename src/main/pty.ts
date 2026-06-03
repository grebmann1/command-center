import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { LaunchProfileId, TerminalSession, AppConfig, ProjectSettings } from '../shared/types.js';
import { mcpConfigPathForProject } from './mcp-config.js';

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
  }): TerminalSession {
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
          // Pre-approve the inbox push tool so the agent can use it without
          // prompting. The MCP-tool name format Claude expects is
          // `mcp__<server-name>__<tool-name>`; our server is `cc-inbox`
          // (see mcp-config.ts) and the tool is `inbox_push`.
          '--allowedTools',
          'mcp__cc-inbox__inbox_push',
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
    const fullArgs = [...args, ...claudeMcpArgs, ...psArgs, ...(opts.extraArgs ?? [])];
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color'
    };
    if (isClaudeProfile(opts.profile) && this.mcpBaseUrl) {
      env.CC_MCP_URL = `${this.mcpBaseUrl}/mcp/${opts.projectId}`;
    }
    const proc = pty.spawn(command, fullArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env
    });

    const session: TerminalSession = {
      id: randomUUID(),
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

    proc.onData((data) => this.emit('data', session.id, data));
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

function titleFor(profile: LaunchProfileId): string {
  return {
    shell: 'shell',
    claude: 'claude',
    'claude-resume': 'claude --resume',
    'claude-yolo': 'claude --yolo'
  }[profile];
}
