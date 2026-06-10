import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSshHosts, classifySfworkFailure } from '../ssh-config.js';

describe('listSshHosts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ssh-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty list when file is missing', async () => {
    const hosts = await listSshHosts(join(dir, 'does-not-exist'));
    expect(hosts).toEqual([]);
  });

  it('returns sfwork hosts and filters out non-sfwork hosts', async () => {
    // Salesforce convention: dev workspaces use `User sfwork`. Hosts with
    // any other user (or none) are personal/jump entries and shouldn't
    // appear in the workspace picker. Mirrors aisuite's filter.
    const cfg = join(dir, 'config');
    await writeFile(
      cfg,
      [
        'Host devbox',
        '  HostName 10.0.0.5',
        '  User sfwork',
        '',
        'Host personal',
        '  HostName work.example.com',
        '  User alice',
        '',
        'Host noUser',
        '  HostName plain.example.com'
      ].join('\n')
    );
    const hosts = await listSshHosts(cfg);
    expect(hosts).toEqual([{ alias: 'devbox', hostname: '10.0.0.5', user: 'sfwork' }]);
  });

  it('skips wildcard hosts', async () => {
    const cfg = join(dir, 'config');
    await writeFile(
      cfg,
      ['Host *', '  User sfwork', '', 'Host real', '  HostName r.example.com', '  User sfwork'].join('\n')
    );
    const hosts = await listSshHosts(cfg);
    expect(hosts.map((h) => h.alias)).toEqual(['real']);
  });

  it('skips multi-alias Host lines (treated as pattern blocks)', async () => {
    // Mirrors aisuite/manager/internal/workspaces/config.go — a Host line
    // with multiple aliases is a pattern block, not a list of pickable
    // targets, so we drop the whole block.
    const cfg = join(dir, 'config');
    await writeFile(
      cfg,
      [
        'Host a b c',
        '  HostName shared.example.com',
        '  User sfwork',
        '',
        'Host real',
        '  HostName r.example.com',
        '  User sfwork'
      ].join('\n')
    );
    const hosts = await listSshHosts(cfg);
    expect(hosts.map((h) => h.alias)).toEqual(['real']);
  });

  it('follows Include with glob', async () => {
    const cfg = join(dir, 'config');
    const inc = join(dir, 'conf.d');
    await mkdir(inc);
    await writeFile(join(inc, 'one.conf'), 'Host one\n  HostName one.example.com\n  User sfwork\n');
    await writeFile(join(inc, 'two.conf'), 'Host two\n  HostName two.example.com\n  User sfwork\n');
    await writeFile(
      cfg,
      ['Host top', '  HostName top.example.com', '  User sfwork', '', `Include ${inc}/*.conf`].join('\n')
    );
    const hosts = await listSshHosts(cfg);
    expect(hosts.map((h) => h.alias).sort()).toEqual(['one', 'top', 'two']);
  });

  it('ignores comments and blank lines', async () => {
    const cfg = join(dir, 'config');
    await writeFile(
      cfg,
      ['# comment', '', 'Host h1', '  # inner comment', '  HostName h.example.com', '  User sfwork'].join('\n')
    );
    const hosts = await listSshHosts(cfg);
    expect(hosts).toEqual([{ alias: 'h1', hostname: 'h.example.com', user: 'sfwork' }]);
  });

  it('avoids infinite recursion on Include cycles', async () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    await writeFile(
      a,
      [`Include ${b}`, 'Host onlya', '  HostName a.example.com', '  User sfwork'].join('\n')
    );
    await writeFile(
      b,
      [`Include ${a}`, 'Host onlyb', '  HostName b.example.com', '  User sfwork'].join('\n')
    );
    const hosts = await listSshHosts(a);
    const aliases = hosts.map((h) => h.alias).sort();
    expect(aliases).toEqual(['onlya', 'onlyb']);
  });
});

describe('classifySfworkFailure', () => {
  it('reports a missing CLI when spawn fails with ENOENT', () => {
    const msg = classifySfworkFailure({ code: 'ENOENT' } as never, '');
    expect(msg).toMatch(/not found on PATH/i);
  });

  it('reports a timeout when the process was killed', () => {
    const msg = classifySfworkFailure({ killed: true } as never, '');
    expect(msg).toMatch(/timed out/i);
  });

  it('detects a re-auth prompt in the output', () => {
    const out = '*** INFO: Please (re)login with your SSO credentials.';
    const msg = classifySfworkFailure({ code: 1 } as never, out);
    expect(msg).toMatch(/re-authenticate/i);
  });

  it('falls back to a generic message for unknown failures', () => {
    const msg = classifySfworkFailure({ code: 1 } as never, 'some other error');
    expect(msg).toMatch(/could not refresh/i);
  });

  it('prioritizes ENOENT over output sniffing', () => {
    // A missing binary may still emit login-ish noise; the spawn error wins.
    const msg = classifySfworkFailure({ code: 'ENOENT' } as never, 'please login');
    expect(msg).toMatch(/not found on PATH/i);
  });
});
