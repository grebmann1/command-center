/**
 * A clickable catalog list row: an icon + name + optional description on the
 * left, caller-supplied meta chips/actions on the right, and a click/Enter/Space
 * handler that opens the detail modal. Action buttons in the meta slot stop
 * propagation so clicking them doesn't also open the modal.
 */
import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  name: string;
  description?: string;
  /** Extra badge before the description (e.g. a repo-scope tag). */
  badge?: ReactNode;
  /** Open the detail modal. */
  onOpen: () => void;
  /** Right-side meta: chips and/or action buttons. */
  children?: ReactNode;
  dim?: boolean;
}

export function CatalogRow({ icon, name, description, badge, onOpen, children, dim }: Props) {
  return (
    <li
      className={`cu-catalog-row cu-catalog-row--clickable ${dim ? 'cu-row-dim' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${name} — click for details`}
    >
      <div className="cu-catalog-main">
        {icon}
        <span className="cu-catalog-name">{name}</span>
        {badge}
        {description && <span className="cu-catalog-desc">{description}</span>}
      </div>
      {/* Stop clicks on the meta/actions from bubbling up to the row's onOpen. */}
      <div
        className="cu-catalog-meta"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </li>
  );
}
