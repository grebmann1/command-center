/**
 * Shared assignment UI + profile helpers for the Zana module. Used by both the
 * board cards (a compact "assign" affordance) and the detail modal (a prominent
 * "Assign" dropdown). The actual write + optimistic/undo bookkeeping lives in
 * the panel (`ZanaPanel.tsx`); this file only renders the picker and resolves a
 * `assigneeProfileId` → `{ icon, displayName }` for display.
 *
 * Decoupling: imports only shared types + react/lucide. No host calls here —
 * the picker reports a chosen `AssignChoice` up to its owner, which performs
 * the optimistic patch + deferred write.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, UserPlus, UserX } from 'lucide-react';
import type { ZanaProfile } from '../shared/types';

/** Fast lookup from a profile id to its profile row. */
export type ProfileMap = Map<string, ZanaProfile>;

/** Build a `ProfileMap` from the fetched profiles list. */
export function buildProfileMap(profiles: ZanaProfile[]): ProfileMap {
  const map: ProfileMap = new Map();
  for (const p of profiles) if (p && typeof p.id === 'string') map.set(p.id, p);
  return map;
}

/** Resolve a profile id to a compact `{ icon, displayName }`, or undefined. */
export function profileLabel(
  profileId: string | undefined,
  profiles: ProfileMap
): { icon: string; displayName: string } | undefined {
  if (!profileId) return undefined;
  const p = profiles.get(profileId);
  if (!p) return undefined;
  return { icon: p.icon ?? '🤖', displayName: p.displayName };
}

/** Two-initial avatar text from a display name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * One assignment choice the picker can emit:
 *   - { kind: 'profile' }   → assign to a workspace profile
 *   - { kind: 'name' }      → assign to a free-text name (no profile)
 *   - { kind: 'clear' }     → unassign
 */
export type AssignChoice =
  | { kind: 'profile'; profileId: string; displayName: string }
  | { kind: 'name'; assigneeName: string }
  | { kind: 'clear' };

/**
 * The assignment popover menu. Renders a list of profiles (emoji + name), an
 * "Unassigned" option to clear, and a free-text input at the bottom. Closes on
 * outside-click / Escape. Calls `onPick` with the chosen `AssignChoice` then
 * closes; `onClose` fires for dismissal without a pick.
 */
export function AssignMenu({
  profiles,
  onPick,
  onClose,
  align = 'left'
}: {
  profiles: ZanaProfile[];
  onPick: (choice: AssignChoice) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside-click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Defer attaching the mousedown listener a tick so the opening click that
    // mounted us doesn't immediately close us.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const submitName = () => {
    const trimmed = name.trim();
    if (trimmed) onPick({ kind: 'name', assigneeName: trimmed });
  };

  return (
    <div
      ref={ref}
      className={`zana-assign-menu zana-assign-menu--${align}`}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="zana-assign-menu-label">Assign to</div>
      <button
        type="button"
        role="menuitem"
        className="zana-assign-item zana-assign-item--clear"
        onClick={() => onPick({ kind: 'clear' })}
      >
        <span className="zana-assign-item-icon" aria-hidden>
          <UserX size={13} />
        </span>
        <span className="zana-assign-item-name">Unassigned</span>
      </button>
      <div className="zana-assign-menu-list">
        {profiles.length === 0 && (
          <div className="zana-assign-menu-empty">No workspace profiles.</div>
        )}
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            role="menuitem"
            className="zana-assign-item"
            onClick={() => onPick({ kind: 'profile', profileId: p.id, displayName: p.displayName })}
            title={p.description ?? p.displayName}
          >
            <span className="zana-assign-item-icon" aria-hidden>
              {p.icon ?? '🤖'}
            </span>
            <span className="zana-assign-item-name">{p.displayName}</span>
            {p.category && <span className="zana-assign-item-cat">{p.category}</span>}
          </button>
        ))}
      </div>
      <form
        className="zana-assign-freetext"
        onSubmit={(e) => {
          e.preventDefault();
          submitName();
        }}
      >
        <input
          type="text"
          placeholder="Assign to name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Assign to a name"
        />
        <button type="submit" disabled={!name.trim()} title="Assign to this name">
          <UserPlus size={13} />
        </button>
      </form>
    </div>
  );
}

/**
 * The assignee display + assign trigger used on a board card. Shows the avatar
 * + name (or a muted "Unassigned" affordance), plus the resolved profile chip.
 * Clicking the trigger opens an `AssignMenu` (the parent owns its open state so
 * only one menu is open at a time and clicks don't bubble to the card).
 */
export function CardAssignee({
  assigneeName,
  profileId,
  profiles,
  profileMap,
  menuOpen,
  onToggleMenu,
  onPick,
  onCloseMenu
}: {
  assigneeName?: string;
  profileId?: string;
  profiles: ZanaProfile[];
  profileMap: ProfileMap;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (choice: AssignChoice) => void;
  onCloseMenu: () => void;
}) {
  const prof = profileLabel(profileId, profileMap);
  return (
    <span className="zana-card-assignee-wrap">
      <button
        type="button"
        className={`zana-card-assignee zana-assign-trigger ${assigneeName ? '' : 'is-unassigned'}`}
        title={assigneeName ? `Assigned to ${assigneeName} — click to reassign` : 'Unassigned — click to assign'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMenu();
        }}
      >
        {assigneeName ? (
          <>
            <span className="zana-card-avatar" aria-hidden>
              {prof ? prof.icon : initials(assigneeName)}
            </span>
            <span className="zana-card-assignee-name">{assigneeName}</span>
            {prof && <span className="zana-card-profile-chip">{prof.displayName}</span>}
          </>
        ) : (
          <>
            <span className="zana-card-avatar zana-card-avatar--empty" aria-hidden>
              <UserPlus size={10} />
            </span>
            <span className="zana-card-assignee-name zana-card-unassigned">Unassigned</span>
          </>
        )}
        <ChevronDown size={10} className="zana-assign-caret" aria-hidden />
      </button>
      {menuOpen && (
        <AssignMenu profiles={profiles} onPick={onPick} onClose={onCloseMenu} align="left" />
      )}
    </span>
  );
}
