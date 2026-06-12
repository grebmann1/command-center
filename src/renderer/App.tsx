import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ListPane } from './components/ListPane';
import { Workspace } from './components/Workspace';
import { OverviewPanel } from './components/OverviewPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SchedulerPanel } from './components/SchedulerPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { PluginsPanel } from './components/PluginsPanel';
import { McpPanel } from './components/McpPanel';
import { InboxView } from './components/InboxView';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { ResumePicker } from './components/ResumePicker';
import { SearchPanel } from './components/SearchPanel';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Toaster } from './components/Toaster';
import { ModulePanelHost } from './modules/ModulePanelHost';
import { useMergedModules } from './modules';
import { initExtensionModules, reconcileExtensionModules } from './modules/loader';
import {
  scheduleGitRefresh,
  useData,
  useUi,
  useUnreadInboxCount,
  visibleTerminals
} from './store';
import type { LaunchProfileId } from '@shared/types';

const KNOWN_LAUNCH_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];
import { installShortcuts } from './shortcuts';

export function App() {
  const init = useData((s) => s.init);
  const nav = useUi((s) => s.nav);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const unreadInbox = useUnreadInboxCount();
  const modules = useMergedModules();

  // Reflect the current project + active tab into the OS window title so
  // ⌘-Tab / Mission Control disambiguates Command Center across projects.
  useEffect(() => {
    const base = 'Claude Code Terminal Center';
    const inboxBadge = unreadInbox > 0 && nav !== 'inbox' ? `(${unreadInbox}) ` : '';
    if (nav === 'settings') {
      document.title = `${inboxBadge}Settings · ${base}`;
      return;
    }
    if (nav === 'inbox') {
      document.title = `Inbox · ${base}`;
      return;
    }
    if (nav === 'scheduler') {
      document.title = `${inboxBadge}Scheduler · ${base}`;
      return;
    }
    if (nav === 'skills') {
      document.title = `${inboxBadge}Skills · ${base}`;
      return;
    }
    if (nav === 'plugins') {
      document.title = `${inboxBadge}Plugins · ${base}`;
      return;
    }
    if (nav === 'mcp') {
      document.title = `${inboxBadge}MCP · ${base}`;
      return;
    }
    const activeModule = modules.find((m) => m.id === nav);
    if (activeModule) {
      document.title = `${inboxBadge}${activeModule.titleLabel ?? activeModule.title} · ${base}`;
      return;
    }
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      document.title = `${inboxBadge}${base}`;
      return;
    }
    const tabs = visibleTerminals(terminals[project.id]);
    const activeId = selectedTabId[project.id];
    const active = tabs.find((t) => t.id === activeId);
    document.title = active
      ? `${inboxBadge}${active.title} · ${project.name} — ${base}`
      : `${inboxBadge}${project.name} — ${base}`;
  }, [nav, selectedProjectId, selectedTabId, projects, terminals, unreadInbox, modules]);

  // Discover + load runtime extension panels at startup, then re-reconcile on
  // every `extensions:onChanged` push (enable/disable/install/remove). The
  // loaded set lands in the extension-modules store, which feeds the merged
  // module set the shell renders from. Renderer-only / already-loaded
  // extensions reconcile live; enabling a not-yet-loaded main side still needs
  // a relaunch (per P1-B), and that relaunch re-runs this init.
  useEffect(() => {
    void initExtensionModules();
    const off = window.cc.extensions.onChanged((entries) => {
      void reconcileExtensionModules(entries);
    });
    return off;
  }, []);

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
        case 'app:toggleInbox':
          ui.setNav(ui.nav === 'inbox' ? 'projects' : 'inbox');
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
            const project = data.projects.find((p) => p.id === projectId);
            const first = project?.defaultAgents?.[0];
            const profile: LaunchProfileId =
              first && (KNOWN_LAUNCH_PROFILES as string[]).includes(first)
                ? (first as LaunchProfileId)
                : 'claude';
            data.createTerminal(projectId, profile, 80, 24).then((s) => {
              if (s) ui.selectTab(projectId, s.id);
            });
          }
          return;
        case 'app:reopenTab':
          if (projectId) {
            // Mirror ⌘⇧T: resume the newest detached session first, else
            // reopen the last closed tab.
            data.restoreLastDetached(projectId).then((restored) => {
              if (restored) return;
              data.reopenLastClosed(projectId).then((s) => {
                if (s) ui.selectTab(projectId, s.id);
              });
            });
          }
          return;
        case 'app:closeTab': {
          if (!projectId) return;
          const activeId = ui.selectedTabId[projectId];
          if (!activeId) return;
          const tab = (data.terminals[projectId] ?? []).find((t) => t.id === activeId);
          if (tab?.pinned) return;
          // ⌘W hides the active tab (does NOT kill the process): a live session
          // detaches to the background, an exited tombstone is dismissed.
          // Terminating is only via the tab's right-click → Delete. ⌘⇧T reopens.
          if (tab && tab.status !== 'exited') {
            data.hideTerminal(activeId, projectId);
          } else {
            data.closeTerminal(activeId, projectId);
          }
          return;
        }
      }
    });
    const offFocusSession = window.cc.app.onFocusSession((sessionId, projectId) => {
      const ui = useUi.getState();
      ui.setNav('projects');
      ui.selectProject(projectId);
      // restoreTerminal un-hides a headless session (e.g. a scheduled run)
      // AND selects it. selectTab alone silently no-ops for a headless id, so
      // the tray "focus session" click would otherwise focus nothing. Safe for
      // already-visible sessions too.
      void useData.getState().restoreTerminal(sessionId, projectId);
    });
    // Tray "Open Scheduler" / per-schedule "Show in Scheduler". With a task id
    // we jump to that schedule's scope and reveal the row; without one we land
    // on the overview (matching the plain menu item).
    const offOpenScheduler = window.cc.app.onOpenScheduler((taskId) => {
      const ui = useUi.getState();
      if (taskId) ui.revealSchedule(taskId);
      else ui.setNav('scheduler');
    });
    return () => {
      offShortcuts();
      offData();
      offMenu();
      offFocusSession();
      offOpenScheduler();
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
      {nav === 'scheduler' && <SchedulerPanel />}
      {nav === 'plugins' && <PluginsPanel />}
      {nav === 'skills' && <SkillsPanel />}
      {nav === 'mcp' && <McpPanel />}
      {nav === 'settings' && <SettingsPanel />}
      <ModulePanelHost />
      <CommandPaletteHost />
      <QuickOpenHost />
      <ResumePickerHost />
      <SearchPanelHost />
      <ShortcutsHelpHost />
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

