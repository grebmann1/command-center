/**
 * InboxStore — project-anchored push surface, Linear-inbox model.
 *
 * Adapted from OpenAlice's `src/core/inbox-store.ts`. The atomic concept
 * is the **Project**, not Linear's "Issue". The agent runs inside a
 * project, and its work product is the project folder's files — not
 * single comments authored at notification time. So an inbox entry
 * carries:
 *
 *   - `docs`     pointers to files in the project ("go read these")
 *                — rendered live at view time, never snapshotted
 *   - `comments` the agent's voice — markdown, the actual message body
 *                ("hey boss, here's what I want to say about it")
 *
 * Both are optional but at least one must be present. Pointer-only on
 * docs is deliberate: the project folder is its own version-controlled
 * source of truth, so snapshotting into the inbox would just create a
 * stale parallel copy. Project deletion → inbox tombstones; that's
 * correct semantics, not a lifecycle bug.
 *
 * Persistence: append-only JSONL at `~/.cc-center/inbox/entries.jsonl`,
 * `projectId` required, at least one of {docs, comments} required.
 * Atomic delete via tmp + rename (matches the pattern in `store.ts`).
 */

import { randomUUID } from 'node:crypto';
import { readFile, appendFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { InboxDoc, InboxEntry } from '../shared/types.js';

export type { InboxDoc, InboxEntry } from '../shared/types.js';

export interface InboxInput {
  projectId: string;
  /** Display snapshot of the project label. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /** Project files to render. Each entry is a pointer — content is fetched live at view time. */
  docs?: InboxDoc[];
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string;
  /** Originating terminal session, when known. Persisted as-is on the entry. */
  sessionId?: string;
  /** True when the push came from a scheduled (background) run. */
  scheduled?: boolean;
}

export interface InboxReadOpts {
  limit?: number;
  before?: string;
  projectId?: string;
}

export interface IInboxStore {
  append(input: InboxInput): Promise<InboxEntry>;
  read(opts?: InboxReadOpts): Promise<{ entries: InboxEntry[]; hasMore: boolean }>;
  /**
   * Hard-delete an entry by id. Returns true if removed, false if no
   * entry matched. JSONL rewrites are atomic (tmp + rename).
   */
  delete(id: string): Promise<boolean>;
  /**
   * Hard-delete many entries in a single atomic rewrite. Takes an explicit
   * id list (the entries to REMOVE) — never "keep only these" — so an entry
   * appended concurrently with a clear can't be deleted by accident. Emits
   * one `removed` event per deleted id. Returns the count removed.
   */
  deleteMany(ids: string[]): Promise<number>;
  onAppended(listener: (entry: InboxEntry) => void): () => void;
  /** Subscribe to live removals. Returns a dispose function. */
  onRemoved(listener: (id: string) => void): () => void;
}

/** Default on-disk JSONL path: `~/.cc-center/inbox/entries.jsonl`. */
export const DEFAULT_INBOX_FILE = join(homedir(), '.cc-center', 'inbox', 'entries.jsonl');

// ==================== Validation ====================

function validateInput(input: InboxInput): void {
  if (!input.projectId) {
    throw new Error('InboxStore.append: projectId is required');
  }
  const hasDocs = (input.docs?.length ?? 0) > 0;
  const hasComments = (input.comments ?? '').trim().length > 0;
  if (!hasDocs && !hasComments) {
    throw new Error('InboxStore.append: at least one of docs or comments must be present');
  }
  if (input.docs) {
    for (const d of input.docs) {
      if (!d.path || typeof d.path !== 'string') {
        throw new Error('InboxStore.append: each doc must have a non-empty `path` string');
      }
    }
  }
}

// ==================== JSONL store ====================

export interface InboxStoreOptions {
  /** Override the JSONL file path (defaults to `~/.cc-center/inbox/entries.jsonl`). */
  filePath?: string;
}

export function createInboxStore(opts: InboxStoreOptions = {}): IInboxStore {
  const filePath = opts.filePath ?? DEFAULT_INBOX_FILE;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input);
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + '\n');
    emitter.emit('appended', entry);
    return entry;
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], hasMore: false };
      }
      throw err;
    }

    let all = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as InboxEntry);

    if (opts.projectId) {
      all = all.filter((e) => e.projectId === opts.projectId);
    }

    let scoped = all;
    if (opts.before) {
      const idx = all.findIndex((e) => e.id === opts.before);
      scoped = idx >= 0 ? all.slice(0, idx) : [];
    }

    const limit = opts.limit ?? 100;
    const window = scoped.slice(-limit);
    const entries = [...window].reverse();
    const hasMore = window.length < scoped.length;
    return { entries, hasMore };
  }

  async function deleteEntry(id: string): Promise<boolean> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.trim());
    let removed = false;
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as InboxEntry;
        if (entry.id === id) {
          removed = true;
          continue;
        }
        kept.push(line);
      } catch {
        // Preserve unparseable lines so a malformed entry can't be used to
        // accidentally wipe the file via delete().
        kept.push(line);
      }
    }
    if (!removed) return false;

    // Atomic rewrite — tmp + rename. Crash mid-write leaves the previous
    // file intact instead of producing a half-truncated JSONL. Matches
    // the pattern in `src/main/store.ts`.
    const tmp = `${filePath}.tmp`;
    const body = kept.length > 0 ? kept.join('\n') + '\n' : '';
    await writeFile(tmp, body, 'utf-8');
    await rename(tmp, filePath);
    emitter.emit('removed', id);
    return true;
  }

  async function deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const remove = new Set(ids);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.trim());
    const removedIds: string[] = [];
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as InboxEntry;
        if (remove.has(entry.id)) {
          removedIds.push(entry.id);
          continue;
        }
        kept.push(line);
      } catch {
        // Preserve unparseable lines — a malformed entry can't be targeted.
        kept.push(line);
      }
    }
    if (removedIds.length === 0) return 0;

    const tmp = `${filePath}.tmp`;
    const body = kept.length > 0 ? kept.join('\n') + '\n' : '';
    await writeFile(tmp, body, 'utf-8');
    await rename(tmp, filePath);
    for (const id of removedIds) emitter.emit('removed', id);
    return removedIds.length;
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener);
    return () => {
      emitter.off('appended', listener);
    };
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener);
    return () => {
      emitter.off('removed', listener);
    };
  }

  return { append, read, delete: deleteEntry, deleteMany, onAppended, onRemoved };
}

// ==================== In-memory store (tests) ====================

export function createMemoryInboxStore(): IInboxStore {
  const entries: InboxEntry[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input);
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    entries.push(entry);
    emitter.emit('appended', entry);
    return entry;
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let scoped = opts.projectId ? entries.filter((e) => e.projectId === opts.projectId) : entries;
    if (opts.before) {
      const idx = scoped.findIndex((e) => e.id === opts.before);
      scoped = idx >= 0 ? scoped.slice(0, idx) : [];
    }
    const limit = opts.limit ?? 100;
    const window = scoped.slice(-limit);
    return { entries: [...window].reverse(), hasMore: window.length < scoped.length };
  }

  async function deleteEntry(id: string): Promise<boolean> {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    entries.splice(idx, 1);
    emitter.emit('removed', id);
    return true;
  }

  async function deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const remove = new Set(ids);
    const removedIds = entries.filter((e) => remove.has(e.id)).map((e) => e.id);
    if (removedIds.length === 0) return 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (remove.has(entries[i].id)) entries.splice(i, 1);
    }
    for (const id of removedIds) emitter.emit('removed', id);
    return removedIds.length;
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener);
    return () => {
      emitter.off('appended', listener);
    };
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener);
    return () => {
      emitter.off('removed', listener);
    };
  }

  return { append, read, delete: deleteEntry, deleteMany, onAppended, onRemoved };
}
