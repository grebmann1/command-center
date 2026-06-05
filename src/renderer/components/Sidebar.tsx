import { Clock, FolderGit2, Inbox, Settings, type LucideIcon } from 'lucide-react';
import { useUi, useUnreadInboxCount, type NavId } from '../store';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const navItems: NavEntry[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  const unreadInbox = useUnreadInboxCount();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-avatar">CC</div>
        <div className="brand-name">Command Center</div>
      </div>

      <div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const showBadge = item.id === 'inbox' && unreadInbox > 0;
          return (
            <button
              key={item.id}
              className={`nav-item ${nav === item.id ? 'active' : ''}`}
              onClick={() => setNav(item.id)}
              aria-current={nav === item.id ? 'page' : undefined}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              {showBadge && (
                <span
                  className="nav-badge"
                  aria-label={`${unreadInbox} unread`}
                  title={`${unreadInbox} unread`}
                >
                  {unreadInbox > 99 ? '99+' : unreadInbox}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
