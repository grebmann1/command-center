import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FileText, RefreshCw, GitCompare, GitBranch, ListTree, Save, Undo2, Eye, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
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
import type { FsEntry, GitFileCode, GitShowResult, OpenTarget, FsReadResult, Project } from '@shared/types';
import { useData, useUi } from '../store';
import { OpenerButtons } from './OpenerButtons';
import { posixQuote } from '../util/quote';

interface ContextMenu {
  x: number;
  y: number;
  entry: FsEntry;
}

interface Props {
  project: Project;
}

export function ExplorerView({ project }: Props) {
  const pushToast = useUi((s) => s.pushToast);
  const explorerFile = useUi((s) => s.explorerFile[project.id]);
  const goto = useUi((s) => s.explorerGoto[project.id]);
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const selectTab = useUi((s) => s.selectTab);
  const createTerminal = useData((s) => s.createTerminal);
  const gitStatus = useData((s) => s.gitStatus[project.id]);
  const gitFiles = gitStatus?.files;

  const openShellHere = async (cwd: string) => {
    const session = await createTerminal(project.id, 'shell', 80, 24, { cwd });
    if (session) {
      selectTab(project.id, session.id);
      setWorkspaceMode(project.id, 'terminals');
    }
  };

  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());
  const [entries, setEntries] = useState<Map<string, FsEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [fileResult, setFileResult] = useState<FsReadResult | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  // Buffered edits live separately from `fileResult` so a focus-driven re-read
  // can refresh the on-disk view without clobbering unsaved keystrokes. When
  // null, the editor mirrors fileResult.content exactly.
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Markdown files open as a rendered preview by default; the user can flip to
  // the Monaco editor to make edits. Resets per file (see effect below).
  const [previewMode, setPreviewMode] = useState(false);
  const treeMode = useUi((s) => s.explorerTreeMode[project.id] ?? 'files');
  const setTreeModeStore = useUi((s) => s.setExplorerTreeMode);
  const toggleTreeModeStore = useUi((s) => s.toggleExplorerTreeMode);
  const diffMode = useUi((s) => !!s.explorerDiff[project.id]);
  const setDiffModeStore = useUi((s) => s.setExplorerDiff);
  const setTreeMode = useCallback(
    (mode: 'files' | 'changes' | ((prev: 'files' | 'changes') => 'files' | 'changes')) => {
      const cur = useUi.getState().explorerTreeMode[project.id] ?? 'files';
      const next = typeof mode === 'function' ? mode(cur) : mode;
      setTreeModeStore(project.id, next);
    },
    [project.id, setTreeModeStore]
  );
  const setDiffMode = useCallback(
    (val: boolean | ((prev: boolean) => boolean)) => {
      const cur = !!useUi.getState().explorerDiff[project.id];
      const next = typeof val === 'function' ? val(cur) : val;
      setDiffModeStore(project.id, next);
    },
    [project.id, setDiffModeStore]
  );
  void toggleTreeModeStore;
  const [headResult, setHeadResult] = useState<GitShowResult | null>(null);
  const [headLoading, setHeadLoading] = useState(false);
  const treeBodyRef = useRef<HTMLDivElement>(null);
  // Monaco editor instance + last applied goto nonce, so we can replay a
  // pending goto once the editor is mounted *and* the file has loaded.
  const editorRef = useRef<{
    revealLineInCenter: (line: number) => void;
    setPosition: (p: { lineNumber: number; column: number }) => void;
    focus: () => void;
  } | null>(null);
  const appliedGotoNonceRef = useRef<number | null>(null);

  const applyGoto = useCallback(() => {
    if (!goto || !editorRef.current) return;
    if (appliedGotoNonceRef.current === goto.nonce) return;
    editorRef.current.revealLineInCenter(goto.line);
    editorRef.current.setPosition({ lineNumber: goto.line, column: goto.column });
    editorRef.current.focus();
    appliedGotoNonceRef.current = goto.nonce;
  }, [goto]);

  const loadDir = useCallback(
    async (path: string, force = false): Promise<FsEntry[]> => {
      if (!force) {
        const cached = entries.get(path);
        if (cached) return cached;
      }
      setLoading((s) => {
        const next = new Set(s);
        next.add(path);
        return next;
      });
      let list: FsEntry[] = [];
      try {
        list = await window.cc.fs.listDir(path);
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Failed to list directory', 'error');
      }
      setEntries((s) => {
        const next = new Map(s);
        next.set(path, list);
        return next;
      });
      setLoading((s) => {
        const next = new Set(s);
        next.delete(path);
        return next;
      });
      return list;
    },
    [entries]
  );

  // Walk down from project root, loading & expanding each ancestor folder of
  // `filePath`, then scroll the file's row into view. Used when search or
  // quick-open navigates to a file the user hasn't manually expanded yet.
  const revealFile = useCallback(
    async (filePath: string) => {
      if (!filePath.startsWith(project.path)) return;
      const rest = filePath.slice(project.path.length).replace(/^\//, '');
      if (!rest) return;
      const segments = rest.split('/');
      // Drop the file name itself; we only need to expand ancestor dirs.
      segments.pop();
      let dir = project.path;
      for (const seg of segments) {
        await loadDir(dir);
        dir = dir + '/' + seg;
        setExpanded((s) => {
          if (s.get(dir) === true) return s;
          const next = new Map(s);
          next.set(dir, true);
          return next;
        });
      }
      // Wait one frame so the freshly expanded rows are in the DOM.
      requestAnimationFrame(() => {
        const root = treeBodyRef.current;
        if (!root) return;
        const rows = root.querySelectorAll<HTMLElement>('.tree-row.file.active');
        rows[0]?.scrollIntoView({ block: 'nearest' });
      });
    },
    [project.path, loadDir]
  );

  useEffect(() => {
    setExpanded(new Map());
    setEntries(new Map());
    setLoading(new Set());
    setMenu(null);
    setHeadResult(null);
    editorRef.current = null;
    appliedGotoNonceRef.current = null;
    loadDir(project.path, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // When the user changes file, drop any cached HEAD content. Diff mode
  // sticks across navigations so power-users can scan changes file by file.
  // headLoading is also reset so a stale in-flight load from the previous
  // file can't leave the spinner stuck on.
  useEffect(() => {
    setHeadResult(null);
    setHeadLoading(false);
  }, [explorerFile]);

  // Lazily fetch HEAD blob the first time diff mode is on for a given file.
  // headLoading is intentionally NOT a dep: it's set inside this effect, and
  // including it would cause cleanup → cancel → finally clears it → effect
  // re-runs → endless refetch loop where setHeadResult is always cancelled.
  useEffect(() => {
    if (!diffMode || !explorerFile) return;
    if (headResult) return;
    let cancelled = false;
    setHeadLoading(true);
    window.cc.git.showHead(explorerFile)
      .then((r) => {
        if (cancelled) return;
        setHeadResult(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setHeadResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to read HEAD' });
      })
      .finally(() => {
        setHeadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [diffMode, explorerFile, headResult]);

  // load file contents when explorerFile changes
  useEffect(() => {
    let cancelled = false;
    setEditedContent(null);
    if (!explorerFile) {
      setFileResult(null);
      return;
    }
    setFileLoading(true);
    window.cc.fs.readFile(explorerFile)
      .then((r) => {
        if (cancelled) return;
        setFileResult(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setFileResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to read file' });
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    revealFile(explorerFile);
    return () => {
      cancelled = true;
    };
  }, [explorerFile, revealFile]);

  // Markdown opens rendered by default; everything else opens in the editor.
  // Re-evaluated on each file switch so leaving a .md in editor mode doesn't
  // carry that choice over to the next markdown file.
  useEffect(() => {
    setPreviewMode(!!explorerFile && isMarkdownPath(explorerFile));
  }, [explorerFile]);

  // Re-read the open file when the window regains focus. Claude tabs often
  // edit the file behind your back; without this the viewer stays stale until
  // you re-click the row. We don't toggle `fileLoading` so the editor doesn't
  // flash; the value just updates in place. Same for HEAD when diff is on.
  useEffect(() => {
    const onFocus = () => {
      if (!explorerFile) return;
      // Don't reload from disk while the buffer is dirty — that would silently
      // discard unsaved keystrokes. The diff side is still safe to refresh.
      if (editedContent === null) {
        window.cc.fs.readFile(explorerFile)
          .then((r) => {
            setFileResult((prev) => (sameFileResult(prev, r) ? prev : r));
          })
          .catch(() => {});
      }
      if (diffMode) {
        window.cc.git.showHead(explorerFile)
          .then((r) => {
            setHeadResult((prev) => (sameHeadResult(prev, r) ? prev : r));
          })
          .catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [explorerFile, diffMode, editedContent]);

  // After the file's loaded and the editor's mounted, apply any pending goto.
  useEffect(() => {
    if (fileLoading) return;
    if (!fileResult?.ok || fileResult.binary) return;
    applyGoto();
  }, [fileLoading, fileResult, applyGoto]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const toggleDir = (entry: FsEntry) => {
    const isOpen = expanded.get(entry.path) === true;
    if (!isOpen) loadDir(entry.path);
    setExpanded((s) => {
      const next = new Map(s);
      next.set(entry.path, !isOpen);
      return next;
    });
  };

  const openInExternal = async (target: OpenTarget, path: string) => {
    const r = await window.cc.openers.openIn(target, path);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  };

  const onFileClick = (entry: FsEntry) => {
    if (entry.path === explorerFile) return;
    if (
      editedContent !== null &&
      editedContent !== (fileResult?.content ?? '') &&
      !window.confirm('Discard unsaved changes?')
    ) {
      return;
    }
    setExplorerFile(project.id, entry.path);
  };

  const onContext = (e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const sendPathToTerminal = async (path: string) => {
    const activeTabId = useUi.getState().selectedTabId[project.id];
    if (!activeTabId) {
      pushToast('No active terminal in this project', 'error');
      return;
    }
    // Send the relative path when the file lives under the project root —
    // shorter, cleaner, and what Claude expects for @-mentions. Fall back
    // to absolute for paths outside (rare but possible via symlinks).
    const rel = path.startsWith(project.path + '/')
      ? path.slice(project.path.length + 1)
      : path;
    try {
      await window.cc.terminals.write(activeTabId, posixQuote(rel) + ' ');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to write to terminal', 'error');
      return;
    }
    setWorkspaceMode(project.id, 'terminals');
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      pushToast('Path copied');
    } catch {
      pushToast('Failed to copy path', 'error');
    }
  };

  const refresh = () => {
    setEntries(new Map());
    setExpanded(new Map());
    loadDir(project.path, true);
  };

  const discardFile = async (path: string) => {
    const code = gitFiles?.[path];
    const rel = path.startsWith(project.path + '/')
      ? path.slice(project.path.length + 1)
      : path;
    const verb = code === '?' || code === 'A' ? 'Delete' : 'Discard changes to';
    if (!window.confirm(`${verb} ${rel}? This cannot be undone.`)) return;
    const r = await window.cc.git.discard(path);
    if (!r.ok) {
      pushToast(r.message ?? 'Discard failed', 'error');
      return;
    }
    pushToast(code === '?' || code === 'A' ? `Deleted ${rel}` : `Discarded ${rel}`);
    // If we just nuked the open file, drop the editor view; otherwise re-read.
    if (explorerFile === path) {
      if (code === '?' || code === 'A') {
        setExplorerFile(project.id, undefined);
      } else {
        setEditedContent(null);
        window.cc.fs.readFile(path).then((res) => setFileResult(res)).catch(() => {});
        if (diffMode) {
          window.cc.git.showHead(path).then((h) => setHeadResult(h)).catch(() => {});
        }
      }
    }
    useData.getState().loadGitStatus(project.id);
  };

  const isDirty = editedContent !== null && editedContent !== (fileResult?.content ?? '');

  const saveFile = useCallback(async () => {
    if (!explorerFile || editedContent === null || saving) return;
    setSaving(true);
    const r = await window.cc.fs.writeFile(explorerFile, editedContent);
    setSaving(false);
    if (!r.ok) {
      pushToast(r.message ?? 'Failed to save file', 'error');
      return;
    }
    // Sync the on-disk snapshot to what we just wrote, drop the buffer, and
    // refresh git status so the dirty markers update right away.
    setFileResult((prev) => (prev ? { ...prev, content: editedContent, bytes: r.bytes } : prev));
    setEditedContent(null);
    if (diffMode) {
      window.cc.git.showHead(explorerFile).then((h) => setHeadResult(h)).catch(() => {});
    }
    useData.getState().loadGitStatus(project.id);
  }, [explorerFile, editedContent, saving, pushToast, diffMode, project.id]);

  // ⌘S / Ctrl+S — save the open file. Capture-phase so Monaco's default
  // "save" keybinding (which is a no-op without a wired command) can't
  // swallow it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      e.stopPropagation();
      saveFile();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveFile]);

  const rootList = entries.get(project.path);

  // Show the diff toggle only when the active file is dirty against HEAD.
  // Untracked is included so reviewers can see "all of this is new".
  const fileGitCode = explorerFile && gitFiles ? gitFiles[explorerFile] : undefined;
  const diffAvailable = !!fileGitCode;

  // Markdown gets a rendered-preview toggle. Hidden in diff mode (the diff is
  // inherently a text comparison) and meaningless for non-markdown files.
  const isMarkdown = !!explorerFile && isMarkdownPath(explorerFile);
  const showPreview = isMarkdown && previewMode && !diffMode;

  // Flat list of dirty files in the project, sorted by status code then path.
  // Filtered to descendants of project.path so multi-project repos don't bleed
  // changes from sibling projects sharing a toplevel.
  const changedFiles = useMemo(() => {
    if (!gitFiles) return [];
    const prefix = project.path + '/';
    const list: Array<{ path: string; rel: string; code: GitFileCode }> = [];
    for (const [abs, code] of Object.entries(gitFiles)) {
      if (!abs.startsWith(prefix)) continue;
      list.push({ path: abs, rel: abs.slice(prefix.length), code });
    }
    list.sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return a.rel.localeCompare(b.rel);
    });
    return list;
  }, [gitFiles, project.path]);

  const onChangeClick = (path: string) => {
    setExplorerFile(project.id, path);
    // Auto-flip into diff mode when picking from the changes list — that's
    // the whole point of clicking it. User can toggle back to plain view.
    setDiffMode(true);
  };

  // Roll up dirty descendants into a Set of ancestor directory paths so we
  // can paint a subtle marker on collapsed folders. Recomputes when the file
  // map changes; rooted under project.path so we don't bubble past the
  // project boundary even if the repo toplevel sits higher.
  const dirtyDirs = useMemo(() => {
    const set = new Set<string>();
    if (!gitFiles) return set;
    for (const abs of Object.keys(gitFiles)) {
      if (!abs.startsWith(project.path + '/')) continue;
      let dir = abs;
      while (true) {
        const slash = dir.lastIndexOf('/');
        if (slash <= 0) break;
        dir = dir.slice(0, slash);
        if (dir === project.path) break;
        if (set.has(dir)) break;
        set.add(dir);
      }
    }
    return set;
  }, [gitFiles, project.path]);

  return (
    <div className="explorer-view">
      <aside className="explorer-tree">
        <div className="explorer-tree-header">
          <span className="explorer-tree-title" title={project.path}>
            {project.name}
          </span>
          <button
            type="button"
            className={`opener-btn ${treeMode === 'changes' ? 'active' : ''}`}
            title={
              treeMode === 'changes'
                ? 'Show all files'
                : changedFiles.length > 0
                  ? `Show changes (${changedFiles.length})`
                  : 'No changes'
            }
            aria-pressed={treeMode === 'changes'}
            onClick={() =>
              setTreeMode((m) => (m === 'changes' ? 'files' : 'changes'))
            }
          >
            {treeMode === 'changes' ? <ListTree size={13} /> : <GitBranch size={13} />}
            {treeMode !== 'changes' && changedFiles.length > 0 && (
              <span className="opener-btn-badge">{changedFiles.length}</span>
            )}
          </button>
          <button type="button" className="opener-btn" title="Refresh" onClick={refresh}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="explorer-tree-body" ref={treeBodyRef}>
          {treeMode === 'changes' ? (
            changedFiles.length === 0 ? (
              <div className="tree-pane-empty">No changes.</div>
            ) : (
              <ChangesList
                files={changedFiles}
                activeFile={explorerFile}
                onClick={onChangeClick}
                onDiscard={discardFile}
              />
            )
          ) : rootList === undefined ? (
            <div className="tree-loading">Loading…</div>
          ) : rootList.length === 0 ? (
            <div className="tree-pane-empty">Empty directory.</div>
          ) : (
            <TreeList
              list={rootList}
              depth={0}
              expanded={expanded}
              entries={entries}
              loading={loading}
              activeFile={explorerFile}
              gitFiles={gitFiles}
              dirtyDirs={dirtyDirs}
              onToggleDir={toggleDir}
              onFileClick={onFileClick}
              onContext={onContext}
            />
          )}
        </div>
      </aside>
      <section className="explorer-viewer">
        {!explorerFile ? (
          <div className="explorer-viewer-empty">
            <FileText size={32} />
            <p>Select a file from the tree to view it.</p>
          </div>
        ) : fileLoading ? (
          <div className="explorer-viewer-empty">Loading…</div>
        ) : !fileResult ? null : !fileResult.ok ? (
          <div className="explorer-viewer-empty">
            <p>Failed to read file:</p>
            <p style={{ color: 'var(--danger)' }}>{fileResult.message}</p>
          </div>
        ) : fileResult.binary ? (
          <div className="explorer-viewer-empty">
            <p>Binary file ({formatBytes(fileResult.bytes ?? 0)})</p>
          </div>
        ) : (
          <>
            <div className="explorer-viewer-header">
              <span className="explorer-viewer-path" title={explorerFile}>
                {trimPath(explorerFile, project.path)}
                {isDirty && <span className="explorer-viewer-dirty" title="Unsaved changes">●</span>}
              </span>
              {fileResult.truncated && (
                <span className="explorer-viewer-warn">truncated · 2MB cap (read-only)</span>
              )}
              <span className="explorer-viewer-meta">
                {formatBytes(fileResult.bytes ?? 0)}
              </span>
              <span className="explorer-viewer-actions">
                {isDirty && (
                  <button
                    type="button"
                    className="opener-btn active"
                    title="Save (⌘S)"
                    disabled={saving}
                    onClick={saveFile}
                  >
                    <Save size={13} />
                  </button>
                )}
                {isMarkdown && !diffMode && (
                  <button
                    type="button"
                    className={`opener-btn ${previewMode ? 'active' : ''}`}
                    title={previewMode ? 'Edit markdown' : 'Preview markdown'}
                    aria-pressed={previewMode}
                    onClick={() => setPreviewMode((v) => !v)}
                  >
                    {previewMode ? <Pencil size={13} /> : <Eye size={13} />}
                  </button>
                )}
                {diffAvailable && (
                  <button
                    type="button"
                    className={`opener-btn ${diffMode ? 'active' : ''}`}
                    title={
                      diffMode
                        ? 'Show current file'
                        : 'Show diff against HEAD'
                    }
                    aria-pressed={diffMode}
                    onClick={() => setDiffMode((v) => !v)}
                  >
                    <GitCompare size={13} />
                  </button>
                )}
                <OpenerButtons path={explorerFile} />
              </span>
            </div>
            <div className="explorer-viewer-monaco">
              {showPreview ? (
                <div className="explorer-md-preview">
                  <div className="inbox-md">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                        table: (props) => (
                          <div className="inbox-md-table-wrap">
                            <table {...props} />
                          </div>
                        )
                      }}
                    >
                      {editedContent ?? fileResult.content ?? ''}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : diffMode ? (
                headLoading || !headResult ? (
                  <div className="explorer-viewer-empty">Loading HEAD…</div>
                ) : !headResult.ok ? (
                  <div className="explorer-viewer-empty">
                    <p>Failed to read HEAD:</p>
                    <p style={{ color: 'var(--danger)' }}>{headResult.message}</p>
                  </div>
                ) : headResult.binary ? (
                  <div className="explorer-viewer-empty">
                    <p>HEAD blob is binary; cannot diff as text.</p>
                  </div>
                ) : (
                  <DiffEditor
                    height="100%"
                    width="100%"
                    theme="vs-dark"
                    language={languageFromPath(explorerFile)}
                    original={headResult.content ?? ''}
                    modified={fileResult.content ?? ''}
                    originalModelPath={`head://${explorerFile}`}
                    modifiedModelPath={explorerFile}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'off'
                    }}
                  />
                )
              ) : (
                <Editor
                  height="100%"
                  width="100%"
                  theme="vs-dark"
                  path={explorerFile}
                  language={languageFromPath(explorerFile)}
                  value={editedContent ?? fileResult.content ?? ''}
                  onChange={(v) => {
                    if (v === undefined) return;
                    // Only flip into "dirty" when the value actually diverges
                    // from disk; an identical edit (revert) clears the buffer.
                    if (v === (fileResult.content ?? '')) {
                      setEditedContent(null);
                    } else {
                      setEditedContent(v);
                    }
                  }}
                  onMount={(ed) => {
                    editorRef.current = ed as unknown as typeof editorRef.current;
                    applyGoto();
                  }}
                  options={{
                    readOnly: fileResult.truncated,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    renderLineHighlight: 'all',
                    wordWrap: 'off'
                  }}
                />
              )}
            </div>
          </>
        )}
      </section>
      {menu && (
        <div
          className="tree-context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.entry.kind === 'file' && (
            <button onClick={() => { setExplorerFile(project.id, menu.entry.path); setMenu(null); }}>
              View in editor
            </button>
          )}
          <button onClick={() => { sendPathToTerminal(menu.entry.path); setMenu(null); }}>
            Send path to active terminal
          </button>
          <button onClick={() => { openInExternal('cursor', menu.entry.path); setMenu(null); }}>
            Open in Cursor
          </button>
          <button onClick={() => { openInExternal('code', menu.entry.path); setMenu(null); }}>
            Open in VS Code
          </button>
          <button onClick={() => { openInExternal('finder', menu.entry.path); setMenu(null); }}>
            Reveal in Finder
          </button>
          {menu.entry.kind === 'dir' && (
            <>
              <button onClick={() => { openShellHere(menu.entry.path); setMenu(null); }}>
                Open shell here
              </button>
              <button onClick={() => { openInExternal('terminal', menu.entry.path); setMenu(null); }}>
                Open in external Terminal
              </button>
            </>
          )}
          <button onClick={() => { copyPath(menu.entry.path); setMenu(null); }}>
            Copy path
          </button>
          {menu.entry.kind === 'file' && gitFiles?.[menu.entry.path] && (
            <button
              className="danger"
              onClick={() => { discardFile(menu.entry.path); setMenu(null); }}
            >
              {gitFiles[menu.entry.path] === '?' || gitFiles[menu.entry.path] === 'A'
                ? 'Delete file'
                : 'Discard changes'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface TreeListProps {
  list: FsEntry[];
  depth: number;
  expanded: Map<string, boolean>;
  entries: Map<string, FsEntry[]>;
  loading: Set<string>;
  activeFile: string | undefined;
  gitFiles: Record<string, GitFileCode> | undefined;
  dirtyDirs: Set<string>;
  onToggleDir: (entry: FsEntry) => void;
  onFileClick: (entry: FsEntry) => void;
  onContext: (e: React.MouseEvent, entry: FsEntry) => void;
}

function TreeList({
  list,
  depth,
  expanded,
  entries,
  loading,
  activeFile,
  gitFiles,
  dirtyDirs,
  onToggleDir,
  onFileClick,
  onContext
}: TreeListProps) {
  return (
    <>
      {list.map((entry) => {
        const isDir = entry.kind === 'dir';
        const isOpen = isDir && expanded.get(entry.path) === true;
        const children = isOpen ? entries.get(entry.path) : undefined;
        const isActive = !isDir && activeFile === entry.path;
        const fileCode = !isDir && gitFiles ? gitFiles[entry.path] : undefined;
        const dirHasChanges = isDir && dirtyDirs.has(entry.path);
        const gitClass = fileCode
          ? `git-${fileCode === '?' ? 'untracked' : fileCode.toLowerCase()}`
          : dirHasChanges
            ? 'git-dir-dirty'
            : '';
        const gitTitle = fileCode
          ? GIT_TITLES[fileCode]
          : dirHasChanges
            ? 'Contains changes'
            : '';
        return (
          <div key={entry.path}>
            <div
              className={`tree-row ${isDir ? 'dir' : 'file'} ${isActive ? 'active' : ''} ${gitClass}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => (isDir ? onToggleDir(entry) : onFileClick(entry))}
              onContextMenu={(e) => onContext(e, entry)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', entry.path);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={gitTitle || undefined}
            >
              <span className={`tree-chevron ${isDir ? '' : 'empty'}`}>
                {isDir && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              </span>
              <span className="tree-icon">
                {isDir ? <Folder size={13} /> : <FileText size={13} />}
              </span>
              <span className="tree-name" title={entry.name}>
                {entry.name}
              </span>
              {fileCode && <span className="tree-git-badge">{fileCode}</span>}
            </div>
            {isOpen && (
              children === undefined ? (
                loading.has(entry.path) ? (
                  <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                    Loading…
                  </div>
                ) : null
              ) : (
                <TreeList
                  list={children}
                  depth={depth + 1}
                  expanded={expanded}
                  entries={entries}
                  loading={loading}
                  activeFile={activeFile}
                  gitFiles={gitFiles}
                  dirtyDirs={dirtyDirs}
                  onToggleDir={onToggleDir}
                  onFileClick={onFileClick}
                  onContext={onContext}
                />
              )
            )}
          </div>
        );
      })}
    </>
  );
}

interface ChangesListProps {
  files: Array<{ path: string; rel: string; code: GitFileCode }>;
  activeFile: string | undefined;
  onClick: (path: string) => void;
  onDiscard: (path: string) => void;
}

function ChangesList({ files, activeFile, onClick, onDiscard }: ChangesListProps) {
  return (
    <>
      {files.map((f) => {
        const isActive = activeFile === f.path;
        const gitClass = `git-${f.code === '?' ? 'untracked' : f.code.toLowerCase()}`;
        const slash = f.rel.lastIndexOf('/');
        const dir = slash >= 0 ? f.rel.slice(0, slash) : '';
        const name = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        const discardLabel = f.code === '?' || f.code === 'A' ? 'Delete file' : 'Discard changes';
        return (
          <div
            key={f.path}
            className={`tree-row file changes-row ${isActive ? 'active' : ''} ${gitClass}`}
            style={{ paddingLeft: 6 }}
            onClick={() => onClick(f.path)}
            title={`${GIT_TITLES[f.code]} · ${f.rel}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', f.path);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <span className="tree-chevron empty" />
            <span className="tree-icon">
              <FileText size={13} />
            </span>
            <span className="tree-name" title={f.rel}>
              {name}
              {dir && <span className="changes-row-dir"> · {dir}</span>}
            </span>
            <button
              type="button"
              className="changes-row-discard"
              title={discardLabel}
              aria-label={discardLabel}
              onClick={(e) => {
                e.stopPropagation();
                onDiscard(f.path);
              }}
            >
              <Undo2 size={12} />
            </button>
            <span className="tree-git-badge">{f.code}</span>
          </div>
        );
      })}
    </>
  );
}

const GIT_TITLES: Record<GitFileCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  '?': 'Untracked',
  C: 'Conflict'
};

// Avoid handing monaco a fresh value on focus refresh when nothing actually
// changed — would otherwise blow away cursor position and selection.
function sameFileResult(a: FsReadResult | null, b: FsReadResult): boolean {
  if (!a) return false;
  if (a.ok !== b.ok) return false;
  if (a.binary !== b.binary) return false;
  if (a.content !== b.content) return false;
  return true;
}

function sameHeadResult(a: GitShowResult | null, b: GitShowResult): boolean {
  if (!a) return false;
  if (a.ok !== b.ok) return false;
  if (a.binary !== b.binary) return false;
  if (a.notInHead !== b.notInHead) return false;
  if (a.content !== b.content) return false;
  return true;
}

function trimPath(file: string, root: string) {
  if (file.startsWith(root)) {
    const rest = file.slice(root.length);
    return rest.startsWith('/') ? rest.slice(1) : rest;
  }
  return file;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown');
}

function languageFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    sql: 'sql',
    xml: 'xml',
    dockerfile: 'dockerfile'
  };
  return map[ext];
}
