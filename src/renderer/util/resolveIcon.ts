// Resolve a lucide icon *name* (string) to its component. Extensions and app
// modules name their icons as strings so the contract carries no dependency on
// lucide-react's types; core resolves the name here against lucide's registry,
// falling back to a neutral glyph for an unknown name (never throws).
import { icons as lucideIcons, HelpCircle, type LucideIcon } from 'lucide-react';

export function resolveIcon(name: string): LucideIcon {
  return (lucideIcons as Record<string, LucideIcon>)[name] ?? HelpCircle;
}
