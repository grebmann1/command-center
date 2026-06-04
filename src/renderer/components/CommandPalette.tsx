import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, TerminalSquare, Plus, ChevronRight, Code2, FolderOpen, FileSearch, Sparkles, Play, Zap, Keyboard, History, Search, Inbox, RotateCcw, Trash2, Copy, Pin, PinOff, Globe } from 'lucide-react';
import { CursorIcon } from './icons/CursorIcon';
import { useData, useUi } from '../store';
import type { LaunchProfileId, OpenTarget, Project } from '@shared/types';

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
  const setPinned = useData((s) => s.setPinned);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const pushToast = useUi((s) => s.pushToast);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedProjectTabs = selectedProject ? terminals[selectedProject.id] ?? [] : [];
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
      }
    ];
    const tabItems: PaletteItem[] = selectedProject
      ? selectedProjectTabs.map((t) => ({
          key: `tab:${t.id}`,
          icon: <TerminalSquare size={14} />,
          label: `${t.title}${t.status === 'exited' ? ' · exited' : ''}`,
          hint: `${selectedProject.name} · ${t.profile}`,
          run: () => {
            selectProject(selectedProject.id);
            selectTab(selectedProject.id, t.id);
            setWorkspaceMode(selectedProject.id, 'terminals');
            setNav('projects');
            onClose();
          }
        }))
      : [];
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
  }, [projects, addProject, selectProject, selectTab, setWorkspaceMode, setNav, setSettingsTab, onClose, selectedProject, selectedProjectTabs, activeTab, restartTerminal, closeTerminal, setPinned, pushToast, launch]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.hint?.toLowerCase().includes(q) ?? false)
    );
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
