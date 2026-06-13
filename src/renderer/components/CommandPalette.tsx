import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { useData, useScheduler, useUi, visibleTerminals } from '../store';
import type { LaunchProfileId, WalkedFile, SlashCommand } from '@shared/types';
import { fuzzyScore } from '../util/fuzzy';
import { useMergedModules } from '../modules';
import { buildPaletteItems, type PaletteItem, type PaletteCategory } from './palette/buildItems';
import { highlightMatches } from './palette/highlight';
import type { WhenContext } from './palette/whenContext';
import { recordUse, recencyBoost, getRecents } from '../util/paletteRecents';

interface Props {
  onClose: () => void;
}

// Empty-query (landing) view caps for the UNBOUNDED categories, so a long
// project/tab list doesn't bury the fixed Actions. Categories absent here
// (Actions, Extensions) are shown in full. Typing lifts the cap entirely.
const EMPTY_CATEGORY_CAP: Partial<Record<PaletteCategory, number>> = {
  Projects: 5,
  Tabs: 5,
  Commands: 6
};

/** A scored command row (typed-query mode). `labelMatchIdx` is set only when
 *  the *label itself* produced the winning score, so highlighting never paints
 *  positions from a hint/keyword-derived match. */
interface ScoredRow {
  item: PaletteItem;
  labelMatchIdx?: number[];
}

/** A file row in `@` mode. */
interface FileRow {
  file: WalkedFile;
  matchIdx: number[];
}

// Per-root file cache, lifetime = renderer process. Mirrors QuickOpen so the
// `@` mode reuses an already-warmed index when the user has opened QuickOpen.
const fileCache = new Map<string, WalkedFile[]>();
const FILE_MAX_RESULTS = 80;

// Per-project slash-command cache (keyed by project path; '' = no project),
// so reopening the palette paints commands instantly while a fresh list loads.
const commandCache = new Map<string, SlashCommand[]>();

export function CommandPalette({ onClose }: Props) {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const addProject = useData((s) => s.addProject);
  const createTerminal = useData((s) => s.createTerminal);
  const restartTerminal = useData((s) => s.restartTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const reopenLastClosed = useData((s) => s.reopenLastClosed);
  const restoreLastDetached = useData((s) => s.restoreLastDetached);
  const setPinned = useData((s) => s.setPinned);
  const scheduledTasks = useScheduler((s) => s.tasks);
  const modules = useMergedModules();
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const setOverviewOpen = useUi((s) => s.setOverviewOpen);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const nav = useUi((s) => s.nav);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const workspaceModeMap = useUi((s) => s.workspaceMode);
  const recentFilesMap = useUi((s) => s.recentFiles);
  const pushToast = useUi((s) => s.pushToast);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedProjectTabs = selectedProject ? visibleTerminals(terminals[selectedProject.id]) : [];
  const activeTabId = selectedProject ? selectedTabId[selectedProject.id] : undefined;
  const activeTab = selectedProjectTabs.find((t) => t.id === activeTabId);

  const launch = async (profile: LaunchProfileId) => {
    if (!selectedProject) return;
    const session = await createTerminal(selectedProject.id, profile, 80, 24);
    if (session) {
      selectTab(selectedProject.id, session.id);
      setWorkspaceMode(selectedProject.id, 'terminals');
    }
  };

  // Open a fresh Claude tab running a slash command (the command rides in as
  // the opening prompt → positional argv, handled in main).
  const launchCommand = async (invocation: string, yolo: boolean) => {
    if (!selectedProject) return;
    const profile: LaunchProfileId = yolo ? 'claude-yolo' : 'claude';
    const session = await createTerminal(selectedProject.id, profile, 80, 24, {
      prompt: invocation,
      title: invocation
    });
    if (session) {
      selectTab(selectedProject.id, session.id);
      setWorkspaceMode(selectedProject.id, 'terminals');
      setNav('projects');
    }
  };

  // Send a slash command into the focused live Claude session, as if typed.
  const sendCommandToActiveTab = (invocation: string) => {
    if (!activeTab) return;
    void window.cc.terminals.reply(activeTab.id, invocation);
    if (selectedProject) {
      setWorkspaceMode(selectedProject.id, 'terminals');
      setNav('projects');
    }
  };

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // `@`-prefixed query → file-search mode (only meaningful with a project).
  const fileMode = query.startsWith('@') && selectedProject !== null;
  const fileQuery = fileMode ? query.slice(1).trim() : '';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrow-keying past the visible
  // window. `block: 'nearest'` avoids jumpy centering when the row is
  // already on-screen.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // --- file index (lazy, only once `@` mode is entered) --------------------
  const [files, setFiles] = useState<WalkedFile[] | null>(null);
  useEffect(() => {
    if (!fileMode || !selectedProject) return;
    const cached = fileCache.get(selectedProject.path);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    setFiles(null);
    window.cc.fs.walkFiles(selectedProject.path)
      .then((list) => {
        if (cancelled) return;
        fileCache.set(selectedProject.path, list);
        setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => { cancelled = true; };
  }, [fileMode, selectedProject?.path]);

  // --- slash commands (loaded once per palette open, scoped to the project) -
  // Seed synchronously from the per-project cache so reopening the palette
  // paints commands immediately, then refresh in the background.
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
    () => commandCache.get(selectedProject?.path ?? '') ?? []
  );
  useEffect(() => {
    let cancelled = false;
    window.cc.commands.list(selectedProject?.path)
      .then((cmds) => {
        if (cancelled) return;
        commandCache.set(selectedProject?.path ?? '', cmds);
        setSlashCommands(cmds);
      })
      .catch(() => { if (!cancelled) setSlashCommands([]); });
    return () => { cancelled = true; };
  }, [selectedProject?.path]);

  // --- coarse, non-sensitive context for extension `when` evaluation -------
  const whenCtx = useMemo<WhenContext>(() => {
    const platform = navigator.platform.toUpperCase().includes('MAC')
      ? 'darwin'
      : navigator.platform.toUpperCase().includes('WIN') ? 'win32' : 'linux';
    return {
      activeNav: String(nav),
      hasActiveProject: selectedProject !== null,
      hasActiveTab: activeTab !== undefined,
      tabCount: selectedProjectTabs.length,
      activeTabStatus: activeTab?.status ?? '',
      activeTabProfile: activeTab?.profile ?? '',
      workspaceMode: selectedProject ? (workspaceModeMap[selectedProject.id] ?? 'terminals') : '',
      platform,
      // Per-command override happens in the adapter; default false here.
      panelFocused: false
    };
  }, [nav, selectedProject, activeTab, selectedProjectTabs.length, workspaceModeMap]);

  const items = useMemo<PaletteItem[]>(() => buildPaletteItems({
    projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, modules, slashCommands, overviewOpen, whenCtx, onClose, launch,
    launchCommand, sendCommandToActiveTab, addProject,
    setNav, selectProject, selectTab, setWorkspaceMode, setSettingsTab,
    setOverviewOpen, setPinned, restartTerminal, closeTerminal, reopenLastClosed,
    restoreLastDetached, pushToast
  }), [projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, modules, slashCommands, overviewOpen, whenCtx, onClose, addProject, setNav,
    selectProject, selectTab, setWorkspaceMode, setSettingsTab, setOverviewOpen,
    setPinned, restartTerminal, closeTerminal, reopenLastClosed, restoreLastDetached, pushToast]);

  // --- command filtering / ranking -----------------------------------------
  const rows = useMemo<ScoredRow[]>(() => {
    if (fileMode) return [];
    const q = query.trim();
    if (!q) {
      // Empty query: a CURATED landing view, not the full list. Keep the
      // natural projects→tabs→actions→extensions grouping and float
      // recently/frequently used items up *within* each category, but CAP the
      // unbounded categories (Projects, Tabs) to their few most-recent so the
      // fixed Actions don't get pushed off-screen by a long project list.
      // Typing reveals everything (the typed path below scans all items).
      //
      // We group first (preserving each category's first-appearance order) then
      // stable-sort each group by boost — NOT a single global comparator, which
      // would interleave categories (fragmenting the section headers) and be
      // non-transitive against the cross-category idx comparison.
      const recents = getRecents();
      const now = Date.now();
      const groups: PaletteItem[][] = [];
      const groupByCategory = new Map<string, PaletteItem[]>();
      for (const item of items) {
        let g = groupByCategory.get(item.category);
        if (!g) { g = []; groupByCategory.set(item.category, g); groups.push(g); }
        g.push(item);
      }
      const out: ScoredRow[] = [];
      for (const g of groups) {
        const sorted = g
          .map((item, idx) => ({ item, idx, boost: recencyBoost(item.key, recents, now) }))
          .sort((a, b) => (b.boost - a.boost) || (a.idx - b.idx));
        const cap = EMPTY_CATEGORY_CAP[g[0].category];
        (cap ? sorted.slice(0, cap) : sorted).forEach(({ item }) => out.push({ item }));
      }
      return out;
    }
    const recents = getRecents();
    const now = Date.now();
    const scored: Array<{ item: PaletteItem; score: number; idx: number; boost: number; labelMatchIdx?: number[] }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lm = fuzzyScore(it.label, q);
      let score = lm?.score ?? -Infinity;
      // Highlight only when the label is the source of the chosen score.
      let labelMatchIdx: number[] | undefined = lm ? lm.matchIdx : undefined;
      if (it.hint) {
        const hm = fuzzyScore(it.hint, q);
        if (hm) {
          const hintScore = hm.score * 0.5;
          if (hintScore > score) { score = hintScore; labelMatchIdx = undefined; }
        }
      }
      if (it.keywords) {
        for (const kw of it.keywords) {
          const km = fuzzyScore(kw, q);
          if (km) {
            const kwScore = km.score * 0.5;
            if (kwScore > score) { score = kwScore; labelMatchIdx = undefined; }
          }
        }
      }
      if (score > -Infinity) {
        scored.push({ item: it, score, idx: i, boost: recencyBoost(it.key, recents, now), labelMatchIdx });
      }
    }
    // Fuzzy score dominates; recency is only a final, bounded tiebreaker.
    scored.sort((a, b) => (b.score - a.score) || (b.boost - a.boost) || (a.idx - b.idx));
    return scored.map((s) => ({ item: s.item, labelMatchIdx: s.labelMatchIdx }));
  }, [items, query, fileMode]);

  // How many items each capped category hides in the empty-query landing view,
  // so the section header can show a "+N more — type to search" affordance.
  // Empty only — typing lifts the caps, so there's nothing hidden to announce.
  const overflow = useMemo<Partial<Record<PaletteCategory, number>>>(() => {
    if (fileMode || query.trim() !== '') return {};
    const counts: Partial<Record<PaletteCategory, number>> = {};
    for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + 1;
    const out: Partial<Record<PaletteCategory, number>> = {};
    for (const [cat, total] of Object.entries(counts) as [PaletteCategory, number][]) {
      const cap = EMPTY_CATEGORY_CAP[cat];
      if (cap && total > cap) out[cat] = total - cap;
    }
    return out;
  }, [items, query, fileMode]);

  // --- file rows (@ mode) ----------------------------------------------------
  const fileRows = useMemo<FileRow[]>(() => {
    if (!fileMode || !files) return [];
    if (!fileQuery) {
      // Empty `@`: lead with the project's MRU, then walk order.
      const recents = selectedProject ? (recentFilesMap[selectedProject.id] ?? []) : [];
      const byPath = new Map(files.map((f) => [f.path, f] as const));
      const seen = new Set<string>();
      const out: FileRow[] = [];
      for (const path of recents) {
        const f = byPath.get(path);
        if (!f) continue;
        seen.add(path);
        out.push({ file: f, matchIdx: [] });
        if (out.length >= FILE_MAX_RESULTS) return out;
      }
      for (const f of files) {
        if (seen.has(f.path)) continue;
        out.push({ file: f, matchIdx: [] });
        if (out.length >= FILE_MAX_RESULTS) break;
      }
      return out;
    }
    const out: Array<FileRow & { score: number }> = [];
    for (const file of files) {
      const r = fuzzyScore(file.rel, fileQuery);
      if (r) out.push({ file, matchIdx: r.matchIdx, score: r.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, FILE_MAX_RESULTS).map(({ file, matchIdx }) => ({ file, matchIdx }));
  }, [fileMode, files, fileQuery, selectedProject, recentFilesMap]);

  const chooseFile = (file: WalkedFile) => {
    if (!selectedProject) return;
    setWorkspaceMode(selectedProject.id, 'explorer');
    setExplorerFile(selectedProject.id, file.path);
    onClose();
  };

  const runItem = (item: PaletteItem) => {
    recordUse(item.key);
    item.run();
  };

  // Active-row count for keyboard bounds (commands or files, depending on mode).
  const rowCount = fileMode ? fileRows.length : rows.length;

  useEffect(() => {
    if (activeIdx >= rowCount) setActiveIdx(0);
  }, [rowCount, activeIdx]);

  // Reset selection to the top whenever the query changes (incl. entering /
  // leaving `@` mode) so the highlight never points at a stale row.
  useEffect(() => { setActiveIdx(0); }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, rowCount - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActiveIdx(Math.max(0, rowCount - 1)); return; }
    if (e.key === 'PageDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 8, rowCount - 1)); return; }
    if (e.key === 'PageUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 8, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (fileMode) { const r = fileRows[activeIdx]; if (r) chooseFile(r.file); }
      else { rows[activeIdx]?.item && runItem(rows[activeIdx].item); }
    }
  };

  // Empty-query (command mode) shows section headers; typing collapses them.
  const showHeaders = !fileMode && query.trim() === '';

  const placeholder = fileMode
    ? (selectedProject
        ? (files === null ? `Indexing ${selectedProject.name}…` : `Find file in ${selectedProject.name}…`)
        : 'Find file…')
    : 'Type to search · @ to find files…';

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {fileMode
            ? renderFileRows(files, fileRows, activeIdx, setActiveIdx, chooseFile)
            : renderCommandRows(rows, showHeaders, activeIdx, setActiveIdx, runItem, overflow)}
        </div>
      </div>
    </div>
  );
}

function renderFileRows(
  files: WalkedFile[] | null,
  fileRows: FileRow[],
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  chooseFile: (f: WalkedFile) => void
) {
  if (files === null) return <div className="palette-empty">Indexing project files…</div>;
  if (fileRows.length === 0) return <div className="palette-empty">No matching files</div>;
  return fileRows.map((r, i) => (
    <button
      key={r.file.path}
      data-idx={i}
      className={`palette-item ${i === activeIdx ? 'active' : ''}`}
      onMouseEnter={() => setActiveIdx(i)}
      onClick={() => chooseFile(r.file)}
    >
      <span className="palette-icon"><FileText size={14} /></span>
      <span className="palette-label">{highlightMatches(r.file.rel, r.matchIdx)}</span>
    </button>
  ));
}

function renderCommandRows(
  rows: ScoredRow[],
  showHeaders: boolean,
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  runItem: (item: PaletteItem) => void,
  overflow: Partial<Record<PaletteCategory, number>>
) {
  if (rows.length === 0) return <div className="palette-empty">No matches</div>;

  const renderRow = (row: ScoredRow, i: number) => (
    <button
      key={row.item.key}
      data-idx={i}
      className={`palette-item ${i === activeIdx ? 'active' : ''}`}
      onMouseEnter={() => setActiveIdx(i)}
      onClick={() => runItem(row.item)}
    >
      <span className="palette-icon">{row.item.icon}</span>
      <span className="palette-label">
        {row.labelMatchIdx ? highlightMatches(row.item.label, row.labelMatchIdx) : row.item.label}
      </span>
      {row.item.hint && <span className="palette-hint">{row.item.hint}</span>}
      <ChevronRight size={12} className="palette-chev" />
    </button>
  );

  if (!showHeaders) return rows.map(renderRow);

  // Empty-query: insert non-interactive section headers between category
  // groups. Headers live OUTSIDE the row index space — `data-idx` stays aligned
  // with the flat `rows` array so arrow-key navigation skips headers cleanly.
  const out: React.ReactNode[] = [];
  let lastCategory: string | null = null;
  let lastSource: string | null = null;
  rows.forEach((row, i) => {
    if (row.item.category !== lastCategory) {
      lastCategory = row.item.category;
      lastSource = null;
      const more = overflow[row.item.category];
      out.push(
        <div key={`hdr:${row.item.category}`} className="palette-section">
          <span>{row.item.category}</span>
          {more ? <span className="palette-section-more">+{more} more · type to search</span> : null}
        </div>
      );
    }
    // Within Extensions, sub-group by the extension's source title.
    if (row.item.category === 'Extensions' && row.item.source !== lastSource) {
      lastSource = row.item.source;
      out.push(<div key={`sub:${row.item.source}`} className="palette-subsection">{row.item.source}</div>);
    }
    out.push(renderRow(row, i));
  });
  return out;
}
