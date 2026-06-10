import { describe, it, expect } from 'vitest';
import type { Project, TerminalSession } from '../../../shared/types.js';
import {
  snapshotTabs,
  shouldResumeConversation,
  withResumeArgs,
  planRestore,
  type SessionSnapshotMap
} from '../sessionRestore.js';

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'sid',
    projectId: 'p1',
    title: 'claude',
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  };
}

function project(over: Partial<Project>): Project {
  return {
    id: 'p1',
    name: 'p1',
    path: '/work/p1',
    createdAt: 0,
    lastActiveAt: 0,
    ...over
  };
}

describe('snapshotTabs', () => {
  it('captures profile/title/extraArgs/cwd/pinned for visible tabs', () => {
    const snap = snapshotTabs([
      session({ id: 'a', profile: 'claude', title: 'c', cwd: '/work/p1', pinned: true }),
      session({ id: 'b', profile: 'shell', title: 'sh', extraArgs: ['--foo'] })
    ]);
    expect(snap).toEqual([
      { profile: 'claude', title: 'c', extraArgs: undefined, cwd: '/work/p1', pinned: true },
      { profile: 'shell', title: 'sh', extraArgs: ['--foo'], cwd: '/work/p1', pinned: undefined }
    ]);
  });

  it('drops headless (background) tabs', () => {
    const snap = snapshotTabs([
      session({ id: 'a' }),
      session({ id: 'b', headless: true })
    ]);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ profile: 'claude' });
  });

  it('drops exited tabs so a session the user let die is not resurrected', () => {
    const snap = snapshotTabs([
      session({ id: 'a', status: 'running' }),
      session({ id: 'b', status: 'exited', exitCode: 0 })
    ]);
    expect(snap).toHaveLength(1);
    expect(snap[0].profile).toBe('claude');
  });
});

describe('shouldResumeConversation', () => {
  it('is true for every claude-family profile', () => {
    expect(shouldResumeConversation('claude')).toBe(true);
    expect(shouldResumeConversation('claude-resume')).toBe(true);
    expect(shouldResumeConversation('claude-yolo')).toBe(true);
  });
  it('is false for shell', () => {
    expect(shouldResumeConversation('shell')).toBe(false);
  });
});

describe('withResumeArgs', () => {
  it('appends --continue for claude with no args', () => {
    expect(withResumeArgs('claude', undefined)).toEqual(['--continue']);
  });

  it('preserves existing args and appends --continue', () => {
    expect(withResumeArgs('claude-yolo', ['--model', 'opus'])).toEqual([
      '--model',
      'opus',
      '--continue'
    ]);
  });

  it('leaves shell args untouched', () => {
    expect(withResumeArgs('shell', ['--login'])).toEqual(['--login']);
    expect(withResumeArgs('shell', undefined)).toBeUndefined();
  });

  it('does not double-add --continue', () => {
    expect(withResumeArgs('claude', ['--continue'])).toEqual(['--continue']);
    expect(withResumeArgs('claude', ['-c'])).toEqual(['-c']);
  });

  it('does not fight an explicit --resume <id> pin', () => {
    expect(withResumeArgs('claude', ['--resume', 'sess-123'])).toEqual([
      '--resume',
      'sess-123'
    ]);
  });

  it('respects =-joined resume/continue forms', () => {
    expect(withResumeArgs('claude', ['--resume=sess-123'])).toEqual(['--resume=sess-123']);
    expect(withResumeArgs('claude', ['--continue=1'])).toEqual(['--continue=1']);
  });
});

describe('planRestore', () => {
  const snapshot: SessionSnapshotMap = {
    p1: [
      { profile: 'claude', title: 'c', cwd: '/work/p1' },
      { profile: 'shell', title: 'sh' }
    ]
  };

  it('plans a spawn per remembered tab, folding in --continue for claude', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ projectId: 'p1', profile: 'claude', extraArgs: ['--continue'] });
    expect(plan[1]).toMatchObject({ projectId: 'p1', profile: 'shell' });
    expect(plan[1].extraArgs).toBeUndefined();
  });

  it('skips projects that no longer exist', () => {
    expect(planRestore(snapshot, [], {})).toEqual([]);
  });

  it('skips remote (ssh) projects', () => {
    const plan = planRestore(
      snapshot,
      [project({ id: 'p1', remote: { host: 'box', user: 'me' } })],
      {}
    );
    expect(plan).toEqual([]);
  });

  it('skips a project that already has live sessions (renderer reload, not fresh launch)', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {
      p1: [session({ id: 'already-live' })]
    });
    expect(plan).toEqual([]);
  });

  it('skips a project whose hydration failed (can\'t tell if it has live ptys)', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {}, new Set(['p1']));
    expect(plan).toEqual([]);
  });

  it('restores other projects even when one is already live', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'claude', title: 'c' }],
      p2: [{ profile: 'shell', title: 'sh' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' }), project({ id: 'p2' })], {
      p1: [session({ id: 'live' })]
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].projectId).toBe('p2');
  });
});
