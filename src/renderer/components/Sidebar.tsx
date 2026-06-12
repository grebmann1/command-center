import {
  BookOpen,
  Clock,
  FolderGit2,
  Inbox,
  Plug,
  Puzzle,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon
} from 'lucide-react';
import {
  useUi,
  useUnreadInboxCount,
  useEnabledSchedulerCount,
  useRunningSchedulerCount,
  type NavId
} from '../store';
import { resolveIcon } from '../util/resolveIcon';
import { useMergedModules } from '../modules';
import { getHost } from '../modules/ModulePanelHost';
import { AgentTray } from './AgentTray';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
  /**
   * Pre-evaluated extension nav badge (from `AppModule.navBadge`). Only set for
   * app-module entries that declare one. A number, a short string, or
   * null/0/'' for no badge.
   */
  moduleBadge?: number | string | null;
}

/**
 * Evaluate a merged module's `navBadge(host)` safely. V1 simplicity: this runs
 * on every Sidebar render (the rail already re-renders on store ticks, so the
 * badge stays roughly live). A module that wants a precisely-live badge should
 * recompute off host.cache / a host.on subscription per the SDK contract.
 *
 * A throwing or absent factory yields no badge — it never breaks the rail.
 */
function evalModuleBadge(m: { id: string; navBadge?: (host: ReturnType<typeof getHost>) => number | string | null }): number | string | null {
  if (!m.navBadge) return null;
  try {
    return m.navBadge(getHost(m.id));
  } catch {
    return null;
  }
}

const coreNavItems: NavEntry[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP', icon: Plug }
];

const settingsNavItem: NavEntry = { id: 'settings', label: 'Settings', icon: Settings };

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();

  // App modules (built-in plugins/* + runtime-loaded extensions) contribute
  // their own nav entries, grouped under an "Extensions" heading to set them
  // apart from the core tool. Built-ins and runtime extensions are treated
  // identically here; the merged set is reactive so a discovered extension's
  // nav appears (and a disabled one disappears) without a reload.
  const modules = useMergedModules();
  const moduleNavItems: NavEntry[] = modules.map((m) => ({
    id: m.id,
    label: m.title,
    icon: resolveIcon(m.icon),
    moduleBadge: evalModuleBadge(m)
  }));

  const renderNavItem = (item: NavEntry) => {
    const Icon = item.icon;
    const showBadge = item.id === 'inbox' && unreadInbox > 0;
    // Scheduler badge only appears when a scheduled agent is running right now;
    // it shows that live count in gold and adds a pulsing dot on the icon so
    // the "running" state reads at a glance. An armed-but-idle schedule shows
    // no badge.
    const isScheduler = item.id === 'scheduler';
    const running = isScheduler && runningSchedules > 0;
    const showScheduleBadge = running;
    const scheduleTitle = `${runningSchedules} running · ${enabledSchedules} scheduled`;
    // Extension-contributed badge (AppModule.navBadge), pre-evaluated when the
    // module nav entries were built. Distinct from the core inbox/scheduler
    // badges above, which are gated on their own ids — a module id never
    // collides with 'inbox'/'scheduler', so this can't disturb them.
    const moduleBadge = item.moduleBadge;
    const showModuleBadge =
      moduleBadge != null && moduleBadge !== 0 && moduleBadge !== '';
    const moduleBadgeText =
      typeof moduleBadge === 'number'
        ? moduleBadge > 99
          ? '99+'
          : String(moduleBadge)
        : String(moduleBadge);
    return (
      <button
        key={item.id}
        className={`nav-item ${nav === item.id ? 'active' : ''}`}
        onClick={() => setNav(item.id)}
        aria-current={nav === item.id ? 'page' : undefined}
        title={
          collapsed
            ? showScheduleBadge
              ? `${item.label} — ${scheduleTitle}`
              : item.label
            : undefined
        }
      >
        <span className="nav-item-icon">
          <Icon size={16} />
          {running && <span className="nav-running-dot" aria-hidden="true" />}
        </span>
        <span className="nav-item-label">{item.label}</span>
        {showBadge && (
          <span
            className="nav-badge"
            aria-label={`${unreadInbox} unread`}
            title={`${unreadInbox} unread`}
          >
            {unreadInbox > 99 ? '99+' : unreadInbox}
          </span>
        )}
        {showScheduleBadge && (
          <span
            className="nav-badge nav-badge--running"
            aria-label={scheduleTitle}
            title={scheduleTitle}
          >
            {runningSchedules > 99 ? '99+' : runningSchedules}
          </span>
        )}
        {showModuleBadge && (
          <span
            className="nav-badge"
            aria-label={`${moduleBadgeText} for ${item.label}`}
            title={`${moduleBadgeText} for ${item.label}`}
          >
            {moduleBadgeText}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-avatar">CC</div>
        <div className="brand-name">Command Center</div>
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div>
        {coreNavItems.map(renderNavItem)}

        {/* App modules (plugins/*) sit under their own heading so it's clear
         * they're extensions rather than part of the core tool. The label is
         * hidden on the collapsed rail; a divider stands in for it there. */}
        {moduleNavItems.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-label">Extensions</div>
            {moduleNavItems.map(renderNavItem)}
          </div>
        )}

        {renderNavItem(settingsNavItem)}
      </div>

      {/* Running / needs-you agents, pinned to the bottom of the rail. Renders
       * nothing when no agent is active, so it never takes space idle. */}
      <AgentTray />
    </aside>
  );
}
