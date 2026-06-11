import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { FsEntry, FsReadResult, FsWriteResult, FsReadDataUrlResult, SearchHit, SearchResult, SearchOptions } from '../shared/types.js';

const DENY = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.DS_Store'
]);

const MAX_ENTRIES = 2000;

export function listDir(absPath: string): FsEntry[] {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(absPath, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }

  const out: FsEntry[] = [];
  for (const d of dirents) {
    if (DENY.has(d.name)) continue;
    const full = join(absPath, d.name);
    let kind: 'file' | 'dir';
    if (d.isSymbolicLink()) {
      try {
        kind = statSync(full).isDirectory() ? 'dir' : 'file';
      } catch {
        continue;
      }
    } else {
      kind = d.isDirectory() ? 'dir' : 'file';
    }
    out.push({ name: d.name, kind, path: full });
    if (out.length >= MAX_ENTRIES) break;
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

export function readFile(absPath: string): FsReadResult {
  let stats;
  try {
    stats = statSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!stats.isFile()) return { ok: false, message: 'Not a file' };

  const fullBytes = stats.size;
  const readBytes = Math.min(fullBytes, MAX_FILE_BYTES);
  const buf = Buffer.alloc(readBytes);
  let fd: number | null = null;
  try {
    fd = openSync(absPath, 'r');
    readSync(fd, buf, 0, readBytes, 0);
  } catch (err) {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  closeSync(fd);

  // Heuristic: NUL byte in first 8 KB => binary
  const probe = buf.subarray(0, Math.min(8192, buf.length));
  const binary = probe.includes(0);
  if (binary) {
    return { ok: true, binary: true, bytes: fullBytes };
  }
  return {
    ok: true,
    content: buf.toString('utf8'),
    bytes: fullBytes,
    truncated: fullBytes > MAX_FILE_BYTES,
    binary: false
  };
}

// Cap writes at the same 2MB read cap — anything larger is almost certainly
// a binary or generated artifact that has no business being edited inline.
export function writeFile(absPath: string, content: string): FsWriteResult {
  const buf = Buffer.from(content, 'utf8');
  if (buf.byteLength > MAX_FILE_BYTES) {
    return { ok: false, message: `File too large (${buf.byteLength} > ${MAX_FILE_BYTES})` };
  }
  // Refuse paths that don't already exist as a regular file. The editor only
  // opens files it read first, so this is a sanity check, not a creation API.
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return { ok: false, message: 'Not a regular file' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  try {
    writeFileSync(absPath, buf);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, bytes: buf.byteLength };
}

const MAX_WALK_FILES = 8000;
const MAX_WALK_DEPTH = 12;

export interface WalkedFile {
  /** path relative to root, posix-style */
  rel: string;
  /** absolute path */
  path: string;
}

export function walkFiles(root: string): WalkedFile[] {
  const out: WalkedFile[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && out.length < MAX_WALK_FILES) {
    const { dir, depth } = stack.pop()!;
    if (depth > MAX_WALK_DEPTH) continue;
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (DENY.has(d.name)) continue;
      const full = join(dir, d.name);
      let isDir = d.isDirectory();
      let isFile = d.isFile();
      if (d.isSymbolicLink()) {
        try {
          const st = statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (isFile) {
        out.push({ rel: relative(root, full).split('\\').join('/'), path: full });
        if (out.length >= MAX_WALK_FILES) break;
      }
    }
  }
  return out;
}

const SEARCH_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
const SEARCH_MAX_HITS = 500;
const SEARCH_MAX_HITS_PER_FILE = 20;
const SEARCH_LINE_TRUNC = 240;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchFiles(
  root: string,
  query: string,
  opts: SearchOptions = {}
): SearchResult {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], scanned: 0, truncated: false };

  let re: RegExp;
  try {
    const pattern = opts.regex ? trimmed : escapeRegex(trimmed);
    const flags = opts.caseSensitive ? 'g' : 'gi';
    re = new RegExp(pattern, flags);
  } catch {
    return { hits: [], scanned: 0, truncated: false };
  }

  const files = walkFiles(root);
  const hits: SearchHit[] = [];
  let scanned = 0;
  let truncated = false;

  outer: for (const f of files) {
    let stat;
    try {
      stat = statSync(f.path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > SEARCH_MAX_FILE_BYTES) continue;

    let buf: Buffer;
    try {
      buf = readFileSync(f.path);
    } catch {
      continue;
    }
    // Skip binary files: NUL byte in first 8 KB.
    const probe = buf.subarray(0, Math.min(8192, buf.length));
    if (probe.includes(0)) continue;

    scanned++;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    let perFile = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      const m = re.exec(line);
      if (!m) continue;
      const truncatedLine =
        line.length > SEARCH_LINE_TRUNC ? line.slice(0, SEARCH_LINE_TRUNC) + '…' : line;
      hits.push({
        rel: f.rel,
        path: f.path,
        line: i + 1,
        column: m.index + 1,
        match: m[0],
        preview: truncatedLine
      });
      perFile++;
      if (hits.length >= SEARCH_MAX_HITS) {
        truncated = true;
        break outer;
      }
      if (perFile >= SEARCH_MAX_HITS_PER_FILE) break;
    }
  }

  return { hits, scanned, truncated };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function mimeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === '.png') return 'image/png';
  if (lower === '.jpg' || lower === '.jpeg') return 'image/jpeg';
  if (lower === '.gif') return 'image/gif';
  if (lower === '.webp') return 'image/webp';
  if (lower === '.svg') return 'image/svg+xml';
  if (lower === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

export function readDataUrl(absPath: string): FsReadDataUrlResult {
  let stats;
  try {
    stats = statSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!stats.isFile()) return { ok: false, message: 'Not a file' };
  if (stats.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: `File too large (${stats.size} > ${MAX_IMAGE_BYTES})` };
  }

  let buf: Buffer;
  try {
    buf = readFileSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const ext = extname(absPath);
  const mime = mimeFromExt(ext);
  const b64 = buf.toString('base64');
  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, bytes: buf.byteLength };
}
