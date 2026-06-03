import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, MessageSquare, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  deleteInboxEntry,
  useData,
  useInbox,
  useInboxRead,
  useInboxSelection,
  useUi
} from '../store';
import type { InboxDoc, InboxEntry, FsReadResult, Project } from '@shared/types';

interface InboxDetailProps {
  /**
   * Gates the page-level Delete/Backspace shortcut so the inbox view only
   * intercepts when it's actually visible (matches OpenAlice's gating).
   */
  visible: boolean;
}

/**
 * Inbox detail pane — port of OpenAlice's InboxPage.tsx Detail component.
 *
 * Header (project label · timestamp · trash button) on top, docs (live
 * fetch via cc.fs.readFile) below, comments (markdown) at the bottom.
 *
 * Selection is owned by useInboxSelection; the sidebar drives it. Read-state
 * mutation happens at the sidebar selection site — this pane just renders
 * whatever is selected. Delete is owned here because it needs the full
 * entry list to advance selection after removal.
 */
export function InboxDetail({ visible }: InboxDetailProps) {
  const entries = useInbox((s) => s.entries);
  const loading = useInbox((s) => s.loading);
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const markRead = useInboxRead((s) => s.markRead);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  /**
   * Hard-delete an entry. Optimistically removes from local state, advances
   * selection to the next-older entry (or previous if last), then fires
   * the IPC. The main process echoes the removal back via `onRemoved` —
   * a no-op locally because we already filtered.
   */
  const handleDelete = useCallback(
    async (id: string) => {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx < 0) return;

      // entries are newest-first; "the one after this" is the next older.
      const nextId = entries[idx + 1]?.id ?? entries[idx - 1]?.id ?? null;

      if (nextId) {
        select(nextId);
        markRead(nextId);
      } else {
        select(null);
      }

      await deleteInboxEntry(id);
    },
    [entries, select, markRead]
  );

  useEffect(() => {
    if (!visible) return;
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      void handleDelete(selectedId!);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId, handleDelete]);

  if (loading && entries.length === 0) {
    return <div className="inbox-detail-empty">Loading…</div>;
  }
  if (entries.length === 0) {
    return <EmptyState />;
  }
  if (!selected) {
    return <div className="inbox-detail-empty">Select an entry from the sidebar.</div>;
  }
  return <Detail entry={selected} onDelete={() => handleDelete(selected.id)} />;
}

function EmptyState() {
  return (
    <div className="inbox-detail-empty-state">
      <div className="inbox-detail-empty-title">No inbox messages yet</div>
      <p className="inbox-detail-empty-body">
        Projects will push status updates here as they work — finished
        analyses, blocked tasks, questions back to you.
      </p>
    </div>
  );
}

function Detail({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const projects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const selectProject = useUi((s) => s.selectProject);

  const aliveProject = projects.find((p) => p.id === entry.projectId) ?? null;
  const projectAlive = aliveProject !== null;
  const displayLabel =
    aliveProject?.name ?? entry.projectLabel ?? entry.projectId;

  const hasDocs = (entry.docs?.length ?? 0) > 0;
  const hasComments = (entry.comments ?? '').trim().length > 0;

  const openProject = () => {
    if (!aliveProject) return;
    selectProject(aliveProject.id);
    setNav('projects');
  };

  return (
    <div className="inbox-detail">
      <div className="inbox-detail-header">
        <span
          className={`inbox-detail-label ${projectAlive ? '' : 'tombstoned'}`}
          title={projectAlive ? undefined : 'Project no longer exists'}
        >
          {displayLabel}
        </span>
        <span className="inbox-detail-ts">
          {formatAbsolute(entry.ts)}
          <span className="inbox-detail-ts-sep">·</span>
          {formatRelative(entry.ts)}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="inbox-detail-trash"
          title="Delete this entry (Delete / Backspace)"
          aria-label="Delete this inbox entry"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>

      {hasDocs && (
        <div className="inbox-detail-docs">
          {entry.docs!.map((doc) => (
            <DocBlock key={doc.path} project={aliveProject} doc={doc} />
          ))}
        </div>
      )}

      {hasComments && (
        <div className={`inbox-detail-comments ${hasDocs ? 'has-divider' : ''}`}>
          <div className="inbox-detail-section-label">Comments</div>
          <MarkdownContent text={entry.comments!} />
        </div>
      )}

      <div className="inbox-detail-footer">
        {projectAlive ? (
          <button
            type="button"
            onClick={openProject}
            className="inbox-detail-open"
          >
            <MessageSquare size={15} strokeWidth={1.75} />
            <span>
              Open <span className="strong">{displayLabel}</span>…
            </span>
            <ArrowRight size={15} strokeWidth={1.75} />
          </button>
        ) : (
          <div className="inbox-detail-open disabled">
            Project no longer exists — nowhere to open.
          </div>
        )}
      </div>

      <div className="inbox-detail-meta-id">project: {entry.projectId}</div>
    </div>
  );
}

/**
 * Render one doc, fetched live via window.cc.fs.readFile against the
 * project's root path. Re-fetches on entry change. If the project is
 * tombstoned (deleted) we render a "project missing" message — without
 * a project root, we have no anchor to resolve the relative path.
 */
function DocBlock({ project, doc }: { project: Project | null; doc: InboxDoc }) {
  const [result, setResult] = useState<FsReadResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!project) {
      // No live project — show the tombstone after a microtask so the
      // "Loading" flash doesn't render.
      setResult({ ok: false, message: 'Project no longer exists' });
      return;
    }
    const abs = joinPath(project.path, doc.path);
    window.cc.fs
      .readFile(abs)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({ ok: false, message: err instanceof Error ? err.message : 'Read failed' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project, doc.path]);

  return (
    <div className="inbox-doc">
      <div className="inbox-doc-header">
        <span className="inbox-doc-icon">📄</span>
        <span className="inbox-doc-path">{doc.path}</span>
      </div>
      <div className="inbox-doc-body">
        {result === null ? (
          <div className="inbox-doc-loading">Loading…</div>
        ) : result.ok && typeof result.content === 'string' ? (
          <DocContent path={doc.path} content={result.content} />
        ) : (
          <DocTombstone result={result} />
        )}
      </div>
    </div>
  );
}

function DocContent({ path, content }: { path: string; content: string }) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return <MarkdownContent text={content} />;
  }
  return <pre className="inbox-doc-pre">{content}</pre>;
}

function DocTombstone({ result }: { result: FsReadResult }) {
  let message: string;
  if (result.binary) message = 'File is binary — not rendered.';
  else if (result.truncated) message = 'File too large to render in inbox.';
  else if (result.message) message = result.message;
  else message = 'File could not be read.';
  return <div className="inbox-doc-tombstone">{message}</div>;
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="inbox-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function joinPath(root: string, rel: string): string {
  // The renderer doesn't have access to Node's `path`. Inbox docs are
  // documented as relative paths against the project root. Strip any
  // leading slash to keep the join sane on both POSIX and Windows.
  const cleanRel = rel.replace(/^[/\\]+/, '');
  if (root.endsWith('/') || root.endsWith('\\')) return root + cleanRel;
  return `${root}/${cleanRel}`;
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
