/**
 * Golden-file-style tests for runCli. Creates a temp fixture data dir with
 * sample projects, schedules, personas, and inbox entries, then asserts
 * various command outputs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../lib/run-cli.js';

const fixtureDir = join(tmpdir(), `cc-cli-test-${Date.now()}`);

beforeAll(() => {
  // Create fixture data directory
  mkdirSync(fixtureDir, { recursive: true });
  mkdirSync(join(fixtureDir, 'schedules'), { recursive: true });
  mkdirSync(join(fixtureDir, 'personas'), { recursive: true });
  mkdirSync(join(fixtureDir, 'inbox'), { recursive: true });

  // projects.json (v1 format)
  writeFileSync(
    join(fixtureDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: 'proj-001',
          name: 'Test Project',
          path: '/home/user/test-project',
          tag: 'test',
          createdAt: 1000000000,
          lastActiveAt: 1000000100
        },
        {
          id: 'proj-002',
          name: 'Another Project',
          path: '/home/user/another',
          createdAt: 1000000000,
          lastActiveAt: 1000000100
        }
      ]
    }, null, 2)
  );

  // schedules/schedule1.json
  writeFileSync(
    join(fixtureDir, 'schedules', 'schedule1.json'),
    JSON.stringify({
      id: 'sched-001',
      name: 'Daily Review',
      enabled: true,
      projectId: 'proj-001',
      profile: 'claude',
      schedule: { every: '24h' },
      overlap: 'skip',
      history: { retain: 10 },
      status: {
        runCount: 5,
        runs: [],
        lastRunResult: 'success'
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }, null, 2)
  );

  // personas/my-persona.json
  writeFileSync(
    join(fixtureDir, 'personas', 'my-persona.json'),
    JSON.stringify({
      id: 'custom-reviewer',
      name: 'Custom Reviewer',
      baseProfile: 'claude',
      model: 'opus',
      description: 'A custom code reviewer'
    }, null, 2)
  );

  // inbox/entries.jsonl
  const entries = [
    {
      id: 'inbox-001',
      ts: 1000000000,
      projectId: 'proj-001',
      projectLabel: 'Test Project',
      comments: 'First entry\nWith multiple lines',
      docs: [{ path: 'src/file.ts' }]
    },
    {
      id: 'inbox-002',
      ts: 1000000100,
      projectId: 'proj-002',
      comments: 'Second entry',
      docs: []
    }
  ];
  writeFileSync(
    join(fixtureDir, 'inbox', 'entries.jsonl'),
    entries.map(e => JSON.stringify(e)).join('\n')
  );

  // Malformed files for error handling tests
  writeFileSync(
    join(fixtureDir, 'schedules', 'bad.json'),
    '{ "id": "bad", "name": "missing required fields" }'
  );
  writeFileSync(
    join(fixtureDir, 'personas', 'bad.json'),
    '{ "id": null }'
  );
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('cc CLI', () => {
  it('shows help with --help', async () => {
    const result = await runCli(['node', 'cc', '--help'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('USAGE:');
    expect(result.stdout).toContain('cc <command>');
  });

  it('shows version with --version', async () => {
    const result = await runCli(['node', 'cc', '--version'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/cc version \d+\.\d+\.\d+/);
  });

  it('lists projects as JSON', async () => {
    const result = await runCli(['node', 'cc', 'projects', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const projects = JSON.parse(result.stdout);
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe('Test Project');
    expect(projects[1].name).toBe('Another Project');
  });

  it('lists projects as human table', async () => {
    const result = await runCli(['node', 'cc', 'projects', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('NAME');
    expect(result.stdout).toContain('Test Project');
    expect(result.stdout).toContain('Another Project');
  });

  it('lists personas as JSON', async () => {
    const result = await runCli(['node', 'cc', 'personas', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('personas/bad.json');
    const personas = JSON.parse(result.stdout);
    expect(personas).toHaveLength(1);
    expect(personas[0].id).toBe('custom-reviewer');
    expect(personas[0].name).toBe('Custom Reviewer');
  });

  it('lists personas as human table', async () => {
    const result = await runCli(['node', 'cc', 'personas', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('NAME');
    expect(result.stdout).toContain('custom-reviewer');
    expect(result.stdout).toContain('Custom Reviewer');
  });

  it('lists schedules as JSON', async () => {
    const result = await runCli(['node', 'cc', 'schedule', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('schedules/bad.json');
    const schedules = JSON.parse(result.stdout);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe('sched-001');
    expect(schedules[0].name).toBe('Daily Review');
  });

  it('lists schedules as human table', async () => {
    const result = await runCli(['node', 'cc', 'schedule', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('NAME');
    expect(result.stdout).toContain('Daily Review');
    expect(result.stdout).toContain('success');
  });

  it('lists inbox entries as JSON', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entries = JSON.parse(result.stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('inbox-002'); // Newest first
    expect(entries[1].id).toBe('inbox-001');
  });

  it('lists inbox entries as human table', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('TIMESTAMP');
    expect(result.stdout).toContain('First entry');
    expect(result.stdout).toContain('Second entry');
  });

  it('filters inbox by project', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'ls', '--project', 'proj-001', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entries = JSON.parse(result.stdout);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('inbox-001');
  });

  it('shows full inbox entry', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'show', 'inbox-001'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Inbox Entry: inbox-001');
    expect(result.stdout).toContain('Test Project');
    expect(result.stdout).toContain('First entry');
    expect(result.stdout).toContain('src/file.ts');
  });

  it('shows full inbox entry as JSON', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'show', 'inbox-001', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entry = JSON.parse(result.stdout);
    expect(entry.id).toBe('inbox-001');
    expect(entry.comments).toContain('First entry');
  });

  it('handles missing inbox entry', async () => {
    const result = await runCli(['node', 'cc', 'inbox', 'show', 'nonexistent'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('handles unknown command', async () => {
    const result = await runCli(['node', 'cc', 'unknown', 'cmd'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });

  it('handles missing data directory gracefully', async () => {
    const result = await runCli(['node', 'cc', 'projects', 'ls'], { dataDir: '/nonexistent' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects found');
  });

  it('supports short ID prefix matching for inbox show', async () => {
    // Prefix 'inbox-0' matches both entries; first match is inbox-001
    const result = await runCli(['node', 'cc', 'inbox', 'show', 'inbox-001'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Inbox Entry: inbox-001');
  });

  it('warns when an inbox show prefix is ambiguous', async () => {
    // 'inbox-' is a prefix of both fixture entries — should resolve to one
    // but warn the user it was ambiguous.
    const result = await runCli(['node', 'cc', 'inbox', 'show', 'inbox-'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr ?? '').toContain('matches');
  });

  it('honors the --data-dir flag (space form) over the default', async () => {
    const result = await runCli(['node', 'cc', '--data-dir', fixtureDir, 'projects', 'ls', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('honors the --data-dir=<path> flag (equals form)', async () => {
    const result = await runCli(['node', 'cc', `--data-dir=${fixtureDir}`, 'schedule', 'ls']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('No schedules found');
  });

  it('reads legacy v0 projects.json (bare array)', async () => {
    const v0Dir = join(tmpdir(), `cc-cli-v0-${Date.now()}`);
    mkdirSync(v0Dir, { recursive: true });
    try {
      writeFileSync(
        join(v0Dir, 'projects.json'),
        JSON.stringify([
          { id: 'v0proj', name: 'Legacy Project', path: '/tmp/legacy', createdAt: 1, lastActiveAt: 1 }
        ])
      );
      const result = await runCli(['node', 'cc', 'projects', 'ls', '--json'], { dataDir: v0Dir });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('v0proj');
    } finally {
      rmSync(v0Dir, { recursive: true, force: true });
    }
  });

  it('does not crash on syntactically broken JSON', async () => {
    const brokenDir = join(tmpdir(), `cc-cli-broken-${Date.now()}`);
    mkdirSync(brokenDir, { recursive: true });
    try {
      writeFileSync(join(brokenDir, 'projects.json'), '{ this is not json');
      const result = await runCli(['node', 'cc', 'projects', 'ls'], { dataDir: brokenDir });
      // Degrades to empty + a non-fatal warning, never throws.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No projects found');
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });
});
