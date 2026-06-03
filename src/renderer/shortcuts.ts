import { useData, useUi, sortProjectsForDisplay } from './store';
import { getTerminal } from './util/findRegistry';

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

    // cmd+b — toggle terminals/explorer mode
    if (e.key === 'b' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.toggleWorkspaceMode(projectId);
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
    // cmd+, — toggle Settings
    if (e.key === ',') {
      e.preventDefault();
      ui.setNav(ui.nav === 'settings' ? 'projects' : 'settings');
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
    // cmd+t — new claude tab
    if (e.key === 't' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      data.createTerminal(projectId, 'claude', 80, 24).then((s) => {
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
    // cmd+w — close current tab (no-op on pinned tabs)
    if (e.key === 'w') {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      const active = tabs.find((t) => t.id === activeTabId);
      if (active?.pinned) return;
      data.closeTerminal(activeTabId, projectId).catch(() => {});
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
