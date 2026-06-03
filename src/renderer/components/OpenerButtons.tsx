import { MousePointer, Code2, FolderOpen, TerminalSquare } from 'lucide-react';
import type { OpenTarget } from '@shared/types';
import { useUi } from '../store';

interface Props {
  path: string;
  size?: number;
  className?: string;
}

const TARGETS: Array<{ key: OpenTarget; label: string; Icon: typeof MousePointer }> = [
  { key: 'cursor', label: 'Open in Cursor', Icon: MousePointer },
  { key: 'code', label: 'Open in VS Code', Icon: Code2 },
  { key: 'finder', label: 'Reveal in Finder', Icon: FolderOpen },
  { key: 'terminal', label: 'Open external Terminal', Icon: TerminalSquare }
];

export function OpenerButtons({ path, size = 14, className }: Props) {
  const pushToast = useUi((s) => s.pushToast);

  const onClick = async (target: OpenTarget) => {
    const r = await window.cc.openers.openIn(target, path);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  };

  return (
    <div className={`opener-bar ${className ?? ''}`}>
      {TARGETS.map(({ key, label, Icon }) => (
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
          <Icon size={size} />
        </button>
      ))}
    </div>
  );
}
