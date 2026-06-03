import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { GitDiscardResult, GitFileCode, GitShowResult, GitStatus } from '../shared/types.js';

const TIMEOUT_MS = 1500;

function findToplevel(start: string): string | null {
  let dir = start;
  while (true) {
    if (existsSync(`${dir}/.git`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
  const toplevel = findToplevel(cwd);
  if (!toplevel) return null;

  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '--branch', '-z'],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const status = parsePorcelainV2(stdout, toplevel);
        resolve(status);
      }
    );
  });
}

// Cap the HEAD blob we'll ship to the renderer so a giant tracked binary or
// minified bundle doesn't blow up the diff view.
const SHOW_MAX_BYTES = 2 * 1024 * 1024;

export async function showHead(absPath: string): Promise<GitShowResult> {
  if (!absPath || typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, message: 'Invalid path' };
  }
  const toplevel = findToplevel(absPath);
  if (!toplevel) return { ok: false, message: 'Not in a git repo' };
  const rel = relative(toplevel, absPath).split('\\').join('/');
  if (!rel || rel.startsWith('..')) {
    return { ok: false, message: 'Path is outside the repo' };
  }

  return new Promise((resolve) => {
    execFile(
      'git',
      ['show', `HEAD:${rel}`],
      {
        cwd: toplevel,
        timeout: TIMEOUT_MS,
        maxBuffer: SHOW_MAX_BYTES,
        encoding: 'buffer'
      },
      (err, stdout, stderr) => {
        if (err) {
          // git exits non-zero when the path doesn't exist at HEAD (e.g. newly
          // added file). Fall through and surface that as `notInHead` so the
          // renderer can show "added" instead of an opaque error.
          const msg = String(stderr || (err as Error).message);
          if (/exists on disk, but not in 'HEAD'|does not exist|bad revision/i.test(msg)) {
            resolve({ ok: true, notInHead: true });
            return;
          }
          resolve({ ok: false, message: msg.trim() || 'git show failed' });
          return;
        }
        const buf = stdout as unknown as Buffer;
        const probe = buf.subarray(0, Math.min(8192, buf.length));
        if (probe.includes(0)) {
          resolve({ ok: true, binary: true });
          return;
        }
        resolve({ ok: true, content: buf.toString('utf8') });
      }
    );
  });
}

function runGit(toplevel: string, args: string[]): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = String(stderr || (err as Error).message).trim();
          resolve({ ok: false, message: msg || 'git command failed' });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

// Discard local changes to a single file. Behaviour depends on the file's
// current git state — untracked files are unlinked, staged-add files are
// unstaged + unlinked, and tracked changes (modified/deleted/renamed) are
// restored from HEAD.
export async function discardChanges(absPath: string): Promise<GitDiscardResult> {
  if (!absPath || typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, message: 'Invalid path' };
  }
  const toplevel = findToplevel(absPath);
  if (!toplevel) return { ok: false, message: 'Not in a git repo' };
  const rel = relative(toplevel, absPath).split('\\').join('/');
  if (!rel || rel.startsWith('..')) {
    return { ok: false, message: 'Path is outside the repo' };
  }

  // Probe per-file status so we know which dance to do.
  const statusResult = await new Promise<{ xy: string | null; err?: string }>((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '-z', '--', rel],
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ xy: null, err: String(stderr || (err as Error).message).trim() });
          return;
        }
        // First entry is enough — we asked for one path. Parse the leading
        // record's xy if it's a "1" or "2" line; "?" => untracked.
        const out = String(stdout);
        const first = out.split('\0').find((p) => p.length > 0);
        if (!first) {
          resolve({ xy: null });
          return;
        }
        if (first.startsWith('? ')) {
          resolve({ xy: '??' });
          return;
        }
        if (first.startsWith('1 ') || first.startsWith('2 ')) {
          resolve({ xy: first.slice(2, 4) });
          return;
        }
        resolve({ xy: null });
      }
    );
  });

  if (statusResult.err) return { ok: false, message: statusResult.err };
  const xy = statusResult.xy;
  if (!xy) return { ok: false, message: 'No changes to discard' };

  // Untracked → just delete the working-tree file.
  if (xy === '??') {
    try {
      unlinkSync(absPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Staged-add (A in X column) → unstage, then unlink. `git checkout HEAD --`
  // won't work because the file doesn't exist at HEAD.
  if (xy[0] === 'A') {
    const reset = await runGit(toplevel, ['reset', 'HEAD', '--', rel]);
    if (!reset.ok) return reset;
    try {
      if (existsSync(absPath)) unlinkSync(absPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Everything else (M, D, R, T in either column) → restore from HEAD. This
  // also unstages any staged changes for the file in one shot.
  return runGit(toplevel, ['checkout', 'HEAD', '--', rel]);
}

function parsePorcelainV2(out: string, toplevel: string): GitStatus {
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  const files: Record<string, GitFileCode> = {};

  // Worst-of-XY: when staged and unstaged statuses differ, surface the more
  // important one. Order: M < A < R < D so deletes/renames win over edits,
  // additions win over modifications.
  const rank: Record<string, number> = { M: 1, A: 2, R: 3, D: 4 };
  const recordFile = (abs: string, code: GitFileCode) => {
    const prev = files[abs];
    if (!prev) {
      files[abs] = code;
      return;
    }
    if ((rank[code] ?? 0) > (rank[prev] ?? 0)) files[abs] = code;
  };

  const xyToCode = (xy: string): GitFileCode | null => {
    // xy is two chars: staged + unstaged. '.' means unchanged.
    const X = xy[0];
    const Y = xy[1];
    const pick = (c: string): GitFileCode | null => {
      if (c === 'M' || c === 'T') return 'M';
      if (c === 'A') return 'A';
      if (c === 'D') return 'D';
      if (c === 'R' || c === 'C') return 'R';
      return null;
    };
    return pick(Y) ?? pick(X);
  };

  // -z separates entries with NUL. Header lines start with '#' and are line-based
  // (newline-terminated within their own segment); entry records start with
  // '1', '2', '?', or 'u'. Rename entries (type '2') contain an additional NUL.
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('# branch.head ')) {
      const name = p.slice('# branch.head '.length).trim();
      if (name === '(detached)') {
        detached = true;
        branch = null;
      } else {
        branch = name;
      }
      continue;
    }
    if (p.startsWith('# branch.oid ')) {
      // ignore; only useful when detached, and we don't surface SHA yet
      continue;
    }
    if (p.startsWith('# branch.ab ')) {
      const m = p.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10) || 0;
        behind = parseInt(m[2], 10) || 0;
      }
      continue;
    }
    if (p.startsWith('#')) continue;

    const c = p.charCodeAt(0);
    if (c === 49 /* '1' */) {
      // "1 XY <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      dirty = true;
      const xy = p.slice(2, 4);
      const code = xyToCode(xy);
      const path = p.split(' ').slice(8).join(' ');
      if (code && path) recordFile(join(toplevel, path), code);
      continue;
    }
    if (c === 50 /* '2' */) {
      // "2 XY <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>"
      // followed by a NUL then "<orig-path>".
      dirty = true;
      const xy = p.slice(2, 4);
      const code = xyToCode(xy);
      const path = p.split(' ').slice(9).join(' ');
      if (code && path) recordFile(join(toplevel, path), code);
      i++; // consume original-path field
      continue;
    }
    if (c === 63 /* '?' */) {
      // "? <path>"
      dirty = true;
      const path = p.slice(2);
      if (path) recordFile(join(toplevel, path), '?');
      continue;
    }
    if (c === 117 /* 'u' */) {
      // "u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      dirty = true;
      const path = p.split(' ').slice(10).join(' ');
      if (path) recordFile(join(toplevel, path), 'C');
      continue;
    }
  }

  return { branch, detached, ahead, behind, dirty, toplevel, files };
}
