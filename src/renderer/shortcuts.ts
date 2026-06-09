import { useData, useUi, sortProjectsForDisplay } from './store';
import { getTerminal } from './util/findRegistry';
import type { LaunchProfileId } from '@shared/types';

const KNOWN_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

function defaultProfileForProject(projectId: string): LaunchProfileId {
  const project = useData.getState().projects.find((p) => p.id === projectId);
  const first = project?.defaultAgents?.[0];
  if (first && (KNOWN_PROFILES as string[]).includes(first)) {
    return first as LaunchProfileId;
  }
  return 'claude';
}

function isMac() {
  return navigator.platform.toUpperCase().includes('MAC');
}

function mod(e: KeyboardEvent) {
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!mod(e)) return;

    const ui = useUi.getState();
    const data = useData.getState();
    const projectId = ui.selectedProjectId;
    const tabs = projectId ? data.terminals[projectId] || [] : [];
    const activeTabId = projectId ? ui.selectedTabId[projectId] : undefined;
    const activeIdx = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;

    // cmd+b — toggle terminals/explorer mode (preview is set explicitly via
    // ⌘L; ⌘B intentionally only flips between the two text-editing modes so
    // muscle memory doesn't surprise users with a 3-stop cycle).
    if (e.key === 'b' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      const cur = ui.workspaceMode[projectId] ?? 'terminals';
      ui.setWorkspaceMode(projectId, cur === 'explorer' ? 'terminals' : 'explorer');
      return;
    }
    // cmd+l — jump to the preview browser pane. If already in preview,
    // browser-style: focus and select the address bar (don't toggle away).
    if (e.key === 'l' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      const cur = ui.workspaceMode[projectId] ?? 'terminals';
      if (cur === 'preview') {
        window.dispatchEvent(new CustomEvent('preview:focus-address'));
      } else {
        ui.setWorkspaceMode(projectId, 'preview');
        // Address bar may not be mounted yet — fire after the next paint.
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('preview:focus-address'));
        });
      }
      return;
    }
    // cmd+p — project switcher / command palette
    if (e.key === 'p' && !e.shiftKey) {
      e.preventDefault();
      ui.setPaletteOpen(true);
      return;
    }
    // cmd+e — quick open file in selected project
    if (e.key === 'e' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setQuickOpenOpen(true);
      return;
    }
    // cmd+r — resume Claude session picker
    if (e.key === 'r' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setResumeOpen(true);
      return;
    }
    // cmd+shift+r — restart active terminal (kill+respawn for live, or
    // resurrect for exited). Pairs with cmd+w (close) so revival is one
    // chord; especially useful after a dev server crashes mid-session.
    if ((e.key === 'R' || (e.key === 'r' && e.shiftKey)) && e.shiftKey) {
      if (!projectId || !activeTabId) return;
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      e.preventDefault();
      const live = active.status !== 'exited';
      if (live && !window.confirm(`Kill and restart "${active.title}"?`)) return;
      data.restartTerminal(activeTabId, projectId).catch(() => {});
      return;
    }
    // cmd+, — toggle Settings
    if (e.key === ',') {
      e.preventDefault();
      ui.setNav(ui.nav === 'settings' ? 'projects' : 'settings');
      return;
    }
    // cmd+i — toggle Inbox. Returns to Projects when already on inbox so it
    // works as a single round-trip key from anywhere in the app.
    if (e.key === 'i' && !e.shiftKey) {
      e.preventDefault();
      ui.setNav(ui.nav === 'inbox' ? 'projects' : 'inbox');
      return;
    }
    // cmd+o — toggle Overview (cross-project workspaces dashboard). Same
    // round-trip as ⌘I: opens from anywhere; pressing again closes it.
    if (e.key === 'o' && !e.shiftKey) {
      e.preventDefault();
      if (ui.nav !== 'projects') ui.setNav('projects');
      ui.setOverviewOpen(!ui.overviewOpen);
      return;
    }
    // cmd+j — toggle Scheduler. Round-trip back to projects when already on
    // scheduler so it works as a single key from anywhere.
    if (e.key === 'j' && !e.shiftKey) {
      e.preventDefault();
      ui.setNav(ui.nav === 'scheduler' ? 'projects' : 'scheduler');
      return;
    }
    // cmd+/ or cmd+? — keyboard shortcuts help
    if (e.key === '/' || e.key === '?') {
      e.preventDefault();
      ui.setShortcutsOpen(!ui.shortcutsOpen);
      return;
    }
    // cmd+shift+f — search file contents in selected project
    if ((e.key === 'F' || e.key === 'f') && e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setSearchOpen(true);
      return;
    }
    // cmd+shift+g — toggle explorer Changes view (only meaningful in
    // explorer mode; no-op in terminal mode so we don't clobber chrome).
    if ((e.key === 'G' || e.key === 'g') && e.shiftKey) {
      if (!projectId) return;
      const mode = ui.workspaceMode[projectId] ?? 'terminals';
      if (mode !== 'explorer') return;
      e.preventDefault();
      ui.toggleExplorerTreeMode(projectId);
      return;
    }
    // cmd+d — toggle diff-vs-HEAD on the open file. Same gating: only fires
    // when the explorer is the active surface.
    if (e.key === 'd' && !e.shiftKey) {
      if (!projectId) return;
      const mode = ui.workspaceMode[projectId] ?? 'terminals';
      if (mode !== 'explorer') return;
      if (!ui.explorerFile[projectId]) return;
      e.preventDefault();
      ui.toggleExplorerDiff(projectId);
      return;
    }
    // cmd+f — find in terminal
    if (e.key === 'f' && !e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      ui.setFindOpen(true);
      return;
    }
    // cmd+k — clear active terminal scrollback
    if (e.key === 'k' && !e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      getTerminal(activeTabId)?.clear();
      return;
    }
    // cmd+t — new tab using project's preferred default profile (falls back
    // to 'claude' when no per-project default is set).
    if (e.key === 't' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      const profile = defaultProfileForProject(projectId);
      data.createTerminal(projectId, profile, 80, 24).then((s) => {
        if (s) ui.selectTab(projectId, s.id);
      }).catch(() => {});
      return;
    }
    // cmd+shift+d — duplicate active tab (same launch profile)
    if ((e.key === 'D' || (e.key === 'd' && e.shiftKey)) && e.shiftKey) {
      if (!projectId || !activeTabId) return;
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      e.preventDefault();
      data.createTerminal(projectId, active.profile, 80, 24).then((s) => {
        if (s) ui.selectTab(projectId, s.id);
      }).catch(() => {});
      return;
    }
    // cmd+shift+t — reopen last closed tab in this project
    if ((e.key === 'T' || (e.key === 't' && e.shiftKey)) && e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      data.reopenLastClosed(projectId).then((s) => {
        if (s) ui.selectTab(projectId, s.id);
      }).catch(() => {});
      return;
    }
    // cmd+w — hide current tab (pty keeps running; right-click → Kill to drop).
    if (e.key === 'w') {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      const active = tabs.find((t) => t.id === activeTabId);
      if (active?.pinned) return;
      data.hideTerminal(activeTabId, projectId).catch(() => {});
      return;
    }
    // cmd+1..9 (or cmd+shift+1..9) — switch tab / project.
    // Use e.code so shift+digit (which yields !@#…) still matches.
    const digitMatch = /^Digit([1-9])$/.exec(e.code);
    if (digitMatch) {
      const idx = parseInt(digitMatch[1], 10) - 1;
      if (e.shiftKey) {
        const ordered = sortProjectsForDisplay(data.projects);
        const target = ordered[idx];
        if (!target) return;
        e.preventDefault();
        ui.selectProject(target.id);
        return;
      }
      if (!projectId || !tabs[idx]) return;
      e.preventDefault();
      ui.selectTab(projectId, tabs[idx].id);
      return;
    }
    // cmd+] / cmd+[ — next/prev tab; with shift, next/prev project.
    if (e.key === ']' || e.key === '[') {
      const dir = e.key === ']' ? 1 : -1;
      if (e.shiftKey) {
        const ordered = sortProjectsForDisplay(data.projects);
        if (ordered.length === 0) return;
        e.preventDefault();
        const curIdx = projectId ? ordered.findIndex((p) => p.id === projectId) : -1;
        const next = ((curIdx < 0 ? 0 : curIdx + dir) + ordered.length) % ordered.length;
        ui.selectProject(ordered[next].id);
        return;
      }
      if (!projectId || tabs.length === 0) return;
      e.preventDefault();
      const next = (activeIdx + dir + tabs.length) % tabs.length;
      ui.selectTab(projectId, tabs[next].id);
      return;
    }
  };

  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
