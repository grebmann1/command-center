import {
  Sparkles,
  Zap,
  History,
  Play,
  ShieldCheck,
  Compass,
  Bot,
  Bug,
  Wrench,
  Pencil,
  Search,
  type LucideIcon
} from 'lucide-react';
import type { LaunchProfileId, Persona } from '@shared/types';

export function profileIcon(profile: LaunchProfileId, size = 11) {
  switch (profile) {
    case 'claude':
      return <Sparkles size={size} />;
    case 'claude-yolo':
      return <Zap size={size} />;
    case 'claude-resume':
      return <History size={size} />;
    case 'shell':
      return <Play size={size} />;
  }
}

/** Whitelist of lucide icon names we honor in persona metadata. Anything else
 *  falls back to the persona's base-profile icon (then Bot) so a typo in a
 *  hand-edited persona file never crashes the renderer. Mirrors the scheduler
 *  template-icon whitelist. */
const PERSONA_ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  Compass,
  Bot,
  Bug,
  Wrench,
  Pencil,
  Search,
  Sparkles,
  Zap
};

/**
 * Render the icon for a persona. Resolves `persona.icon` against the whitelist;
 * on a miss (absent or unknown name) falls back to the icon of the persona's
 * base profile, then to a generic Bot. Used by the spawn picker and tab chips.
 */
export function personaIcon(persona: Pick<Persona, 'icon' | 'baseProfile'>, size = 11) {
  const Named = persona.icon ? PERSONA_ICONS[persona.icon] : undefined;
  if (Named) return <Named size={size} />;
  if (persona.baseProfile) return profileIcon(persona.baseProfile, size);
  return <Bot size={size} />;
}
