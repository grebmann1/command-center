import { describe, it, expect, beforeEach, vi } from 'vitest';

// PtyManager imports node-pty (real subprocesses). Mock it with a fake IPty
// that RECORDS the argv it was spawned with, so we can assert exactly what
// reaches the command line — in particular, that a blank opening prompt never
// lands as a stray positional.
interface FakeProc {
  pid: number;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
      args,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

// Keep claude-profile spawns from writing a real ~/.cc-center/mcp file.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager, cleanExtraArgs } from '../pty.js';
import type { AppConfig } from '../../shared/types.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('cleanExtraArgs', () => {
  it('drops an empty-string opening prompt so no stray positional is emitted', () => {
    expect(cleanExtraArgs([''])).toEqual([]);
  });

  it('drops whitespace-only prompt args', () => {
    expect(cleanExtraArgs(['   ', '\n', '\t'])).toEqual([]);
  });

  it('passes a non-empty prompt through unchanged', () => {
    expect(cleanExtraArgs(['Investigate W-123'])).toEqual(['Investigate W-123']);
  });

  it('preserves real flags and the -- end-of-options marker, dropping only blanks', () => {
    expect(cleanExtraArgs(['--', '-leading-dash prompt', ''])).toEqual([
      '--',
      '-leading-dash prompt'
    ]);
  });

  it('treats undefined as an empty arg list', () => {
    expect(cleanExtraArgs(undefined)).toEqual([]);
  });
});

describe('PtyManager.create — empty-prompt invariant', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('never spawns claude with a blank positional when the prompt is empty', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      extraArgs: ['']
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('');
  });

  it('passes a non-empty opening prompt through as a positional', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'p1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      extraArgs: ['Investigate W-123']
    });
    expect(spawned[0].args).toContain('Investigate W-123');
  });
});
