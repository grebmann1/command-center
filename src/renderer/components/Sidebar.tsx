import {
  BookOpen,
  Clock,
  FolderGit2,
  Inbox,
  Plug,
  Puzzle,
  Settings,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  icons as lucideIcons,
  type LucideIcon
} from 'lucide-react';
import {
  useUi,
  useUnreadInboxCount,
  useEnabledSchedulerCount,
  useRunningSchedulerCount,
  type NavId
} from '../store';
import { APP_MODULES } from '../modules';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const coreNavItems: NavEntry[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'mcp', label: 'MCP', icon: Plug }
];

/** Resolve a module's icon name against lucide's registry; fall back safely. */
function resolveIcon(name: string): LucideIcon {
  return (lucideIcons as Record<string, LucideIcon>)[name] ?? HelpCircle;
}

// App modules (plugins/*) contribute their own nav entries. They're grouped
// under an "Extensions" heading to set them apart from the core tool, and
// Settings stays pinned to the bottom after them.
const moduleNavItems: NavEntry[] = APP_MODULES.map((m) => ({
  id: m.id,
  label: m.title,
  icon: resolveIcon(m.icon)
}));

const settingsNavItem: NavEntry = { id: 'settings', label: 'Settings', icon: Settings };

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const unreadInbox = useUnreadInboxCount();
  const enabledSchedules = useEnabledSchedulerCount();
  const runningSchedules = useRunningSchedulerCount();

  const renderNavItem = (item: NavEntry) => {
    const Icon = item.icon;
    const showBadge = item.id === 'inbox' && unreadInbox > 0;
    // Scheduler badge shows the number of armed (enabled) schedules.
    // When any are firing right now we turn it green and add a pulsing
    // dot on the icon so the "running" state reads at a glance.
    const isScheduler = item.id === 'scheduler';
    const showScheduleBadge = isScheduler && enabledSchedules > 0;
    const running = isScheduler && runningSchedules > 0;
    const scheduleTitle = running
      ? `${enabledSchedules} scheduled · ${runningSchedules} running`
      : `${enabledSchedules} scheduled`;
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
            className={`nav-badge ${running ? 'nav-badge--running' : 'nav-badge--muted'}`}
            aria-label={scheduleTitle}
            title={scheduleTitle}
          >
            {enabledSchedules > 99 ? '99+' : enabledSchedules}
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
    </aside>
  );
}
