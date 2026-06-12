import { useEffect, useMemo, useRef, useState, isValidElement, type ReactNode } from 'react';
import { FileText, Trash2, ExternalLink, X, Search, Plus, Pencil, Eye, Save, AtSign } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Bundle monaco locally instead of letting the React wrapper fetch it from
// jsDelivr — Electron's CSP blocks remote scripts and leaves the editor
// stuck on "Loading…". Workers are spun up via Vite's ?worker import.
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};
loader.config({ monaco });

import type { Project, LibraryDoc } from '@shared/types';
import { useLibrary, useUi } from '../store';
import { MermaidDiagram } from './MermaidDiagram';

interface Props {
  project: Project;
}

// Width of the document list column. Persisted as a renderer-only UI pref under
// a cc.* localStorage key (same idiom as the other global UI prefs), not via
// IPC config — it's a per-machine layout preference, not app state.
const LIBRARY_LIST_MIN = 220;
const LIBRARY_LIST_MAX = 560;
const LIBRARY_LIST_DEFAULT = 300;
const LIBRARY_LIST_KEY = 'cc.libraryListWidth';

function loadLibraryListWidth(): number {
  if (typeof localStorage === 'undefined') return LIBRARY_LIST_DEFAULT;
  const raw = Number(localStorage.getItem(LIBRARY_LIST_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return LIBRARY_LIST_DEFAULT;
  return Math.max(LIBRARY_LIST_MIN, Math.min(LIBRARY_LIST_MAX, raw));
}

export function LibraryView({ project }: Props) {
  const pushToast = useUi((s) => s.pushToast);
  // CRITICAL: select raw docs slice — inline filter/map infinite-loops React
  const docs = useLibrary((s) => s.docs);
  const loading = useLibrary((s) => s.loading);

  const [selectedDoc, setSelectedDoc] = useState<LibraryDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  // After creating a new idea we don't yet have the doc in `docs` (it arrives
  // on the next library.onChanged push). Stash its id so the select-effect can
  // jump to it — and `startEditing` to open it straight in edit mode.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [startEditing, setStartEditing] = useState(false);

  // Resizable doc-list column. The width lives on the grid via an inline CSS
  // var; dragging the splitter rewrites it and persists to localStorage on
  // mouse-up. A ref mirrors the live value so the listeners don't restart.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState(loadLibraryListWidth);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    let latest = listWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(
        LIBRARY_LIST_MIN,
        Math.min(LIBRARY_LIST_MAX, Math.round(ev.clientX - left))
      );
      setListWidth(latest);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(LIBRARY_LIST_KEY, String(latest));
      } catch {
        /* localStorage write is best-effort */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    setListWidth(LIBRARY_LIST_DEFAULT);
    try {
      localStorage.setItem(LIBRARY_LIST_KEY, String(LIBRARY_LIST_DEFAULT));
    } catch {
      /* best-effort */
    }
  };

  // Collect all unique tags from docs (useMemo for stable ref)
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    docs.forEach((doc) => {
      doc.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [docs]);

  // Filter docs by search query and selected tags (useMemo for stable ref)
  const filteredDocs = useMemo(() => {
    let filtered = docs;

    // Text search on title and tags
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (doc) =>
          doc.title.toLowerCase().includes(q) ||
          doc.summary?.toLowerCase().includes(q) ||
          doc.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (selectedTags.size > 0) {
      filtered = filtered.filter((doc) =>
        doc.tags?.some((tag) => selectedTags.has(tag))
      );
    }

    // Sort by updatedAt (newest first)
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [docs, searchQuery, selectedTags]);

  // A freshly-created idea arrives via the onChanged push, not from add()'s
  // return value — once it shows up in docs, select it (and it opens in edit
  // mode via startEditing, consumed by DocPreview's key/prop below).
  useEffect(() => {
    if (!pendingSelectId) return;
    const match = docs.find((d) => d.id === pendingSelectId);
    if (match) {
      setSelectedDoc(match);
      setPendingSelectId(null);
    }
  }, [docs, pendingSelectId]);

  // Auto-select first doc if none selected. Skipped while a new idea is
  // pending so we don't briefly land on the wrong doc.
  useEffect(() => {
    if (pendingSelectId) return;
    if (!selectedDoc && filteredDocs.length > 0) {
      setSelectedDoc(filteredDocs[0]);
    } else if (selectedDoc && !filteredDocs.find((d) => d.id === selectedDoc.id)) {
      setSelectedDoc(filteredDocs[0] ?? null);
    }
  }, [filteredDocs, selectedDoc, pendingSelectId]);

  const handleDelete = async (doc: LibraryDoc) => {
    if (doc.id === '') {
      pushToast('Cannot delete untracked files', 'error');
      return;
    }
    if (!window.confirm(`Delete "${doc.title}"?`)) return;

    try {
      const ok = await window.cc.library.remove(doc.id);
      if (ok) {
        pushToast('Document deleted');
        if (selectedDoc?.id === doc.id) {
          setSelectedDoc(null);
        }
      } else {
        pushToast('Failed to delete document', 'error');
      }
    } catch (err) {
      pushToast(`Delete failed: ${err}`, 'error');
    }
  };

  const handleReveal = async (doc: LibraryDoc) => {
    try {
      const result = await window.cc.library.reveal(
        doc.scope ?? 'global',
        doc.scope === 'project' ? doc.projectId : undefined
      );
      if (!result.ok) {
        pushToast(result.message ?? 'Failed to reveal directory', 'error');
      }
    } catch (err) {
      pushToast(`Reveal failed: ${err}`, 'error');
    }
  };

  // Copy a Claude-ready reference to the doc so it can be pasted straight into
  // a terminal / Claude session. We copy the absolute path as an `@`-mention
  // (Claude Code reads the file from it); fall back to the plain path if no
  // absPath is known.
  const handleCopyReference = async (doc: LibraryDoc) => {
    const ref = doc.absPath ? `@${doc.absPath}` : doc.relPath;
    try {
      await navigator.clipboard.writeText(ref);
      pushToast('Reference copied');
    } catch (err) {
      pushToast(`Copy failed: ${err}`, 'error');
    }
  };

  // Quick-capture: create a dated idea note (global scope, tagged `idea`) and
  // open it straight in edit mode. Electron disables window.prompt, so the
  // title isn't asked up front — it's derived from the first heading on save.
  const handleNewIdea = async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    try {
      const created = await window.cc.library.add({
        scope: 'global',
        relPath: `ideas/${stamp}.md`,
        title: 'Untitled idea',
        content: '# Untitled idea\n\n',
        tags: ['idea'],
        source: { kind: 'user' }
      });
      if (created) {
        setSearchQuery('');
        setSelectedTags(new Set());
        setStartEditing(true);
        setPendingSelectId(created.id);
      } else {
        pushToast('Failed to create idea', 'error');
      }
    } catch (err) {
      pushToast(`Create failed: ${err}`, 'error');
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  return (
    <div
      ref={rootRef}
      className="explorer-view library-view"
      style={{ gridTemplateColumns: `${listWidth}px 1fr` }}
    >
      {/* Left pane: doc list */}
      <div className="explorer-tree">
        <div className="explorer-tree-header">
          <h3 className="explorer-tree-title">Documents</h3>
          <button
            type="button"
            className="library-new-idea"
            onClick={handleNewIdea}
            title="New idea — a dated, editable markdown note"
          >
            <Plus size={13} />
            <span>New idea</span>
          </button>
        </div>

        {/* Search box */}
        <div className="library-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search title, summary, tags…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="library-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="library-tags">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`library-tag-chip ${selectedTags.has(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Doc list */}
        <div className="explorer-tree-body library-list">
          {loading ? (
            <div className="library-list-empty">Loading…</div>
          ) : filteredDocs.length === 0 ? (
            <div className="library-list-empty">
              {docs.length === 0 ? 'No documents yet' : 'No matches'}
            </div>
          ) : (
            filteredDocs.map((doc) => (
              <button
                key={doc.id || doc.relPath}
                type="button"
                className={`library-list-item ${selectedDoc?.id === doc.id ? 'active' : ''}`}
                onClick={() => setSelectedDoc(doc)}
              >
                <div className="library-list-item-header">
                  <FileText size={14} />
                  <span className="library-list-item-title">{doc.title}</span>
                  <span className={`library-scope-badge ${doc.scope}`}>
                    {doc.scope === 'project' ? 'Project' : 'Global'}
                  </span>
                </div>
                {doc.summary && (
                  <div className="library-list-item-summary">{doc.summary}</div>
                )}
                {doc.scope === 'project' && doc.projectName && (
                  <div className="library-list-item-project">{doc.projectName}</div>
                )}
                {doc.tags && doc.tags.length > 0 && (
                  <div className="library-list-item-tags">
                    {doc.tags.map((tag) => (
                      <span key={tag} className="library-tag-small">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Splitter: drag to resize the list column, double-click to reset. */}
      <div
        className="library-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={LIBRARY_LIST_MIN}
        aria-valuemax={LIBRARY_LIST_MAX}
        aria-valuenow={listWidth}
        title="Drag to resize · double-click to reset"
        style={{ left: `${listWidth}px` }}
        onMouseDown={onResizeMouseDown}
        onDoubleClick={onResizeDoubleClick}
      />

      {/* Right pane: preview */}
      <div className="explorer-viewer library-viewer">
        {!selectedDoc ? (
          <div className="explorer-viewer-empty">
            <p>Select a document to preview</p>
          </div>
        ) : (
          <>
            <div className="explorer-viewer-header">
              <div className="explorer-viewer-path">
                {selectedDoc.title}
                <span className={`library-scope-badge ${selectedDoc.scope}`}>
                  {selectedDoc.scope === 'project' ? 'Project' : 'Global'}
                </span>
              </div>
              <div className="explorer-viewer-actions">
                <button
                  type="button"
                  onClick={() => handleCopyReference(selectedDoc)}
                  title="Copy reference (@path) for use in a terminal / Claude session"
                  aria-label="Copy reference"
                >
                  <AtSign size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleReveal(selectedDoc)}
                  title="Reveal in Finder"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selectedDoc)}
                  title="Delete"
                  disabled={selectedDoc.id === ''}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {selectedDoc.tags && selectedDoc.tags.length > 0 && (
              <div className="library-viewer-tags">
                {selectedDoc.tags.map((tag) => (
                  <span key={tag} className="library-tag-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {selectedDoc.source && (
              <div className="library-viewer-source">
                Source: {selectedDoc.source.kind}
                {selectedDoc.source.sessionId && ` · ${selectedDoc.source.sessionId.slice(0, 7)}`}
              </div>
            )}

            <DocPreview
              key={selectedDoc.id || selectedDoc.relPath}
              doc={selectedDoc}
              autoEdit={startEditing}
              onAutoEditConsumed={() => setStartEditing(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}

interface DocPreviewProps {
  doc: LibraryDoc;
  /** Open straight into edit mode (used right after "New idea"). */
  autoEdit?: boolean;
  onAutoEditConsumed?: () => void;
}

function DocPreview({ doc, autoEdit, onAutoEditConsumed }: DocPreviewProps) {
  const pushToast = useUi((s) => s.pushToast);
  const [content, setContent] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Markdown editing: only `md` docs are editable. `draft` holds unsaved
  // keystrokes; null ⇒ not editing (preview mode).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const editable = doc.kind === 'md' && doc.id !== '' && !!doc.absPath;

  useEffect(() => {
    if (!doc.absPath) {
      setError('No absolute path available');
      return;
    }

    setLoading(true);
    setError(null);
    setContent(null);
    setDataUrl(null);
    setEditing(false);

    if (doc.kind === 'md' || doc.kind === 'code') {
      // Read as text
      window.cc.fs
        .readFile(doc.absPath)
        .then((result) => {
          if (result.ok && result.content !== undefined) {
            setContent(result.content);
          } else {
            setError(result.message ?? 'Failed to read file');
          }
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    } else if (doc.kind === 'image') {
      // Read as data URL
      window.cc.fs
        .readDataUrl(doc.absPath)
        .then((result) => {
          if (result.ok && result.dataUrl) {
            setDataUrl(result.dataUrl);
          } else {
            setError(result.message ?? 'Failed to read image');
          }
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    } else {
      // PDF or other
      setLoading(false);
    }
  }, [doc.absPath, doc.kind]);

  // Honor "open in edit mode" once the content has loaded (new idea flow).
  useEffect(() => {
    if (autoEdit && editable && content !== null) {
      setDraft(content);
      setEditing(true);
      onAutoEditConsumed?.();
    }
  }, [autoEdit, editable, content, onAutoEditConsumed]);

  const beginEdit = () => {
    setDraft(content ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!doc.absPath) return;
    setSaving(true);
    try {
      const res = await window.cc.fs.writeFile(doc.absPath, draft);
      if (!res.ok) {
        pushToast(res.message ?? 'Save failed', 'error');
        return;
      }
      setContent(draft);
      setEditing(false);
      // Keep the manifest title in step with the note's first heading so the
      // list label tracks what the idea is actually about. Best-effort.
      const heading = firstHeading(draft);
      if (heading && heading !== doc.title) {
        try {
          await window.cc.library.update(doc.id, { title: heading });
        } catch {
          /* title sync is best-effort; the file is already saved */
        }
      }
      pushToast('Saved');
    } catch (err) {
      pushToast(`Save failed: ${err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="explorer-viewer-empty">Loading…</div>;
  }

  if (error) {
    return (
      <div className="explorer-viewer-empty">
        <p style={{ color: 'var(--error)' }}>{error}</p>
      </div>
    );
  }

  // Markdown: editable (preview ⇄ edit toggle) for tracked idea/notes.
  if (doc.kind === 'md' && content !== null) {
    return (
      <div className="library-md-pane">
        <div className="library-edit-bar">
          {editing ? (
            <>
              <button
                type="button"
                className="library-edit-btn primary"
                onClick={saveEdit}
                disabled={saving}
                title="Save (writes the file)"
              >
                <Save size={13} />
                <span>{saving ? 'Saving…' : 'Save'}</span>
              </button>
              <button
                type="button"
                className="library-edit-btn"
                onClick={() => setEditing(false)}
                disabled={saving}
                title="Discard changes and return to preview"
              >
                <Eye size={13} />
                <span>Preview</span>
              </button>
            </>
          ) : (
            editable && (
              <button
                type="button"
                className="library-edit-btn"
                onClick={beginEdit}
                title="Edit this note"
              >
                <Pencil size={13} />
                <span>Edit</span>
              </button>
            )
          )}
        </div>
        {editing ? (
          <div className="explorer-viewer-monaco">
            <Editor
              value={draft}
              language="markdown"
              theme="vs-dark"
              onChange={(v) => setDraft(v ?? '')}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on'
              }}
            />
          </div>
        ) : (
          <div className="explorer-md-preview">
            <div className="inbox-md">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre: (props) => {
                    const mermaid = extractMermaid(props.children);
                    if (mermaid !== null) return <MermaidDiagram code={mermaid} />;
                    return <pre {...props} />;
                  }
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Code preview (Monaco)
  if (doc.kind === 'code' && content !== null) {
    const language = languageFromPath(doc.relPath);
    return (
      <div className="explorer-viewer-monaco">
        <Editor
          value={content}
          language={language}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            folding: true,
            wordWrap: 'on'
          }}
        />
      </div>
    );
  }

  // Image preview
  if (doc.kind === 'image' && dataUrl !== null) {
    return (
      <div className="library-image-preview">
        <img src={dataUrl} alt={doc.title} />
      </div>
    );
  }

  // PDF preview (webview). Encode the path so spaces / # / ? in the absolute
  // path (common under ~/Documents/…) don't truncate or break the file: URL.
  if (doc.kind === 'pdf' && doc.absPath) {
    const fileUrl = `file://${doc.absPath.split('/').map(encodeURIComponent).join('/')}`;
    return (
      <webview
        src={fileUrl}
        className="library-pdf-preview"
        // @ts-expect-error — electron webview attributes not in JSX types
        allowpopups="false"
      />
    );
  }

  // Other files — just show reveal button
  return (
    <div className="explorer-viewer-empty">
      <p>Preview not available for this file type</p>
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

/**
 * First markdown heading of a note (a `#` line), trimmed, or null. Used to keep
 * a note's manifest title in step with its content on save.
 */
function firstHeading(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Guess Monaco language from file extension.
 */
function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql'
  };
  return map[ext] ?? 'plaintext';
}
