import { FolderGit2, Settings, type LucideIcon } from 'lucide-react';
import { useUi, type NavId } from '../store';

interface NavEntry {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

const navItems: NavEntry[] = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-avatar">CC</div>
        <div className="brand-name">Command Center</div>
      </div>

      <div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${nav === item.id ? 'active' : ''}`}
              onClick={() => setNav(item.id)}
              aria-current={nav === item.id ? 'page' : undefined}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
