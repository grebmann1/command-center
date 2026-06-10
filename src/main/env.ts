import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * PATH repair for GUI launches.
 *
 * A macOS/Linux app launched from Finder/Dock (rather than a terminal)
 * inherits a minimal PATH — typically `/usr/bin:/bin:/usr/sbin:/sbin` — that
 * omits every place a user-installed CLI lives (`claude`, `sfwork`, node shims).
 * A bare `claude` spawn then fails with ENOENT, the pty exits in milliseconds,
 * and the tab "opens already closed" / scheduled runs error with `exit 1` after
 * ~20ms. Launching from a terminal masks the bug because the shell PATH is
 * inherited.
 *
 * The reliable fix is to ask the user's own login shell for its PATH — the same
 * technique VS Code and the `shell-env`/`fix-path` packages use. That captures
 * wherever the CLI actually is (volta, nvm, asdf, homebrew, a custom prefix),
 * not just the handful of dirs we could guess. The guessed dirs are kept only as
 * a fallback for when the shell query fails (timeout, exotic shell, Windows).
 */

/** Known CLI install dirs — fallback only, when the shell query can't run. */
function fallbackDirs(): string[] {
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'bin')
  ];
}

/** Merge PATH fragments in priority order, dropping empties and duplicates. */
function composePath(...fragments: Array<string | undefined | null>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const frag of fragments) {
    for (const dir of (frag ?? '').split(':')) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        out.push(dir);
      }
    }
  }
  return out.join(':');
}

/** Append the fallback CLI dirs to `current` (deduped). Pure. */
export function augmentPath(current: string | undefined): string {
  return composePath(current, ...fallbackDirs());
}

/**
 * Resolve the PATH a real interactive login shell would have, by running it
 * once and printing `$PATH`. Returns null when it can't be determined (Windows,
 * missing shell, timeout) so the caller can fall back to the guessed dirs.
 *
 * `-i` (interactive) is deliberate: many users set PATH in `~/.zshrc` /
 * `~/.bashrc`, which a non-interactive shell skips. We bracket the value in
 * sentinels so rc-file banners/noise on stdout don't corrupt the parse.
 *
 * This runs synchronously on the main thread before the window opens, so the
 * timeout is also the worst-case startup-latency ceiling: a misbehaving rc can
 * delay launch by at most `timeout` ms, then we fall back to the guessed dirs.
 * stdin is `/dev/null` so a stray `read` in an rc returns EOF instead of
 * blocking; stderr is ignored so "can't access tty; job control turned off"
 * and similar interactive-shell noise can't corrupt the parse. The marker
 * strings are hardcoded constants — never interpolate user input here, or the
 * `-c` payload becomes an injection surface.
 */
function loginShellPath(): string | null {
  if (process.platform === 'win32') return null;
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__CC_PATH_START__';
  const endMarker = '__CC_PATH_END__';
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${marker}' "$PATH" '${endMarker}'`], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const start = out.indexOf(marker);
    const end = out.indexOf(endMarker);
    if (start === -1 || end === -1 || end <= start) return null;
    const value = out.slice(start + marker.length, end).trim();
    return value || null;
  } catch {
    // Shell missing, non-zero exit, or timed out — fall back to guessed dirs.
    return null;
  }
}

/**
 * Repair this process's PATH so every downstream spawn (local pty, file
 * openers, scheduler fires) can resolve user-installed CLIs. Idempotent —
 * re-running only re-dedupes. Call once at app startup, before any pty is
 * created. Order: real login-shell PATH first (authoritative), then whatever
 * PATH we were launched with, then the guessed fallback dirs as a backstop.
 */
export function ensureProcessPath(): void {
  process.env.PATH = composePath(loginShellPath(), process.env.PATH, ...fallbackDirs());
}
