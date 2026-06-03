import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ListPane } from './components/ListPane';
import { Workspace } from './components/Workspace';
import { OverviewPanel } from './components/OverviewPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { InboxView } from './components/InboxView';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { ResumePicker } from './components/ResumePicker';
import { SearchPanel } from './components/SearchPanel';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { ProjectSettingsDrawer } from './components/ProjectSettingsDrawer';
import { Toaster } from './components/Toaster';
import { scheduleGitRefresh, useData, useUi } from './store';
import { installShortcuts } from './shortcuts';

export function App() {
  const init = useData((s) => s.init);
  const nav = useUi((s) => s.nav);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);

  // Reflect the current project + active tab into the OS window title so
  // ⌘-Tab / Mission Control disambiguates Command Center across projects.
  useEffect(() => {
    const base = 'Claude Code Terminal Center';
    if (nav === 'settings') {
      document.title = `Settings · ${base}`;
      return;
    }
    if (nav === 'inbox') {
      document.title = `Inbox · ${base}`;
      return;
    }
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      document.title = base;
      return;
    }
    const tabs = terminals[project.id] || [];
    const activeId = selectedTabId[project.id];
    const active = tabs.find((t) => t.id === activeId);
    document.title = active
      ? `${active.title} · ${project.name} — ${base}`
      : `${project.name} — ${base}`;
  }, [nav, selectedProjectId, selectedTabId, projects, terminals]);

  useEffect(() => {
    init();
    const offShortcuts = installShortcuts();
    const offData = window.cc.terminals.onData((id) => {
      const ui = useUi.getState();
      const data = useData.getState();
      // find which project owns this session
      let owningProjectId: string | null = null;
      for (const pid of Object.keys(data.terminals)) {
        if (data.terminals[pid].some((t) => t.id === id)) {
          owningProjectId = pid;
          break;
        }
      }
      if (!owningProjectId) return;
      const isActive =
        ui.selectedProjectId === owningProjectId &&
        ui.selectedTabId[owningProjectId] === id;
      if (!isActive) ui.markUnread(id);
      // Coalesce bursts of terminal output into a single git status refresh
      // so commits/pulls/branch swaps inside a tab show up promptly.
      scheduleGitRefresh(owningProjectId);
    });
    const onFocus = () => {
      useData.getState().refreshAllGitStatus();
    };
    window.addEventListener('focus', onFocus);
    // Bridge native menu items (File / View / Help submenus) back to the
    // same store actions the in-renderer keyboard shortcuts use.
    const offMenu = window.cc.app.onMenuEvent((event) => {
      const ui = useUi.getState();
      const data = useData.getState();
      const projectId = ui.selectedProjectId;
      switch (event) {
        case 'app:openSettings':
          ui.setNav(ui.nav === 'settings' ? 'projects' : 'settings');
          return;
        case 'app:openPalette':
          ui.setPaletteOpen(true);
          return;
        case 'app:openShortcuts':
          ui.setShortcutsOpen(!ui.shortcutsOpen);
          return;
        case 'app:toggleWorkspaceMode':
          if (projectId) ui.toggleWorkspaceMode(projectId);
          return;
        case 'app:newClaudeTab':
          if (projectId) {
            data.createTerminal(projectId, 'claude', 80, 24).then((s) => {
              if (s) ui.selectTab(projectId, s.id);
            });
          }
          return;
        case 'app:reopenTab':
          if (projectId) {
            data.reopenLastClosed(projectId).then((s) => {
              if (s) ui.selectTab(projectId, s.id);
            });
          }
          return;
        case 'app:closeTab': {
          if (!projectId) return;
          const activeId = ui.selectedTabId[projectId];
          if (!activeId) return;
          const tab = (data.terminals[projectId] ?? []).find((t) => t.id === activeId);
          if (tab?.pinned) return;
          data.closeTerminal(activeId, projectId);
          return;
        }
      }
    });
    return () => {
      offShortcuts();
      offData();
      offMenu();
      window.removeEventListener('focus', onFocus);
    };
  }, [init]);

  return (
    <div className="app-shell">
      <div className="titlebar">Claude Code Terminal Center</div>
      <Sidebar />
      <ListPane />
      <div className={`main-slot ${nav === 'projects' && !overviewOpen ? 'show' : 'hide'}`}>
        <Workspace />
      </div>
      {nav === 'projects' && overviewOpen && <OverviewPanel />}
      {nav === 'inbox' && <InboxView />}
      {nav === 'settings' && <SettingsPanel />}
      <CommandPaletteHost />
      <QuickOpenHost />
      <ResumePickerHost />
      <SearchPanelHost />
      <ShortcutsHelpHost />
      <ProjectSettingsDrawerHost />
      <Toaster />
    </div>
  );
}

function CommandPaletteHost() {
  const open = useUi((s) => s.paletteOpen);
  const close = () => useUi.getState().setPaletteOpen(false);
  if (!open) return null;
  return <CommandPalette onClose={close} />;
}

function QuickOpenHost() {
  const open = useUi((s) => s.quickOpenOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setQuickOpenOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <QuickOpen project={project} onClose={close} />;
}

function ResumePickerHost() {
  const open = useUi((s) => s.resumeOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setResumeOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <ResumePicker project={project} onClose={close} />;
}

function SearchPanelHost() {
  const open = useUi((s) => s.searchOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setSearchOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <SearchPanel project={project} onClose={close} />;
}

function ShortcutsHelpHost() {
  const open = useUi((s) => s.shortcutsOpen);
  const close = () => useUi.getState().setShortcutsOpen(false);
  if (!open) return null;
  return <ShortcutsHelp onClose={close} />;
}

function ProjectSettingsDrawerHost() {
  const projectId = useUi((s) => s.projectSettingsOpen);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setProjectSettingsOpen(null);
  if (!projectId) return null;
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  return <ProjectSettingsDrawer project={project} onClose={close} />;
}
