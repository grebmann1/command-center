import { Code2, FolderOpen, TerminalSquare } from 'lucide-react';
import type { OpenTarget } from '@shared/types';
import { useUi } from '../store';
import { CursorIcon } from './icons/CursorIcon';

interface Props {
  path: string;
  size?: number;
  className?: string;
}

// Each target carries a render function so Lucide icons (typed via
// LucideIcon, which uses string|number for `size`) and our CursorIcon (a
// plain functional component) can coexist without a fragile shared type.
const TARGETS: Array<{
  key: OpenTarget;
  label: string;
  render: (size: number) => JSX.Element;
}> = [
  { key: 'cursor', label: 'Open in Cursor', render: (s) => <CursorIcon size={s} /> },
  { key: 'code', label: 'Open in VS Code', render: (s) => <Code2 size={s} /> },
  { key: 'finder', label: 'Reveal in Finder', render: (s) => <FolderOpen size={s} /> },
  { key: 'terminal', label: 'Open external Terminal', render: (s) => <TerminalSquare size={s} /> }
];

export function OpenerButtons({ path, size = 14, className }: Props) {
  const pushToast = useUi((s) => s.pushToast);

  const onClick = async (target: OpenTarget) => {
    const r = await window.cc.openers.openIn(target, path);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  };

  return (
    <div className={`opener-bar ${className ?? ''}`}>
      {TARGETS.map(({ key, label, render }) => (
        <button
          key={key}
          type="button"
          className="opener-btn"
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick(key);
          }}
        >
          {render(size)}
        </button>
      ))}
    </div>
  );
}
