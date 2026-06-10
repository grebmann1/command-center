import { describe, it, expect, vi, beforeEach } from 'vitest';

// PtyManager imports node-pty, which spawns real subprocesses. Mock it with a
// fake IPty that records writes, so we can assert what `reply` sends without
// launching a shell. Each spawned proc keeps its own write log.
interface FakeProc {
  pid: number;
  writes: string[];
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 1000 + spawned.length,
      writes: [],
      write(data: string) {
        this.writes.push(data);
      },
      onData() {
        // no-op; reply tests don't exercise the data stream
      },
      onExit() {
        // no-op; reply tests don't exercise exit
      },
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

// mcp-config touches no electron APIs but keep the import graph minimal.
vi.mock('../mcp-config.js', () => ({
  mcpConfigPathForProject: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

function makeSession(mgr: PtyManager) {
  return mgr.create({
    projectId: 'p1',
    profile: 'shell',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    config: CONFIG
  });
}

describe('PtyManager.reply', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('writes the text followed by a carriage return', () => {
    const mgr = new PtyManager();
    const session = makeSession(mgr);
    const proc = spawned[0];

    const ok = mgr.reply(session.id, 'yes, proceed');

    expect(ok).toBe(true);
    expect(proc.writes).toEqual(['yes, proceed\r']);
  });

  it('preserves multi-line reply bodies, with a single trailing CR', () => {
    const mgr = new PtyManager();
    const session = makeSession(mgr);
    const proc = spawned[0];

    mgr.reply(session.id, 'line one\nline two');

    expect(proc.writes).toEqual(['line one\nline two\r']);
  });

  it('returns false and writes nothing when the session is unknown', () => {
    const mgr = new PtyManager();
    makeSession(mgr);
    const proc = spawned[0];

    const ok = mgr.reply('no-such-session', 'hello');

    expect(ok).toBe(false);
    expect(proc.writes).toEqual([]);
  });
});
