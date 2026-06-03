import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { LaunchProfileId, TerminalSession, AppConfig } from '../shared/types.js';

interface Live {
  session: TerminalSession;
  proc: pty.IPty;
}

export class PtyManager extends EventEmitter {
  private live = new Map<string, Live>();

  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((l) => l.session.projectId === projectId)
      .map((l) => l.session);
  }

  create(opts: {
    projectId: string;
    profile: LaunchProfileId;
    cwd: string;
    cols: number;
    rows: number;
    config: AppConfig;
    extraArgs?: string[];
    title?: string;
  }): TerminalSession {
    const { command, args } = resolveLaunch(opts.profile, opts.config);
    const fullArgs = opts.extraArgs ? [...args, ...opts.extraArgs] : args;
    const proc = pty.spawn(command, fullArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
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
      return { command: config.claudeBinary, args: [] };
    case 'claude-resume':
      return { command: config.claudeBinary, args: ['--resume'] };
    case 'claude-continue':
      return { command: config.claudeBinary, args: ['-c'] };
  }
}

function titleFor(profile: LaunchProfileId): string {
  return {
    shell: 'shell',
    claude: 'claude',
    'claude-resume': 'claude --resume',
    'claude-continue': 'claude -c'
  }[profile];
}
