// Pure builder for the command palette's item list. Extracted from
// CommandPalette.tsx so the (large) item-construction logic is testable in
// isolation — a golden snapshot of the produced `key`s guards against
// accidentally dropping a built-in command. The component calls this from a
// `useMemo`; everything the items close over is passed in via `ctx` (no store
// reads happen here), keeping the function pure and side-effect-free.
import {
  Folder, TerminalSquare, Plus, Code2, FolderOpen, FileSearch, Sparkles, Play,
  Zap, Keyboard, History, Search, Inbox, RotateCcw, Trash2, Copy, Pin, PinOff,
  Globe, BookOpen, Clock, LayoutGrid, RotateCw, Undo2, Puzzle, Slash
} from 'lucide-react';
import { CursorIcon } from '../icons/CursorIcon';
import { visibleTerminals, useUi } from '../../store';
import type {
  LaunchProfileId, OpenTarget, Project, TerminalSession, ScheduledTask, SlashCommand
} from '@shared/types';
import type { AppModule } from '@shared/module-api';
import { getHost } from '../../modules/ModulePanelHost';
import { resolveIcon } from '../../util/resolveIcon';
import { evaluateWhen, type WhenContext } from './whenContext';

/** A category a palette item belongs to, used for empty-query grouping. */
export type PaletteCategory = 'Projects' | 'Tabs' | 'Actions' | 'Commands' | 'Extensions';

export interface PaletteItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Extra fuzzy-match terms beyond label/hint (extension command keywords). */
  keywords?: string[];
  /** Grouping bucket for empty-query section headers. */
  category: PaletteCategory;
  /**
   * Source of the item: 'core' for built-ins, or the extension's nav title for
   * extension commands (so they sub-group under the extension's name).
   */
  source: string;
  run: () => void;
}

/** Everything the items close over — passed in so the builder stays pure. */
export interface PaletteBuildContext {
  projects: Project[];
  terminals: Record<string, TerminalSession[]>;
  selectedProject: Project | null;
  selectedProjectTabs: TerminalSession[];
  activeTab: TerminalSession | undefined;
  scheduledTasks: ScheduledTask[];
  modules: AppModule[];
  /** Claude Code slash commands discovered for the active project context. */
  slashCommands: SlashCommand[];
  overviewOpen: boolean;
  /** Coarse, non-sensitive context for evaluating extension command `when`. */
  whenCtx: WhenContext;
  onClose: () => void;
  launch: (profile: LaunchProfileId) => void;
  /** Open a fresh Claude tab in the active project running `invocation`. */
  launchCommand: (invocation: string, yolo: boolean) => void;
  /** Send `invocation` into the focused live Claude session (active-tab mode). */
  sendCommandToActiveTab: (invocation: string) => void;
  addProject: () => Promise<unknown> | unknown;
  setNav: (nav: string) => void;
  selectProject: (id: string) => void;
  selectTab: (projectId: string, tabId: string) => void;
  setWorkspaceMode: (projectId: string, mode: 'terminals' | 'explorer' | 'preview' | 'library') => void;
  setSettingsTab: (tab: 'global' | 'project') => void;
  setOverviewOpen: (open: boolean) => void;
  setPinned: (projectId: string, sessionId: string, pinned: boolean) => void;
  restartTerminal: (sessionId: string, projectId: string) => Promise<unknown> | unknown;
  closeTerminal: (sessionId: string, projectId: string) => Promise<unknown> | unknown;
  reopenLastClosed: (projectId: string) => Promise<{ id: string } | null>;
  restoreLastDetached: (projectId: string) => Promise<string | null>;
  pushToast: (message: string, kind?: 'info' | 'error') => void;
}

/**
 * Commands contributed by app modules (built-in plugins/* + runtime
 * extensions, uniformly). For each module that declares `commands`, call its
 * factory with the module's live host and adapt every ExtensionCommand into a
 * PaletteItem. Keys are namespaced `ext:<moduleId>:<cmd.id>` so they never
 * collide. An optional `icon` is resolved core-side via the lucide name
 * convention (fallback Puzzle); `category` defaults to the module title; a
 * declarative `when` is evaluated HOST-SIDE against the coarse context and,
 * when false, the command is omitted. Per-module try/catch: a throwing factory
 * is skipped and never breaks the palette.
 */
function buildExtensionItems(ctx: PaletteBuildContext): PaletteItem[] {
  const { modules, whenCtx, onClose } = ctx;
  const out: PaletteItem[] = [];
  for (const mod of modules) {
    if (!mod.commands) continue;
    let cmds;
    try {
      cmds = mod.commands(getHost(mod.id));
    } catch {
      continue; // a throwing commands() factory is skipped, not fatal
    }
    if (!Array.isArray(cmds)) continue;
    // `panelFocused` is scoped to THIS module so an extension can't probe
    // whether a different extension's panel is active.
    const modWhenCtx: WhenContext = { ...whenCtx, panelFocused: whenCtx.activeNav === mod.id };
    for (const cmd of cmds) {
      if (!evaluateWhen(cmd.when, modWhenCtx)) continue; // hidden (or fail-closed)
      out.push({
        key: `ext:${mod.id}:${cmd.id}`,
        icon: cmd.icon ? renderIcon(cmd.icon) : <Puzzle size={14} />,
        label: cmd.label,
        hint: mod.title,
        keywords: cmd.keywords,
        category: 'Extensions',
        source: cmd.category ?? mod.title,
        run: () => {
          onClose();
          try {
            cmd.run();
          } catch {
            /* command threw — swallow so a bad extension can't crash the shell */
          }
        }
      });
    }
  }
  return out;
}

function renderIcon(name: string): React.ReactNode {
  const Icon = resolveIcon(name);
  return <Icon size={14} />;
}

/**
 * Claude Code slash commands (`.claude/commands/**\/*.md`) as palette items.
 * Each command yields a "new Claude tab" entry (always available when a project
 * is selected); when the focused tab is a live Claude session, an additional
 * "send to active tab" entry runs it in place. Keys: `cmd:<scope>:<name>` for
 * the new-tab entry, suffixed `:active` for the in-tab one. Requires a selected
 * project — there's nowhere to launch otherwise.
 */
function buildSlashCommandItems(ctx: PaletteBuildContext): PaletteItem[] {
  const { slashCommands, selectedProject, activeTab, launchCommand, sendCommandToActiveTab, onClose } = ctx;
  if (!selectedProject) return [];
  const activeIsClaude =
    !!activeTab && activeTab.status !== 'exited' &&
    (activeTab.profile === 'claude' || activeTab.profile === 'claude-resume' || activeTab.profile === 'claude-yolo');
  const scopeLabel: Record<SlashCommand['scope'], string> = {
    user: 'user command',
    project: 'project command',
    plugin: 'plugin command'
  };
  const out: PaletteItem[] = [];
  for (const cmd of slashCommands) {
    const hintBits = [cmd.description, cmd.argumentHint && `args: ${cmd.argumentHint}`]
      .filter(Boolean) as string[];
    const baseHint = hintBits.length ? hintBits.join(' · ') : scopeLabel[cmd.scope];
    // New-tab entry — the default way to run a command.
    out.push({
      key: `cmd:${cmd.id}`,
      icon: <Slash size={14} />,
      label: `${cmd.invocation} — new Claude tab`,
      hint: baseHint,
      keywords: [cmd.name, cmd.pluginName ?? '', scopeLabel[cmd.scope]].filter(Boolean),
      category: 'Commands',
      source: cmd.pluginName ?? scopeLabel[cmd.scope],
      run: () => {
        onClose();
        launchCommand(cmd.invocation, false);
      }
    });
    // Active-tab entry — only when there's a live Claude session to send to.
    if (activeIsClaude) {
      out.push({
        key: `cmd:${cmd.id}:active`,
        icon: <Slash size={14} />,
        label: `${cmd.invocation} — run in "${activeTab!.title}"`,
        hint: baseHint,
        keywords: [cmd.name, 'active tab', cmd.pluginName ?? ''].filter(Boolean),
        category: 'Commands',
        source: cmd.pluginName ?? scopeLabel[cmd.scope],
        run: () => {
          onClose();
          sendCommandToActiveTab(cmd.invocation);
        }
      });
    }
  }
  return out;
}

/**
 * Build the full, ordered palette item list (projects → tabs → actions →
 * extensions). Pure: no store reads, no side effects until an item's `run` is
 * invoked. The ordering is the sensible default the fuzzy filter falls back to
 * on ties and the empty-query view groups by `category`.
 */
export function buildPaletteItems(ctx: PaletteBuildContext): PaletteItem[] {
  const {
    projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, overviewOpen, onClose, launch, addProject, setNav,
    selectProject, selectTab, setWorkspaceMode, setSettingsTab, setOverviewOpen,
    setPinned, restartTerminal, closeTerminal, reopenLastClosed,
    restoreLastDetached, pushToast
  } = ctx;

  const projectItems: PaletteItem[] = projects.map((p) => ({
    key: `project:${p.id}`,
    icon: <Folder size={14} />,
    label: p.name,
    hint: p.path,
    category: 'Projects',
    source: 'core',
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
      category: 'Actions',
      source: 'core',
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
      category: 'Actions',
      source: 'core',
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
      category: 'Actions',
      source: 'core',
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
      category: 'Actions',
      source: 'core',
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
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('scheduler');
        onClose();
      }
    },
    {
      key: 'action:skills',
      icon: <BookOpen size={14} />,
      label: 'Open Skills',
      category: 'Actions',
      source: 'core',
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
      category: 'Actions',
      source: 'core',
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
  const pushTab = (proj: Project, t: TerminalSession) => {
    if (seenTab.has(t.id)) return;
    seenTab.add(t.id);
    tabItems.push({
      key: `tab:${t.id}`,
      icon: <TerminalSquare size={14} />,
      label: `${t.title}${t.status === 'exited' ? ' · exited' : ''}`,
      hint: `${proj.name} · ${t.profile}`,
      category: 'Tabs',
      source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('claude'); }
      },
      {
        key: 'action:new-claude-yolo',
        icon: <Zap size={14} />,
        label: `New claude --yolo tab in ${selectedProject.name}`,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('claude-yolo'); }
      },
      {
        key: 'action:resume-claude',
        icon: <History size={14} />,
        label: `Resume Claude session in ${selectedProject.name}…`,
        hint: '⌘R',
        category: 'Actions',
        source: 'core',
        run: () => {
          onClose();
          useUi.getState().setResumeOpen(true);
        }
      },
      {
        key: 'action:new-shell',
        icon: <Play size={14} />,
        label: `New shell tab in ${selectedProject.name}`,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('shell'); }
      },
      {
        key: 'action:open-cursor',
        icon: <CursorIcon size={14} />,
        label: `Open ${selectedProject.name} in Cursor`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('cursor'); }
      },
      {
        key: 'action:open-code',
        icon: <Code2 size={14} />,
        label: `Open ${selectedProject.name} in VS Code`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('code'); }
      },
      {
        key: 'action:open-finder',
        icon: <FolderOpen size={14} />,
        label: `Reveal ${selectedProject.name} in Finder`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('finder'); }
      },
      {
        key: 'action:open-terminal',
        icon: <TerminalSquare size={14} />,
        label: `Open ${selectedProject.name} in external Terminal`,
        hint: path,
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
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
      category: 'Actions',
      source: 'core',
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
        category: 'Actions',
        source: 'core',
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
        category: 'Actions',
        source: 'core',
        run: () => {
          const pid = selectedProject.id;
          const ids = exitedNonPinned.map((t) => t.id);
          onClose();
          for (const id of ids) void closeTerminal(id, pid);
        }
      });
    }
  }

  return [
    ...projectItems,
    ...tabItems,
    ...actions,
    ...buildSlashCommandItems(ctx),
    ...buildExtensionItems(ctx)
  ];
}
