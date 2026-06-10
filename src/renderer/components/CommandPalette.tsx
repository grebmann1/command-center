import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, TerminalSquare, Plus, ChevronRight, Code2, FolderOpen, FileSearch, Sparkles, Play, Zap, Keyboard, History, Search, Inbox, RotateCcw, Trash2, Copy, Pin, PinOff, Globe, BookOpen, Clock, LayoutGrid, RotateCw, Undo2 } from 'lucide-react';
import { CursorIcon } from './icons/CursorIcon';
import { useData, useScheduler, useUi, visibleTerminals } from '../store';
import type { LaunchProfileId, OpenTarget, Project } from '@shared/types';
import { fuzzyScore } from '../util/fuzzy';

interface PaletteItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  onClose: () => void;
}

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
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const setOverviewOpen = useUi((s) => s.setOverviewOpen);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
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

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  const items = useMemo<PaletteItem[]>(() => {
    const projectItems: PaletteItem[] = projects.map((p: Project) => ({
      key: `project:${p.id}`,
      icon: <Folder size={14} />,
      label: p.name,
      hint: p.path,
      run: () => {
        setNav('projects');
        selectProject(p.id);
        onClose();
      }
    }));
    const actions: PaletteItem[] = [
      {
        key: 'action:add-project',
        icon: <Plus size={14} />,
        label: 'Add project…',
        hint: 'Pick a folder',
        run: async () => {
          onClose();
          await addProject();
        }
      },
      {
        key: 'action:settings',
        icon: <TerminalSquare size={14} />,
        label: 'Open Settings',
        hint: '⌘,',
        run: () => {
          setNav('settings');
          onClose();
        }
      },
      {
        key: 'action:shortcuts',
        icon: <Keyboard size={14} />,
        label: 'Keyboard shortcuts',
        hint: '⌘?',
        run: () => {
          onClose();
          useUi.getState().setShortcutsOpen(true);
        }
      },
      {
        key: 'action:inbox',
        icon: <Inbox size={14} />,
        label: 'Open Inbox',
        hint: '⌘I',
        run: () => {
          setNav('inbox');
          onClose();
        }
      },
      {
        key: 'action:scheduler',
        icon: <Clock size={14} />,
        label: 'Open Scheduler',
        hint: '⌘J',
        run: () => {
          setNav('scheduler');
          onClose();
        }
      },
      {
        key: 'action:skills',
        icon: <BookOpen size={14} />,
        label: 'Open Skills',
        run: () => {
          setNav('skills');
          onClose();
        }
      },
      {
        key: 'action:overview',
        icon: <LayoutGrid size={14} />,
        label: overviewOpen ? 'Close Overview' : 'Open Overview',
        hint: '⌘O',
        run: () => {
          setNav('projects');
          setOverviewOpen(!overviewOpen);
          onClose();
        }
      }
    ];
    // Tabs from every project. The selected project's tabs come first so
    // arrow-key muscle memory still lands on local tabs without typing,
    // followed by tabs from other projects (cross-project jump-to-tab).
    const tabItems: PaletteItem[] = [];
    const seenTab = new Set<string>();
    const pushTab = (proj: Project, t: typeof selectedProjectTabs[number]) => {
      if (seenTab.has(t.id)) return;
      seenTab.add(t.id);
      tabItems.push({
        key: `tab:${t.id}`,
        icon: <TerminalSquare size={14} />,
        label: `${t.title}${t.status === 'exited' ? ' · exited' : ''}`,
        hint: `${proj.name} · ${t.profile}`,
        run: () => {
          selectProject(proj.id);
          selectTab(proj.id, t.id);
          setWorkspaceMode(proj.id, 'terminals');
          setNav('projects');
          onClose();
        }
      });
    };
    if (selectedProject) {
      for (const t of selectedProjectTabs) pushTab(selectedProject, t);
    }
    for (const p of projects) {
      if (selectedProject && p.id === selectedProject.id) continue;
      const list = visibleTerminals(terminals[p.id]);
      for (const t of list) pushTab(p, t);
    }
    if (selectedProject) {
      const path = selectedProject.path;
      const open = async (target: OpenTarget) => {
        const r = await window.cc.openers.openIn(target, path);
        if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
      };
      actions.push(
        {
          key: 'action:preview-browser',
          icon: <Globe size={14} />,
          label: `Open Preview Browser in ${selectedProject.name}`,
          hint: '⌘L',
          run: () => {
            setWorkspaceMode(selectedProject.id, 'preview');
            setNav('projects');
            onClose();
          }
        },
        {
          key: 'action:project-settings',
          icon: <TerminalSquare size={14} />,
          label: `Open ${selectedProject.name} settings…`,
          hint: 'CLI flags, MCP, allowed tools',
          run: () => {
            setSettingsTab('project');
            setNav('settings');
            onClose();
          }
        },
        {
          key: 'action:quick-open',
          icon: <FileSearch size={14} />,
          label: `Find file in ${selectedProject.name}…`,
          hint: '⌘E',
          run: () => {
            onClose();
            useUi.getState().setQuickOpenOpen(true);
          }
        },
        {
          key: 'action:search-contents',
          icon: <Search size={14} />,
          label: `Search in ${selectedProject.name}…`,
          hint: '⌘⇧F',
          run: () => {
            onClose();
            useUi.getState().setSearchOpen(true);
          }
        },
        {
          key: 'action:new-claude',
          icon: <Sparkles size={14} />,
          label: `New claude tab in ${selectedProject.name}`,
          hint: '⌘T',
          run: () => { onClose(); launch('claude'); }
        },
        {
          key: 'action:new-claude-yolo',
          icon: <Zap size={14} />,
          label: `New claude --yolo tab in ${selectedProject.name}`,
          run: () => { onClose(); launch('claude-yolo'); }
        },
        {
          key: 'action:resume-claude',
          icon: <History size={14} />,
          label: `Resume Claude session in ${selectedProject.name}…`,
          hint: '⌘R',
          run: () => {
            onClose();
            useUi.getState().setResumeOpen(true);
          }
        },
        {
          key: 'action:new-shell',
          icon: <Play size={14} />,
          label: `New shell tab in ${selectedProject.name}`,
          run: () => { onClose(); launch('shell'); }
        },
        {
          key: 'action:open-cursor',
          icon: <CursorIcon size={14} />,
          label: `Open ${selectedProject.name} in Cursor`,
          hint: path,
          run: () => { onClose(); open('cursor'); }
        },
        {
          key: 'action:open-code',
          icon: <Code2 size={14} />,
          label: `Open ${selectedProject.name} in VS Code`,
          hint: path,
          run: () => { onClose(); open('code'); }
        },
        {
          key: 'action:open-finder',
          icon: <FolderOpen size={14} />,
          label: `Reveal ${selectedProject.name} in Finder`,
          hint: path,
          run: () => { onClose(); open('finder'); }
        },
        {
          key: 'action:open-terminal',
          icon: <TerminalSquare size={14} />,
          label: `Open ${selectedProject.name} in external Terminal`,
          hint: path,
          run: () => { onClose(); open('terminal'); }
        }
      );
      if (activeTab) {
        actions.push({
          key: 'action:pin-active',
          icon: activeTab.pinned ? <PinOff size={14} /> : <Pin size={14} />,
          label: activeTab.pinned
            ? `Unpin "${activeTab.title}"`
            : `Pin "${activeTab.title}"`,
          hint: activeTab.pinned ? 'remove from pinned zone' : 'keep at top',
          run: () => {
            const sid = activeTab.id;
            const pid = selectedProject.id;
            const next = !activeTab.pinned;
            onClose();
            setPinned(pid, sid, next);
          }
        });
        actions.push({
          key: 'action:duplicate-active',
          icon: <Copy size={14} />,
          label: `Duplicate "${activeTab.title}"`,
          hint: `new ${activeTab.profile} tab`,
          run: () => {
            const profile = activeTab.profile;
            onClose();
            launch(profile);
          }
        });
        actions.push({
          key: 'action:restart-active',
          icon: <RotateCcw size={14} />,
          label: `Restart "${activeTab.title}"`,
          hint: activeTab.status === 'exited' ? 'exited' : 'kill and restart',
          run: () => {
            const sid = activeTab.id;
            const pid = selectedProject.id;
            const live = activeTab.status !== 'exited';
            onClose();
            if (live && !window.confirm(`Kill and restart "${activeTab.title}"?`)) return;
            void restartTerminal(sid, pid);
          }
        });
      }
      actions.push({
        key: 'action:reopen-last-closed',
        icon: <Undo2 size={14} />,
        label: `Reopen / resume last removed tab in ${selectedProject.name}`,
        hint: '⌘⇧T',
        run: () => {
          const pid = selectedProject.id;
          onClose();
          // Mirror ⌘⇧T: resume newest background session first, else reopen
          // the last closed tab.
          restoreLastDetached(pid).then((restored) => {
            if (restored) return;
            reopenLastClosed(pid).then((s) => {
              if (s) selectTab(pid, s.id);
            }).catch(() => {});
          }).catch(() => {});
        }
      });
      const projectSchedules = scheduledTasks.filter(
        (t) => t.projectId === selectedProject.id && t.enabled
      );
      for (const task of projectSchedules) {
        actions.push({
          key: `action:run-schedule:${task.id}`,
          icon: <RotateCw size={14} />,
          label: `Run schedule now: ${task.name}`,
          hint: `every ${task.schedule.every} · ${task.profile}`,
          run: () => {
            const id = task.id;
            const name = task.name;
            onClose();
            window.cc.scheduler.runNow(id).then((r) => {
              if (!r.ok) pushToast(r.message ?? `Failed to run ${name}`, 'error');
            }).catch(() => {});
          }
        });
      }
      const exitedNonPinned = selectedProjectTabs.filter(
        (t) => t.status === 'exited' && !t.pinned
      );
      if (exitedNonPinned.length > 0) {
        actions.push({
          key: 'action:close-exited',
          icon: <Trash2 size={14} />,
          label: `Close ${exitedNonPinned.length} exited tab${
            exitedNonPinned.length === 1 ? '' : 's'
          } in ${selectedProject.name}`,
          hint: 'cleanup',
          run: () => {
            const pid = selectedProject.id;
            const ids = exitedNonPinned.map((t) => t.id);
            onClose();
            for (const id of ids) void closeTerminal(id, pid);
          }
        });
      }
    }
    return [...projectItems, ...tabItems, ...actions];
  }, [projects, terminals, addProject, selectProject, selectTab, setWorkspaceMode, setNav, setSettingsTab, setOverviewOpen, overviewOpen, onClose, selectedProject, selectedProjectTabs, activeTab, restartTerminal, closeTerminal, reopenLastClosed, setPinned, pushToast, launch, scheduledTasks]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    // Fuzzy-score against label, with hint as a weaker fallback. Stable
    // sort: when scores tie, original order wins (the items array is
    // already arranged in a sensible default — projects, tabs, actions).
    const scored: Array<{ item: PaletteItem; score: number; idx: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const m = fuzzyScore(it.label, q);
      let score = m?.score ?? -Infinity;
      if (it.hint) {
        const hm = fuzzyScore(it.hint, q);
        if (hm) {
          // Hints are secondary signal — half-weight.
          const hintScore = hm.score * 0.5;
          if (hintScore > score) score = hintScore;
        }
      }
      if (score > -Infinity) scored.push({ item: it, score, idx: i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    return scored.map((s) => s.item);
  }, [items, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered, activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(Math.max(0, filtered.length - 1));
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 8, filtered.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 8, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      filtered[activeIdx]?.run();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type to search projects or commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.key}
                data-idx={i}
                className={`palette-item ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => it.run()}
              >
                <span className="palette-icon">{it.icon}</span>
                <span className="palette-label">{it.label}</span>
                {it.hint && <span className="palette-hint">{it.hint}</span>}
                <ChevronRight size={12} className="palette-chev" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
