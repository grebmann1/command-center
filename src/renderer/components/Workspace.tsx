import { lazy, Suspense, useEffect } from 'react';
import { TerminalSquare, FolderTree, GitBranch, Columns2, Rows2, LayoutGrid, Square } from 'lucide-react';
import type { SplitLayout } from '../store';
import { useData, useUi } from '../store';
import { TabBar } from './TabBar';
import { TerminalSurface } from './TerminalSurface';
import { ClaudeSessionsList } from './ClaudeSessionsList';
import { FindBar } from './FindBar';
import { OpenerButtons } from './OpenerButtons';

// Lazy-load both editor surfaces. monaco-editor (legacy) and monaco-vscode-api
// (workbench) both register default editor extensions into the same global
// `RegistryImpl` singleton — if both modules ever evaluate in the same
// renderer the second one throws "Assertion failed: There is already an
// extension with this id". Lazy-loading guarantees only the user's chosen
// surface is imported.
const ExplorerView = lazy(() =>
  import('./ExplorerView').then((m) => ({ default: m.ExplorerView }))
);
const WorkbenchView = lazy(() =>
  import('./WorkbenchView').then((m) => ({ default: m.WorkbenchView }))
);
import type { LaunchProfileId } from '@shared/types';

export function Workspace() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectTab = useUi((s) => s.selectTab);
  const findOpen = useUi((s) => s.findOpen);
  const workspaceModeMap = useUi((s) => s.workspaceMode);
  const toggleWorkspaceMode = useUi((s) => s.toggleWorkspaceMode);
  const workbenchEnabled = useUi((s) => s.workbenchEnabled);
  const splitLayoutMap = useUi((s) => s.splitLayout);
  const splitTabIdsMap = useUi((s) => s.splitTabIds);
  const setSplitLayout = useUi((s) => s.setSplitLayout);
  const openInSplit = useUi((s) => s.openInSplit);
  const removeFromSplit = useUi((s) => s.removeFromSplit);
  const closeSplit = useUi((s) => s.closeSplit);
  const createTerminal = useData((s) => s.createTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const reorderTerminal = useData((s) => s.reorderTerminal);
  const renameTerminal = useData((s) => s.renameTerminal);
  const setPinned = useData((s) => s.setPinned);
  const markExited = useData((s) => s.markExited);

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const gitStatus = useData((s) => (project ? s.gitStatus[project.id] : null)) ?? null;
  const tabs = project ? terminals[project.id] || [] : [];
  const activeTabId = project ? selectedTabId[project.id] : undefined;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const mode = project ? workspaceModeMap[project.id] ?? 'terminals' : 'terminals';
  const isExplorer = mode === 'explorer' && !!project;
  const splitLayout: SplitLayout = (project && splitLayoutMap[project.id]) || 'single';
  const splitTabIds = (project && splitTabIdsMap[project.id]) || [];
  const splitActive = splitLayout !== 'single';

  useEffect(() => {
    const off = window.cc.terminals.onExit((id) => markExited(id));
    return off;
  }, [markExited]);

  useEffect(() => {
    if (!project) return;
    if (tabs.length === 0) {
      if (activeTabId !== undefined) selectTab(project.id, undefined);
      return;
    }
    if (!tabs.find((t) => t.id === activeTabId)) {
      selectTab(project.id, tabs[tabs.length - 1].id);
    }
  }, [project, tabs, activeTabId, selectTab]);

  const handleNewTab = async (
    profile: LaunchProfileId,
    opts?: { extraArgs?: string[]; title?: string }
  ) => {
    if (!project) return;
    const session = await createTerminal(project.id, profile, 80, 24, opts);
    if (session) selectTab(project.id, session.id);
  };

  // First entry in defaultAgents wins for one-click "+" semantics. We trust
  // the value as a LaunchProfileId only if it matches the known set; an
  // unknown string falls back to the picker.
  const KNOWN_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];
  const projectDefaultProfile = (() => {
    const first = project?.defaultAgents?.[0];
    if (!first) return undefined;
    return (KNOWN_PROFILES as string[]).includes(first) ? (first as LaunchProfileId) : undefined;
  })();

  // Split layouts (vertical/horizontal/grid) are wired up in the store and
  // TerminalSurface but the toolbar picker is hidden for now — feels off in
  // practice. Flip this to re-enable. Right-click "Open in split" entries on
  // the TabBar are also gated below.
  const SPLIT_UI_ENABLED = false;

  // Layout picker: only meaningful when terminals are visible (not explorer
  // mode) and the project has at least one tab. Hidden otherwise.
  const layoutPicker = SPLIT_UI_ENABLED && project && !isExplorer && tabs.length > 0 && (
    <div className="workspace-layout-picker" role="group" aria-label="Terminal layout">
      <button
        type="button"
        className={splitLayout === 'single' ? 'active' : ''}
        title="Single pane"
        onClick={() => closeSplit(project.id)}
      >
        <Square size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'vertical' ? 'active' : ''}
        title="Vertical split"
        onClick={() => setSplitLayout(project.id, 'vertical')}
      >
        <Columns2 size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'horizontal' ? 'active' : ''}
        title="Horizontal split"
        onClick={() => setSplitLayout(project.id, 'horizontal')}
      >
        <Rows2 size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'grid' ? 'active' : ''}
        title="2×2 grid"
        onClick={() => setSplitLayout(project.id, 'grid')}
      >
        <LayoutGrid size={13} />
      </button>
    </div>
  );

  const modeToggle = project && (
    <button
      type="button"
      className="workspace-mode-toggle"
      onClick={() => toggleWorkspaceMode(project.id)}
      title={isExplorer ? 'Switch to Terminals (⌘B)' : 'Switch to Explorer (⌘B)'}
    >
      {isExplorer ? <TerminalSquare size={14} /> : <FolderTree size={14} />}
      <span>{isExplorer ? 'Terminals' : 'Explorer'}</span>
    </button>
  );

  // Always mount TerminalSurface (preserves scrollback). When in explorer mode
  // we visually swap the middle section to ExplorerView via display:none.
  return (
    <main className="workspace">
      <div className="workspace-topbar">
        {!isExplorer ? (
          <TabBar
            tabs={tabs}
            activeTabId={activeTab?.id}
            onSelect={(id) => project && selectTab(project.id, id)}
            onClose={(id) => project && closeTerminal(id, project.id)}
            onNew={handleNewTab}
            onReorder={(from, to) => project && reorderTerminal(project.id, from, to)}
            onRename={(id, title) => project && renameTerminal(project.id, id, title)}
            onDuplicate={(id) => {
              if (!project) return;
              const src = tabs.find((t) => t.id === id);
              if (!src) return;
              handleNewTab(src.profile, { extraArgs: src.extraArgs, title: src.title });
            }}
            onPin={(id, pinned) => project && setPinned(project.id, id, pinned)}
            defaultProfile={projectDefaultProfile}
            splitTabIds={SPLIT_UI_ENABLED ? splitTabIds : undefined}
            splitActive={SPLIT_UI_ENABLED && splitActive}
            onOpenInSplit={SPLIT_UI_ENABLED ? (id) => project && openInSplit(project.id, id) : undefined}
            onRemoveFromSplit={SPLIT_UI_ENABLED ? (id) => project && removeFromSplit(project.id, id) : undefined}
            onCloseSplit={SPLIT_UI_ENABLED && project ? () => closeSplit(project.id) : undefined}
          />
        ) : (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Explorer</span>
          </div>
        )}
        {layoutPicker}
        {modeToggle}
      </div>
      <div className="workspace-body">
        <div
          className="terminal-host"
          style={{ display: isExplorer ? 'none' : undefined }}
        >
          <TerminalSurface />
          {findOpen && activeTab && <FindBar sessionId={activeTab.id} />}
          {!project ? (
            <div className="empty-workspace overlay">
              <div>
                <h3>Select a project</h3>
                <p>Or add one with the + button on the left.</p>
              </div>
            </div>
          ) : tabs.length === 0 ? (
            <div className="empty-workspace overlay">
              <div className="empty-inner">
                <h3>{project.name}</h3>
                <p>Start a session:</p>
                <div className="empty-actions">
                  <button className="btn primary" onClick={() => handleNewTab('claude')}>
                    claude
                  </button>
                  <button
                    className="btn"
                    onClick={() => handleNewTab('claude-yolo')}
                    title="claude --dangerously-skip-permissions"
                  >
                    claude --yolo
                  </button>
                  <button className="btn" onClick={() => handleNewTab('shell')}>
                    shell
                  </button>
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                  <OpenerButtons path={project.path} size={16} />
                </div>
                <ClaudeSessionsList
                  projectId={project.id}
                  onResume={(s) =>
                    handleNewTab('claude', {
                      extraArgs: ['--resume', s.id],
                      title: `claude --resume · ${s.id.slice(0, 7)}`
                    })
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
        {isExplorer && project && (
          <Suspense
            fallback={<div className="workbench-status">Loading explorer…</div>}
          >
            {workbenchEnabled ? (
              <WorkbenchView project={project} />
            ) : (
              <ExplorerView project={project} />
            )}
          </Suspense>
        )}
      </div>
      <div className="statusbar">
        <span>{project?.path ?? '—'}</span>
        {gitStatus && (gitStatus.branch || gitStatus.detached) && (
          <span
            className={`statusbar-git ${gitStatus.dirty ? 'dirty' : ''}`}
            title={
              gitStatus.dirty
                ? 'Working tree has uncommitted changes'
                : 'Working tree clean'
            }
          >
            <GitBranch size={11} />
            <span>{gitStatus.detached ? 'detached' : gitStatus.branch}</span>
            {gitStatus.ahead > 0 && <span className="statusbar-git-ab">↑{gitStatus.ahead}</span>}
            {gitStatus.behind > 0 && <span className="statusbar-git-ab">↓{gitStatus.behind}</span>}
            {gitStatus.dirty && <span className="statusbar-git-dot" aria-hidden="true">●</span>}
          </span>
        )}
        <span className="grow" />
        {!isExplorer && activeTab && (
          <>
            <span>{activeTab.profile}</span>
            <span>pid {activeTab.pid ?? '—'}</span>
            <span>{activeTab.status}</span>
          </>
        )}
      </div>
    </main>
  );
}
