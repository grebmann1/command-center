import { execFile, type ExecFileException } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import type { SshHostEntry, SshSyncResult } from '../shared/types.js';

/**
 * Parse `~/.ssh/config` (recursively following `Include` directives) and
 * return Salesforce dev workspaces — hosts with `User sfwork`. Mirrors
 * aisuite's discovery pattern in
 * `manager/internal/workspaces/config.go`: this app is a Salesforce
 * engineering tool, and `sfwork` is the convention for sf-managed dev
 * boxes. Hosts without that User (personal hosts, jump boxes, github.com
 * entries, etc.) are filtered out so the picker stays scoped to real
 * workspaces.
 *
 * Wildcard hosts (`Host *`) and multi-alias `Host a b c` lines are
 * pattern blocks, not pickable targets — also skipped, again matching
 * aisuite.
 *
 * Cache nothing — file is small and only read when the user opens the
 * "Add remote project" modal.
 */
export const WORKSPACE_USER = 'sfwork';

export async function listSshHosts(configPath?: string): Promise<SshHostEntry[]> {
  const root = configPath ?? join(homedir(), '.ssh', 'config');
  const seen = new Set<string>();
  const out: SshHostEntry[] = [];
  await parseFile(root, seen, out);
  return out.filter((h) => h.user === WORKSPACE_USER);
}

/**
 * Regenerate the sfwork-managed ssh config by shelling out to `sfwork list`,
 * then re-parse and return the host list. The picker is otherwise a read-only
 * view of `~/.ssh/config`; the `User sfwork` blocks it shows live in an
 * `Include`d file that only `sfwork` writes. Without this, "Refresh" can only
 * re-read a stale file and a freshly-provisioned workspace never appears.
 *
 * `sfwork list` regenerates the include file as a side effect; we ignore its
 * stdout. A failure (CLI missing, not logged in, timeout) is non-fatal — we
 * fall back to parsing whatever config exists so Refresh degrades to a plain
 * reload, and surface a `warning` the picker can show.
 */
export async function syncWorkspaceHosts(): Promise<SshSyncResult> {
  const warning = await runSfworkList();
  const hosts = await listSshHosts();
  return warning ? { hosts, warning } : { hosts };
}

const SFWORK_TIMEOUT_MS = 60_000;

/** Run `sfwork list`; resolve to a user-facing warning string on failure, or
 *  `null` on success. Never rejects. */
function runSfworkList(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'sfwork',
      ['list'],
      {
        timeout: SFWORK_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          // `sfwork` resolves via the user's shell PATH (e.g. /usr/local/bin);
          // GUI-launched Electron may not inherit it, so search common dirs.
          PATH: augmentPath(process.env.PATH),
          // `sfwork` is a honu-wrapped Python CLI. Two of its per-run behaviors
          // crash ("Python quit unexpectedly") when spawned headless from a GUI
          // Electron process, so disable both:
          //   - auto-update re-execs the binary mid-run via os.execve
          //     (HONU_UPDATE_FREQ=0 disables the update check entirely);
          //   - the monitor wrapper spawns a subprocess tree + touches the
          //     user's zsh-completion lock files (MONITOR_OFF=direct runs the
          //     command inline instead).
          HONU_UPDATE_FREQ: '0',
          MONITOR_OFF: 'direct'
        }
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(null);
          return;
        }
        resolve(classifySfworkFailure(err, `${stdout ?? ''}\n${stderr ?? ''}`));
      }
    );
  });
}

/** Map a `sfwork list` failure to a short, actionable warning. The hosts shown
 *  are still whatever was on disk, so every message frames it as "couldn't
 *  update" rather than "broken". Exported for tests. */
export function classifySfworkFailure(err: ExecFileException, output: string): string {
  if (err.code === 'ENOENT') {
    return '`sfwork` CLI not found on PATH — showing hosts already in ~/.ssh/config.';
  }
  // execFile sets `killed` when the timeout fires.
  if (err.killed) {
    return '`sfwork list` timed out — showing hosts already in ~/.ssh/config.';
  }
  if (/re.?login|\blogin\b|SSO|okta|not authorized|unauthenticated/i.test(output)) {
    return 'sfwork needs you to re-authenticate — run `sfwork list` in a terminal, then Refresh.';
  }
  return 'Could not refresh from sfwork — showing hosts already in ~/.ssh/config.';
}

/** Prepend common CLI install dirs so a GUI launch can still find `sfwork`. */
function augmentPath(current: string | undefined): string {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')];
  const parts = (current ?? '').split(':').filter(Boolean);
  for (const dir of extra) if (!parts.includes(dir)) parts.push(dir);
  return parts.join(':');
}

async function parseFile(path: string, seen: Set<string>, out: SshHostEntry[]): Promise<void> {
  if (seen.has(path)) return;
  seen.add(path);

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }

  const lines = text.split(/\r?\n/);
  let current: { aliases: string[]; hostname?: string; user?: string } | null = null;

  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      if (isWildcard(alias)) continue;
      out.push({ alias, hostname: current.hostname, user: current.user });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;

    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'host') {
      flush();
      const aliases = value.split(/\s+/).filter(Boolean);
      // Match aisuite's discovery rule (config.go): a Host line with
      // multiple aliases is treated as a pattern block, not a list of
      // pickable targets — skip the whole block. Keeps the surface area
      // identical to a tool we already align with.
      if (aliases.length > 1) {
        current = null;
        continue;
      }
      current = { aliases };
      continue;
    }

    if (key === 'include') {
      flush();
      const patterns = value.split(/\s+/).filter(Boolean);
      for (const pat of patterns) {
        const expanded = expandHome(pat);
        const base = isAbsolute(expanded) ? expanded : join(homedir(), '.ssh', expanded);
        for (const file of await expandGlob(base)) {
          await parseFile(file, seen, out);
        }
      }
      continue;
    }

    if (!current) continue;
    if (key === 'hostname') current.hostname = value;
    else if (key === 'user') current.user = value;
  }

  flush();
}

function isWildcard(alias: string): boolean {
  return alias.includes('*') || alias.includes('?') || alias.startsWith('!');
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Tiny glob expander. Supports `*` and `?` in the basename only — that's
 * the realistic shape of `Include` directives in ssh_config (e.g.
 * `Include conf.d/*`). If the pattern has no wildcards, returns it as-is.
 */
async function expandGlob(pattern: string): Promise<string[]> {
  if (!pattern.includes('*') && !pattern.includes('?')) return [pattern];
  const dir = dirname(pattern);
  const base = basename(pattern);
  const re = globToRegex(base);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => re.test(name))
    .map((name) => join(dir, name))
    .sort();
}

function globToRegex(pat: string): RegExp {
  let re = '^';
  for (const ch of pat) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re);
}
