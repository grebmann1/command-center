import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, TerminalSquare, Plus, ChevronRight, MousePointer, Code2, FolderOpen, FileSearch, Sparkles, Play, RotateCcw, Keyboard, History, Search } from 'lucide-react';
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
  const addProject = useData((s) => s.addProject);
  const createTerminal = useData((s) => s.createTerminal);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setNav = useUi((s) => s.setNav);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const pushToast = useUi((s) => s.pushToast);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      }
    ];
    if (selectedProject) {
      const path = selectedProject.path;
      const open = async (target: OpenTarget) => {
        const r = await window.cc.openers.openIn(target, path);
        if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
      };
      actions.push(
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
          key: 'action:new-claude-continue',
          icon: <RotateCcw size={14} />,
          label: `New claude -c tab in ${selectedProject.name}`,
          run: () => { onClose(); launch('claude-continue'); }
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
          icon: <MousePointer size={14} />,
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
    }
    return [...projectItems, ...actions];
  }, [projects, addProject, selectProject, setNav, onClose, selectedProject, pushToast, launch]);

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
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.key}
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
