import { isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Bookmark, BookmarkCheck, CornerDownLeft, Download, ExternalLink, MessageSquare, Send, Star, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { MermaidDiagram } from './MermaidDiagram';
import {
  deleteInboxEntry,
  replyToInboxEntry,
  saveInboxEntry,
  toggleInboxKeep,
  useData,
  useInbox,
  useInboxAnswered,
  useInboxKeep,
  useInboxRead,
  useInboxSelection,
  useSavedMark,
  useUi
} from '../store';
import { InboxGuidance } from './InboxGuidance';
import { unwrapBareFence } from '../util/markdown';
import { buildStandaloneHtml } from '../util/exportHtml';
import { highlightForPath } from '../util/highlightCode';
import type { InboxDoc, InboxEntry, FsReadResult, Project, SavedDoc, SavedRecordInput } from '@shared/types';

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
      <InboxGuidance />
    </div>
  );
}

function Detail({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const setNav = useUi((s) => s.setNav);
  const selectProject = useUi((s) => s.selectProject);
  const pushToast = useUi((s) => s.pushToast);

  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const aliveProject = projects.find((p) => p.id === entry.projectId) ?? null;
  const projectAlive = aliveProject !== null;
  const displayLabel =
    aliveProject?.name ?? entry.projectLabel ?? entry.projectId;

  // Resolve the originating session, when one was recorded and is still
  // alive. A dead/missing sessionId falls back to plain project nav.
  const aliveSession = entry.sessionId
    ? (terminals[entry.projectId] ?? []).find((t) => t.id === entry.sessionId) ?? null
    : null;
  const sessionTombstoned = !!entry.sessionId && aliveSession === null;

  const hasDocs = (entry.docs?.length ?? 0) > 0;
  const hasComments = (entry.comments ?? '').trim().length > 0;

  const openProject = () => {
    if (!aliveProject) return;
    selectProject(aliveProject.id);
    setNav('projects');
    // Focus the originating terminal when known and still running. Scheduled
    // sessions are headless, so we restoreTerminal (un-hide + select) rather
    // than selectTab — selectTab silently no-ops for an id that isn't in the
    // visible tab list, which is exactly the case for a headless session.
    if (aliveSession) {
      void restoreTerminal(aliveSession.id, aliveProject.id);
    }
  };

  /**
   * Export the rendered detail (docs + comments, with diagrams and
   * highlighted code already painted) to a PDF. We snapshot the live DOM
   * subtree so the PDF matches the screen exactly, then hand the standalone
   * HTML to the main process to print via a hidden window.
   */
  const exportPdf = async () => {
    if (exporting || !exportRef.current) return;
    setExporting(true);
    try {
      const html = buildStandaloneHtml(exportRef.current, displayLabel);
      const suggestedName = `${displayLabel} — ${formatAbsolute(entry.ts)}`;
      const result = await window.cc.inbox.exportPdf({ html, suggestedName });
      if (result.ok) {
        pushToast('PDF saved', 'info');
      } else if (result.message) {
        pushToast(result.message, 'error');
      }
      // No message → user cancelled the save dialog; stay quiet.
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'PDF export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const canExport = hasDocs || hasComments;

  // Save: freeze a reusable copy of this report (comments + a snapshot of each
  // doc's current content) under ~/.cc-center/saved/. Docs are re-read fresh on
  // click so the snapshot is current; the saved-state marker is per-entry.
  const alreadySaved = useSavedMark((s) => !!s.savedEntryIds[entry.id]);
  const kept = useInboxKeep((s) => !!s.keptIds[entry.id]);
  const [saving, setSaving] = useState(false);
  const onSave = async () => {
    if (saving || alreadySaved) return;
    setSaving(true);
    try {
      const docs: SavedDoc[] = [];
      for (const d of entry.docs ?? []) {
        if (!aliveProject) {
          docs.push({ path: d.path, error: 'Project no longer exists' });
          continue;
        }
        try {
          const r = await window.cc.fs.readFile(joinPath(aliveProject.path, d.path));
          docs.push({
            path: d.path,
            content: r.ok ? r.content : undefined,
            truncated: r.truncated,
            binary: r.binary,
            error: r.ok ? undefined : r.message ?? 'Read failed'
          });
        } catch (e) {
          docs.push({ path: d.path, error: e instanceof Error ? e.message : 'Read failed' });
        }
      }
      const input: SavedRecordInput = {
        sourceEntryId: entry.id,
        projectId: entry.projectId,
        projectLabel: displayLabel,
        title: deriveTitle(entry),
        comments: entry.comments,
        docs: docs.length ? docs : undefined
      };
      await saveInboxEntry(input, entry.id);
    } finally {
      setSaving(false);
    }
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
        {aliveSession && (
          <>
            <span className="inbox-detail-ts-sep">·</span>
            <span className="inbox-detail-session" title="Originating terminal">
              {aliveSession.title}
            </span>
          </>
        )}
        {sessionTombstoned && (
          <>
            <span className="inbox-detail-ts-sep">·</span>
            <span
              className="inbox-detail-session tombstoned"
              title="Original terminal session has ended"
            >
              session ended
            </span>
          </>
        )}
        <span className="inbox-detail-ts">
          {formatAbsolute(entry.ts)}
          <span className="inbox-detail-ts-sep">·</span>
          {formatRelative(entry.ts)}
        </span>
        <button
          type="button"
          onClick={() => toggleInboxKeep(entry.id)}
          className={`inbox-detail-keep ${kept ? 'is-kept' : ''}`}
          title={kept ? 'Kept — protected from Clear inbox' : 'Keep (protect from Clear inbox)'}
          aria-label={kept ? 'Remove keep flag' : 'Keep this entry'}
          aria-pressed={kept}
        >
          <Star size={14} strokeWidth={1.75} fill={kept ? 'currentColor' : 'none'} />
        </button>
        {canExport && (
          <button
            type="button"
            onClick={() => void onSave()}
            className={`inbox-detail-save ${alreadySaved ? 'is-saved' : ''}`}
            disabled={saving || alreadySaved}
            title={alreadySaved ? 'Saved for later' : 'Save this report for later reuse'}
            aria-label={alreadySaved ? 'Saved for later' : 'Save this report for later'}
          >
            {alreadySaved ? (
              <BookmarkCheck size={14} strokeWidth={1.75} />
            ) : (
              <Bookmark size={14} strokeWidth={1.75} />
            )}
          </button>
        )}
        {canExport && (
          <button
            type="button"
            onClick={() => void exportPdf()}
            className="inbox-detail-download"
            disabled={exporting}
            title="Download as PDF"
            aria-label="Download this inbox entry as PDF"
          >
            <Download size={14} strokeWidth={1.75} />
          </button>
        )}
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

      <div ref={exportRef}>
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
      </div>

      <div className="inbox-detail-footer">
        {projectAlive ? (
          <button
            type="button"
            onClick={openProject}
            className="inbox-detail-open"
          >
            <MessageSquare size={15} strokeWidth={1.75} />
            <span>
              {aliveSession ? (
                <>
                  Open in <span className="strong">{aliveSession.title}</span>…
                </>
              ) : (
                <>
                  Open <span className="strong">{displayLabel}</span>…
                </>
              )}
            </span>
            <ArrowRight size={15} strokeWidth={1.75} />
          </button>
        ) : (
          <div className="inbox-detail-open disabled">
            Project no longer exists — nowhere to open.
          </div>
        )}
      </div>

      {aliveSession && <ReplyBox entry={entry} sessionTitle={aliveSession.title} />}

      <div className="inbox-detail-meta-id">project: {entry.projectId}</div>
    </div>
  );
}

/**
 * Reply-back box — the write-half of the inbox question loop. Shown only when
 * the originating session is still alive (resolved by the caller). Sends the
 * typed answer to that pty's stdin via `replyToInboxEntry`, so an agent that
 * pushed a question via `inbox_push` and blocked for input gets the answer
 * without the user leaving the inbox.
 *
 * ⌘/Ctrl+Enter submits (Enter alone inserts a newline — replies can be
 * multi-line). Once sent, the entry is marked answered and the box collapses
 * to a confirmation line; the user can reply again via the "reply again" link
 * if the agent asks a follow-up on the same session.
 */
function ReplyBox({ entry, sessionTitle }: { entry: InboxEntry; sessionTitle: string }) {
  const answered = useInboxAnswered((s) => !!s.answeredIds[entry.id]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reopened, setReopened] = useState(false);

  // sessionId is guaranteed by the caller (only rendered when aliveSession),
  // but narrow it for type-safety.
  const sessionId = entry.sessionId;
  if (!sessionId) return null;

  const collapsed = answered && !reopened;

  const submit = async () => {
    if (sending || !text.trim()) return;
    setSending(true);
    const ok = await replyToInboxEntry(entry.id, sessionId, text);
    setSending(false);
    if (ok) {
      setText('');
      setReopened(false);
    }
  };

  if (collapsed) {
    return (
      <div className="inbox-reply answered">
        <span className="inbox-reply-answered-label">
          <CornerDownLeft size={13} strokeWidth={1.75} />
          Replied to <span className="strong">{sessionTitle}</span>
        </span>
        <button
          type="button"
          className="inbox-reply-again"
          onClick={() => setReopened(true)}
        >
          Reply again
        </button>
      </div>
    );
  }

  return (
    <div className="inbox-reply">
      <textarea
        className="inbox-reply-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder={`Reply to ${sessionTitle}…`}
        aria-label="Reply to the originating terminal session"
      />
      <div className="inbox-reply-actions">
        <span className="inbox-reply-hint">⌘↵ to send</span>
        <button
          type="button"
          className="inbox-reply-send"
          onClick={() => void submit()}
          disabled={sending || !text.trim()}
        >
          <Send size={13} strokeWidth={1.75} />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
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

  const pushToast = useUi((s) => s.pushToast);
  const openInEditor = async () => {
    if (!project) return;
    const abs = joinPath(project.path, doc.path);
    const r = await window.cc.openers.openIn('cursor', abs);
    if (!r.ok) pushToast(r.message ?? 'Failed to open in Cursor', 'error');
  };

  return (
    <div className="inbox-doc">
      <div className="inbox-doc-header">
        <span className="inbox-doc-icon">📄</span>
        <span className="inbox-doc-path">{doc.path}</span>
        {project && (
          <button
            type="button"
            className="inbox-doc-open"
            onClick={openInEditor}
            title="Open in Cursor"
            aria-label={`Open ${doc.path} in Cursor`}
          >
            <ExternalLink size={12} strokeWidth={1.75} />
          </button>
        )}
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
  // Syntax-highlight recognized source files (.ts/.tsx/.py/…) the same way the
  // markdown path highlights fenced code. Unknown/extensionless files fall back
  // to plain monospace text. The highlighted HTML is escaped by highlight.js.
  const highlighted = highlightForPath(path, content);
  if (highlighted) {
    return (
      <pre className="inbox-doc-pre hljs">
        <code
          className={`hljs language-${highlighted.language}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    );
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
  const body = unwrapBareFence(text);
  return (
    <div className="inbox-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Syntax-highlight fenced code blocks. `ignoreMissing` keeps unknown
        // languages (incl. ```mermaid, which the pre override intercepts
        // before this matters) from throwing — they just render unhighlighted.
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          // Open links in a new window — Electron treats that as the OS
          // default browser. Avoid destructuring `node` (deprecated in
          // react-markdown v10).
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          // GFM tables get a wrapper so horizontal overflow scrolls within
          // the comments block instead of stretching the whole panel.
          table: (props) => (
            <div className="inbox-md-table-wrap">
              <table {...props} />
            </div>
          ),
          // Intercept ```mermaid fences and render them as diagrams. A
          // non-mermaid fence falls through to the default <pre>. We hook
          // `pre` (not `code`) so the rendered SVG isn't nested inside a
          // monospace code block.
          pre: (props) => {
            const mermaid = extractMermaid(props.children);
            if (mermaid !== null) return <MermaidDiagram code={mermaid} />;
            return <pre {...props} />;
          }
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Given the children of a markdown `<pre>` (which react-markdown renders as a
 * single `<code className="language-…">` element), return the raw source if
 * it's a ```mermaid fence, otherwise null. Returning null lets the caller
 * fall back to the default code-block rendering.
 */
function extractMermaid(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const className = props.className ?? '';
  if (!/(^|\s)language-mermaid(\s|$)/.test(className)) return null;
  const source = props.children;
  return typeof source === 'string' ? source.replace(/\n$/, '') : null;
}

function joinPath(root: string, rel: string): string {
  // The renderer doesn't have access to Node's `path`. Inbox docs are
  // documented as relative paths against the project root. Strip any
  // leading slash to keep the join sane on both POSIX and Windows.
  const cleanRel = rel.replace(/^[/\\]+/, '');
  if (root.endsWith('/') || root.endsWith('\\')) return root + cleanRel;
  return `${root}/${cleanRel}`;
}

/**
 * Derive a short title for a saved report: first non-empty comment line with
 * leading markdown markers stripped, else the first doc path, else the project
 * label. Clamped so the title stays scannable. Mirrors the sidebar preview.
 */
function deriveTitle(entry: InboxEntry): string {
  const c = (entry.comments ?? '').trim();
  if (c) {
    const firstLine = c.split('\n').find((l) => l.trim().length > 0) ?? '';
    const stripped = firstLine.replace(/^[#>*\-\s]+/, '').trim();
    if (stripped) return stripped.slice(0, 120);
  }
  const firstDoc = entry.docs?.[0]?.path;
  if (firstDoc) return firstDoc;
  return entry.projectLabel ?? entry.projectId;
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
