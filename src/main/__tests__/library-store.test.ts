import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMemoryLibraryStore,
  LibraryStore,
  type ILibraryStore
} from '../library-store.js';
import type { LibraryAddInput, LibraryManifest } from '../../shared/types.js';

const baseInput: LibraryAddInput = {
  scope: 'global',
  relPath: 'test.md',
  title: 'Test doc',
  content: '# Hello'
};

function runSuite(label: string, make: () => Promise<ILibraryStore> | ILibraryStore) {
  describe(`LibraryStore (${label})`, () => {
    let store: ILibraryStore;
    beforeEach(async () => {
      store = await make();
    });

    it('add assigns id + timestamps and returns the doc', async () => {
      const before = Date.now();
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      expect(doc.id).toMatch(/[0-9a-f-]{36}/);
      expect(doc.createdAt).toBeGreaterThanOrEqual(before);
      expect(doc.updatedAt).toBeGreaterThanOrEqual(before);
      expect(doc.title).toBe('Test doc');
      expect(doc.kind).toBe('md');
    });

    it('rejects empty relPath', async () => {
      const doc = store.add({ ...baseInput, relPath: '' });
      expect(doc).toBeNull();
    });

    it('rejects relPath with .. (path traversal)', async () => {
      const doc = store.add({ ...baseInput, relPath: '../etc/passwd' });
      expect(doc).toBeNull();
    });

    it('rejects absolute relPath', async () => {
      const doc = store.add({ ...baseInput, relPath: '/etc/passwd' });
      expect(doc).toBeNull();
    });

    it('rejects project scope without projectId', async () => {
      const doc = store.add({ ...baseInput, scope: 'project' });
      expect(doc).toBeNull();
    });

    it('list returns newest-first by updatedAt', async () => {
      const a = store.add({ ...baseInput, title: 'first', relPath: 'a.md' });
      const b = store.add({ ...baseInput, title: 'second', relPath: 'b.md' });
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (!a || !b) return;
      const list = store.list();
      expect(list.map((d) => d.id)).toContain(a.id);
      expect(list.map((d) => d.id)).toContain(b.id);
      expect(list[0].updatedAt).toBeGreaterThanOrEqual(list[list.length - 1].updatedAt);
    });

    it('update patches title/summary/tags and bumps updatedAt', async () => {
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      const before = doc.updatedAt;
      const updated = store.update(doc.id, {
        title: 'Updated title',
        summary: 'A summary',
        tags: ['foo', 'bar']
      });
      expect(updated).not.toBeNull();
      if (!updated) return;
      expect(updated.title).toBe('Updated title');
      expect(updated.summary).toBe('A summary');
      expect(updated.tags).toEqual(['foo', 'bar']);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('update returns null for missing id', async () => {
      const updated = store.update('no-such-id', { title: 'nope' });
      expect(updated).toBeNull();
    });

    it('remove deletes the doc; missing id returns false', async () => {
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      expect(store.remove(doc.id)).toBe(true);
      expect(store.list().find((d) => d.id === doc.id)).toBeUndefined();
      expect(store.remove('no-such-id')).toBe(false);
    });

    it('onChanged fires on add/update/remove; dispose stops it', async () => {
      let fired = 0;
      const off = store.onChanged(() => fired++);
      store.add(baseInput);
      const doc = store.add({ ...baseInput, title: 'two', relPath: 'two.md' });
      if (doc) {
        store.update(doc.id, { title: 'two updated' });
        store.remove(doc.id);
      }
      off();
      store.add({ ...baseInput, title: 'after dispose', relPath: 'after.md' });
      expect(fired).toBe(4); // add, add, update, remove
    });

    it('derives kind from extension', async () => {
      const cases = [
        { relPath: 'doc.md', kind: 'md' },
        { relPath: 'paper.pdf', kind: 'pdf' },
        { relPath: 'pic.png', kind: 'image' },
        { relPath: 'photo.jpg', kind: 'image' },
        { relPath: 'script.js', kind: 'code' },
        { relPath: 'data.json', kind: 'code' },
        { relPath: 'thing.bin', kind: 'other' }
      ];
      for (const { relPath, kind } of cases) {
        const doc = store.add({ ...baseInput, relPath });
        expect(doc).not.toBeNull();
        if (!doc) continue;
        expect(doc.kind).toBe(kind);
      }
    });
  });
}

runSuite('in-memory', () => createMemoryLibraryStore());

// File-backed suite: drives the real LibraryStore against a tmp homeDir
// (the `homeDir` constructor override is exactly the testability seam saved-store
// gets via its `dir` option). This is where reconcile()/readManifest()/the atomic
// writeManifest() get real coverage — none of it is exercised by the in-memory store.
describe('LibraryStore (file-backed)', () => {
  let home: string;
  let globalDir: string;
  let store: LibraryStore;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cc-library-'));
    globalDir = join(home, '.cc-center', 'library');
    // No projects — global scope only keeps these tests focused.
    store = new LibraryStore(() => [], { homeDir: home });
  });

  afterEach(async () => {
    store.stop();
    await rm(home, { recursive: true, force: true });
  });

  async function readManifestFile(): Promise<LibraryManifest> {
    const raw = await readFile(join(globalDir, 'index.json'), 'utf8');
    return JSON.parse(raw) as LibraryManifest;
  }

  it('add writes the file + a manifest entry, then list reflects it', async () => {
    const doc = store.add({ scope: 'global', relPath: 'notes.md', title: 'Notes', content: '# Hi' });
    expect(doc).not.toBeNull();

    // File written.
    expect(await readFile(join(globalDir, 'notes.md'), 'utf8')).toBe('# Hi');
    // Manifest entry persisted.
    const manifest = await readManifestFile();
    expect(manifest.docs).toHaveLength(1);
    expect(manifest.docs[0].relPath).toBe('notes.md');

    // list() stamps scope + absPath.
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].scope).toBe('global');
    expect(listed[0].absPath).toBe(join(globalDir, 'notes.md'));
    expect(listed[0].kind).toBe('md');
  });

  it('reconcile drops a manifest entry whose file was deleted out from under it', async () => {
    const doc = store.add({ scope: 'global', relPath: 'gone.md', title: 'Gone', content: 'x' });
    expect(doc).not.toBeNull();
    expect(store.list()).toHaveLength(1);

    // Delete the backing file but leave the manifest entry behind.
    await unlink(join(globalDir, 'gone.md'));

    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'gone.md')).toBeUndefined();
  });

  it('reconcile surfaces an on-disk file missing from the manifest as untracked (id="")', async () => {
    // Drop a file directly into the library dir, no manifest entry.
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'orphan.pdf'), 'pretend-pdf');

    const listed = store.list();
    const orphan = listed.find((d) => d.relPath === 'orphan.pdf');
    expect(orphan).toBeDefined();
    expect(orphan!.id).toBe('');
    expect(orphan!.kind).toBe('pdf');
    expect(orphan!.title).toBe('orphan.pdf');
  });

  it('readManifest tolerates a corrupt index.json (returns no tracked docs, not a throw)', async () => {
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'index.json'), '{ this is not json');
    await writeFile(join(globalDir, 'real.md'), '# real');

    // Must not throw, and the on-disk file still surfaces as untracked.
    const listed = store.list();
    const real = listed.find((d) => d.relPath === 'real.md');
    expect(real).toBeDefined();
    expect(real!.id).toBe('');
  });

  it('update persists across a fresh read; remove drops the entry but keeps the file', async () => {
    const doc = store.add({ scope: 'global', relPath: 'doc.md', title: 'Old', content: 'body' });
    expect(doc).not.toBeNull();

    const updated = store.update(doc!.id, { title: 'New', tags: ['a'] });
    expect(updated?.title).toBe('New');
    expect((await readManifestFile()).docs[0].title).toBe('New');

    expect(store.remove(doc!.id)).toBe(true);
    expect((await readManifestFile()).docs).toHaveLength(0);
    // remove() is manifest-only — the file stays on disk (and resurfaces untracked).
    expect(await readFile(join(globalDir, 'doc.md'), 'utf8')).toBe('body');
    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'doc.md')?.id).toBe('');
  });

  it('writeManifest is atomic: a tmp file is never left behind', async () => {
    store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: '1' });
    store.add({ scope: 'global', relPath: 'b.md', title: 'B', content: '2' });
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(globalDir);
    expect(names.some((n) => n.includes('.tmp-'))).toBe(false);
    expect(names).toContain('index.json');
  });

  it('rejects path-traversal relPath without writing anything', async () => {
    expect(store.add({ scope: 'global', relPath: '../escape.md', title: 'Esc', content: 'x' })).toBeNull();
    expect(store.add({ scope: 'global', relPath: '/abs.md', title: 'Abs', content: 'x' })).toBeNull();
    // Nothing leaked into the library dir.
    const listed = store.list();
    expect(listed).toHaveLength(0);
  });
});
