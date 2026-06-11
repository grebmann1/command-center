/**
 * LibraryStore — durable document storage (md, pdf, images, code snippets).
 *
 * Storage is dual-scope (mirrors TemplateStore):
 *  - Global: `~/.cc-center/library/` (user-wide, survives project deletion)
 *  - Project: `<project.path>/.cc-center/library/` (git-trackable)
 *
 * Each dir contains:
 *  - Real files on disk (actual content: .md, .pdf, .png, etc.)
 *  - One manifest: `index.json` (LibraryManifest) — rolled-up metadata
 *
 * Manifest entries are reconciled on read: missing-file entries are dropped;
 * on-disk files missing from the manifest are surfaced as untracked (kind
 * from ext, no id yet) so nothing is invisible.
 *
 * fs.watch on both dirs + debounced refresh + error/re-attach (copied from
 * template-store.ts). EventEmitter + onChanged full-list pattern (like saved).
 */

import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  statSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join, relative, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Project,
  LibraryDoc,
  LibraryManifest,
  LibraryAddInput,
  LibraryScope
} from '../shared/types.js';

export type { LibraryDoc, LibraryManifest, LibraryAddInput } from '../shared/types.js';

const projectLibraryDir = (project: Project) =>
  join(project.path, '.cc-center', 'library');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Derive kind from file extension. */
function kindFromExt(ext: string): LibraryDoc['kind'] {
  const lower = ext.toLowerCase();
  if (lower === '.md' || lower === '.markdown') return 'md';
  if (lower === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(lower)) return 'image';
  if (['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.sql'].includes(lower)) {
    return 'code';
  }
  return 'other';
}

/** Path-traversal guard: reject relPath that escapes the library dir. */
function validateRelPath(relPath: string): void {
  if (!relPath || relPath.trim() === '') {
    throw new Error('relPath is required');
  }
  const normalized = relPath.split('\\').join('/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('relPath must be relative, not absolute');
  }
  if (normalized.includes('..')) {
    throw new Error('relPath must not contain ".." (path traversal)');
  }
}

/**
 * Tolerant manifest reader. Returns empty manifest if the file is missing,
 * corrupt, or has an invalid shape. Never throws to caller.
 */
function readManifest(dir: string): LibraryManifest {
  const path = join(dir, 'index.json');
  if (!existsSync(path)) return { version: 1, docs: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LibraryManifest>;
    if (!raw || typeof raw !== 'object') return { version: 1, docs: [] };
    if (!Array.isArray(raw.docs)) return { version: 1, docs: [] };
    // Defensive filter: skip docs with missing required fields.
    const docs = raw.docs.filter(
      (d: Partial<LibraryDoc>) =>
        d &&
        typeof d.id === 'string' &&
        typeof d.relPath === 'string' &&
        typeof d.title === 'string' &&
        typeof d.kind === 'string' &&
        typeof d.createdAt === 'number' &&
        typeof d.updatedAt === 'number'
    ) as LibraryDoc[];
    return { version: 1, docs };
  } catch {
    return { version: 1, docs: [] };
  }
}

/**
 * Atomic manifest write: tmp + rename. The dir is already ensured by the
 * caller (add/update/remove).
 */
function writeManifest(dir: string, manifest: LibraryManifest): void {
  ensureDir(dir);
  const path = join(dir, 'index.json');
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  // Atomic replace: rename overwrites the target in a single fs op (POSIX),
  // so a crash mid-write can never leave a missing/half-written manifest —
  // matches the tmp+rename pattern in saved-store.ts. renameSync overwrites
  // an existing destination on both POSIX and Windows.
  renameSync(tmp, path);
}

/**
 * Reconcile manifest + on-disk files:
 *  - Drop manifest entries whose file is gone.
 *  - Surface on-disk files missing from the manifest (untracked).
 */
function reconcile(dir: string, manifest: LibraryManifest): LibraryDoc[] {
  const out: LibraryDoc[] = [];
  const seen = new Set<string>();

  // Manifest entries that still have a file on disk.
  for (const doc of manifest.docs) {
    const absPath = join(dir, doc.relPath);
    if (existsSync(absPath)) {
      out.push(doc);
      seen.add(doc.relPath);
    }
  }

  // On-disk files missing from manifest → untracked entries (no id).
  if (!existsSync(dir)) return out;
  const names = readdirSync(dir);
  for (const name of names) {
    if (name === 'index.json') continue;
    const absPath = join(dir, name);
    let st;
    try {
      st = statSync(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const relPath = name;
    if (seen.has(relPath)) continue;
    // Untracked file: surface with kind from ext, no id.
    const ext = extname(name);
    const kind = kindFromExt(ext);
    out.push({
      id: '',
      relPath,
      title: name,
      kind,
      createdAt: st.ctimeMs,
      updatedAt: st.mtimeMs,
      bytes: st.size
    });
  }

  return out;
}

export interface LibraryStoreOptions {
  /**
   * Override the home directory used for the global library dir
   * (`<homeDir>/.cc-center/library`). Defaults to electron's
   * `app.getPath('home')`. Exists so the file-backed path is testable
   * without electron — mirrors the `dir` override on SavedStore.
   */
  homeDir?: string;
}

export class LibraryStore extends EventEmitter {
  private projectsRef: () => Project[];
  private homeDir: string | null;
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[], opts: LibraryStoreOptions = {}) {
    super();
    this.projectsRef = projectsRef;
    this.homeDir = opts.homeDir ?? null;
  }

  start() {
    const dir = this.userDir();
    ensureDir(dir);
    this.attachUserWatcher();
    this.attachProjectWatchers();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  userDir(): string {
    return join(this.homeDir ?? app.getPath('home'), '.cc-center', 'library');
  }

  projectDir(project: Project): string {
    return projectLibraryDir(project);
  }

  /**
   * List all docs from both scopes, stamped with scope/absPath/projectId.
   * Reconciles on read: drops missing-file entries, surfaces untracked files.
   * Returns newest-first by updatedAt.
   */
  list(): LibraryDoc[] {
    const out: LibraryDoc[] = [];

    // Global scope.
    const globalDir = this.userDir();
    const globalManifest = readManifest(globalDir);
    const globalDocs = reconcile(globalDir, globalManifest);
    for (const doc of globalDocs) {
      out.push({
        ...doc,
        scope: 'global',
        absPath: join(globalDir, doc.relPath)
      });
    }

    // Per-project scope.
    for (const project of this.projectsRef()) {
      const projectDir = projectLibraryDir(project);
      const projectManifest = readManifest(projectDir);
      const projectDocs = reconcile(projectDir, projectManifest);
      for (const doc of projectDocs) {
        out.push({
          ...doc,
          scope: 'project',
          absPath: join(projectDir, doc.relPath),
          projectId: project.id,
          projectName: project.name
        });
      }
    }

    // Sort newest-first by updatedAt.
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  /**
   * Add a new doc. Writes the file (if content given), appends manifest entry,
   * emits 'changed'. Returns the created doc or null on failure.
   */
  add(input: LibraryAddInput): LibraryDoc | null {
    try {
      validateRelPath(input.relPath);
      if (input.scope === 'project' && !input.projectId) {
        throw new Error('projectId is required for project-scope docs');
      }

      const dir =
        input.scope === 'global'
          ? this.userDir()
          : (() => {
              const project = this.projectsRef().find((p) => p.id === input.projectId);
              if (!project) throw new Error(`Project not found: ${input.projectId}`);
              return projectLibraryDir(project);
            })();

      ensureDir(dir);
      const absPath = join(dir, input.relPath);

      // Write file content if given.
      if (input.content !== undefined) {
        const parentDir = join(absPath, '..');
        ensureDir(parentDir);
        writeFileSync(absPath, input.content, 'utf8');
      }

      // Read file stats (size, timestamps) for the manifest entry.
      let bytes = 0;
      let createdAt = Date.now();
      let updatedAt = Date.now();
      if (existsSync(absPath)) {
        const st = statSync(absPath);
        bytes = st.size;
        createdAt = st.ctimeMs;
        updatedAt = st.mtimeMs;
      }

      const ext = extname(input.relPath);
      const kind = kindFromExt(ext);

      const doc: LibraryDoc = {
        id: randomUUID(),
        relPath: input.relPath,
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        kind,
        createdAt,
        updatedAt,
        bytes,
        source: input.source
      };

      // Append to manifest.
      const manifest = readManifest(dir);
      manifest.docs.push(doc);
      writeManifest(dir, manifest);

      this.emit('changed');
      return doc;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] add failed:', err);
      return null;
    }
  }

  /**
   * Update a doc's metadata (title/summary/tags). Finds the doc in either
   * scope, patches it, rewrites the manifest. Returns the updated doc or null.
   */
  update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null {
    try {
      // Find the doc in global scope.
      const globalDir = this.userDir();
      const globalManifest = readManifest(globalDir);
      const globalIdx = globalManifest.docs.findIndex((d) => d.id === id);
      if (globalIdx >= 0) {
        const doc = globalManifest.docs[globalIdx];
        if (patch.title !== undefined) doc.title = patch.title;
        if (patch.summary !== undefined) doc.summary = patch.summary;
        if (patch.tags !== undefined) doc.tags = patch.tags;
        doc.updatedAt = Date.now();
        writeManifest(globalDir, globalManifest);
        this.emit('changed');
        return doc;
      }

      // Find the doc in project scopes.
      for (const project of this.projectsRef()) {
        const projectDir = projectLibraryDir(project);
        const projectManifest = readManifest(projectDir);
        const projectIdx = projectManifest.docs.findIndex((d) => d.id === id);
        if (projectIdx >= 0) {
          const doc = projectManifest.docs[projectIdx];
          if (patch.title !== undefined) doc.title = patch.title;
          if (patch.summary !== undefined) doc.summary = patch.summary;
          if (patch.tags !== undefined) doc.tags = patch.tags;
          doc.updatedAt = Date.now();
          writeManifest(projectDir, projectManifest);
          this.emit('changed');
          return doc;
        }
      }

      return null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] update failed:', err);
      return null;
    }
  }

  /**
   * Remove a doc by id. Removes from manifest (does NOT unlink the file).
   * Returns true if removed, false if not found.
   */
  remove(id: string): boolean {
    try {
      // Try global scope.
      const globalDir = this.userDir();
      const globalManifest = readManifest(globalDir);
      const globalIdx = globalManifest.docs.findIndex((d) => d.id === id);
      if (globalIdx >= 0) {
        globalManifest.docs.splice(globalIdx, 1);
        writeManifest(globalDir, globalManifest);
        this.emit('changed');
        return true;
      }

      // Try project scopes.
      for (const project of this.projectsRef()) {
        const projectDir = projectLibraryDir(project);
        const projectManifest = readManifest(projectDir);
        const projectIdx = projectManifest.docs.findIndex((d) => d.id === id);
        if (projectIdx >= 0) {
          projectManifest.docs.splice(projectIdx, 1);
          writeManifest(projectDir, projectManifest);
          this.emit('changed');
          return true;
        }
      }

      return false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] remove failed:', err);
      return false;
    }
  }

  /**
   * Open the library dir in Finder/Explorer. For project scope, needs a
   * projectId; for global, omit it.
   */
  async revealDir(
    scope: LibraryScope,
    projectId?: string
  ): Promise<{ ok: boolean; path: string; message?: string }> {
    try {
      const dir =
        scope === 'global'
          ? this.userDir()
          : (() => {
              if (!projectId) throw new Error('projectId is required for project-scope reveal');
              const project = this.projectsRef().find((p) => p.id === projectId);
              if (!project) throw new Error(`Project not found: ${projectId}`);
              return projectLibraryDir(project);
            })();
      ensureDir(dir);
      await shell.openPath(dir);
      return { ok: true, path: dir };
    } catch (err) {
      return {
        ok: false,
        path: '',
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Hook for store.addProject / store.removeProject. Re-attach project
   * watchers and emit a changed event so the renderer picks up the new
   * project's docs or drops the removed project's docs.
   */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.scheduleRefresh();
  }

  /**
   * Subscribe to change events. Returns a dispose function.
   */
  onChanged(listener: () => void): () => void {
    this.on('changed', listener);
    return () => this.off('changed', listener);
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = this.userDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[library-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(this.userDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // Watcher unsupported on this fs — fall back to refresh-on-demand.
    }
  }

  private attachProjectWatchers() {
    for (const project of this.projectsRef()) {
      const dir = projectLibraryDir(project);
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[library-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.emit('changed');
    }, 150);
  }
}

// ==================== In-memory store (tests) ====================

export function createMemoryLibraryStore(): ILibraryStore {
  const docs: LibraryDoc[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function snapshot(): LibraryDoc[] {
    return [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function list(): LibraryDoc[] {
    return snapshot();
  }

  function add(input: LibraryAddInput): LibraryDoc | null {
    try {
      validateRelPath(input.relPath);
      if (input.scope === 'project' && !input.projectId) {
        throw new Error('projectId is required for project-scope docs');
      }
      const ext = extname(input.relPath);
      const kind = kindFromExt(ext);
      const doc: LibraryDoc = {
        id: randomUUID(),
        relPath: input.relPath,
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        kind,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: input.source,
        scope: input.scope,
        absPath: `/fake/${input.relPath}`,
        projectId: input.projectId
      };
      docs.push(doc);
      emitter.emit('changed');
      return doc;
    } catch {
      return null;
    }
  }

  function update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return null;
    if (patch.title !== undefined) doc.title = patch.title;
    if (patch.summary !== undefined) doc.summary = patch.summary;
    if (patch.tags !== undefined) doc.tags = patch.tags;
    doc.updatedAt = Date.now();
    emitter.emit('changed');
    return doc;
  }

  function remove(id: string): boolean {
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    docs.splice(idx, 1);
    emitter.emit('changed');
    return true;
  }

  async function revealDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    return { ok: true, path: '/fake/library' };
  }

  function onChanged(listener: () => void): () => void {
    emitter.on('changed', listener);
    return () => emitter.off('changed', listener);
  }

  return { list, add, update, remove, revealDir, onChanged };
}

export interface ILibraryStore {
  start?(): void;
  stop?(): void;
  rebindProjects?(): void;
  list(): LibraryDoc[];
  add(input: LibraryAddInput): LibraryDoc | null;
  update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null;
  remove(id: string): boolean;
  revealDir(
    scope: LibraryScope,
    projectId?: string
  ): Promise<{ ok: boolean; path: string; message?: string }>;
  onChanged(listener: () => void): () => void;
}
