import { useEffect, useMemo, useState, isValidElement, type ReactNode } from 'react';
import { FileText, Trash2, ExternalLink, X, Search } from 'lucide-react';
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

export function LibraryView({ project }: Props) {
  const pushToast = useUi((s) => s.pushToast);
  // CRITICAL: select raw docs slice — inline filter/map infinite-loops React
  const docs = useLibrary((s) => s.docs);
  const loading = useLibrary((s) => s.loading);

  const [selectedDoc, setSelectedDoc] = useState<LibraryDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

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

  // Auto-select first doc if none selected
  useEffect(() => {
    if (!selectedDoc && filteredDocs.length > 0) {
      setSelectedDoc(filteredDocs[0]);
    } else if (selectedDoc && !filteredDocs.find((d) => d.id === selectedDoc.id)) {
      setSelectedDoc(filteredDocs[0] ?? null);
    }
  }, [filteredDocs, selectedDoc]);

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
    <div className="explorer-view library-view">
      {/* Left pane: doc list */}
      <div className="explorer-tree">
        <div className="explorer-tree-header">
          <h3 className="explorer-tree-title">Documents</h3>
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

            <DocPreview doc={selectedDoc} />
          </>
        )}
      </div>
    </div>
  );
}

interface DocPreviewProps {
  doc: LibraryDoc;
}

function DocPreview({ doc }: DocPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc.absPath) {
      setError('No absolute path available');
      return;
    }

    setLoading(true);
    setError(null);
    setContent(null);
    setDataUrl(null);

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

  // Markdown preview
  if (doc.kind === 'md' && content !== null) {
    return (
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
