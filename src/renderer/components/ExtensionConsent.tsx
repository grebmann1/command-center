/**
 * P3-D install-time consent prompt. A self-contained global overlay (mounted in
 * App alongside the Toaster) that surfaces a plain-language permission screen
 * for any discovered disk extension that is NEW (never approved) or WIDENED (an
 * update declared more permissions than the user approved). Approve → persist
 * consent + the host re-discovers (spawns/mounts it); Dismiss → it stays
 * inactive and the prompt reappears next launch / next change.
 *
 * Kept apart from the unrelated concurrent renderer WIP: it owns its own state
 * (subscribes to `cc.extensions`) and touches no shared store.
 */

import { useEffect, useState } from 'react';
import type { ExtensionEntry } from '@shared/types';

/**
 * Plain-language descriptions of each permission. The key is the
 * `ExtensionPermission` token; the value is what the user reads. Unknown tokens
 * fall back to the raw string so a future permission still renders something.
 */
const PERMISSION_LABELS: Record<string, string> = {
  storage: 'Save its own settings and data',
  'projects:read': 'See your open projects',
  'projects:select': 'Switch the selected project',
  'session:launch': 'Launch Claude sessions in your projects',
  'external:open': 'Open web links in your browser',
  'inbox:push': 'Post messages to your inbox',
  exec: 'Run specific command-line tools',
  'fs:read': 'Read files in allowed folders',
  'fs:write': 'Write files in allowed folders',
  net: 'Connect to specific web hosts'
};

function permLabel(p: string): string {
  return PERMISSION_LABELS[p] ?? p;
}

/** Scope detail lines for the brokered permissions, when the manifest declares them. */
function scopeLines(entry: ExtensionEntry): string[] {
  const s = entry.manifest?.permissionScopes;
  if (!s) return [];
  const lines: string[] = [];
  if (s.execAllowlist?.length) lines.push(`Tools it may run: ${s.execAllowlist.join(', ')}`);
  if (s.fsRoots?.length) lines.push(`Folders it may access: ${s.fsRoots.join(', ')}`);
  if (s.egressAllowlist?.length) lines.push(`Hosts it may reach: ${s.egressAllowlist.join(', ')}`);
  return lines;
}

export function ExtensionConsent() {
  const [pending, setPending] = useState<ExtensionEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-session dismissals so a declined prompt doesn't nag within one launch.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const apply = (entries: ExtensionEntry[]) => {
      setPending(entries.filter((e) => e.needsConsent !== null));
    };
    void window.cc.extensions.list().then(apply);
    const off = window.cc.extensions.onChanged(apply);
    return off;
  }, []);

  const visible = pending.filter((e) => !dismissed.has(e.id));
  if (visible.length === 0) return null;

  // One prompt at a time — least intrusive; the rest queue behind it.
  const entry = visible[0];
  const title = entry.manifest?.title ?? entry.id;
  const perms = entry.manifest?.permissions ?? [];
  const widened = entry.needsConsent === 'widened';

  const approve = async () => {
    setBusy(entry.id);
    try {
      await window.cc.extensions.grantConsent(entry.id);
      // The onChanged push refreshes `pending`; clear any stale dismissal.
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    } finally {
      setBusy(null);
    }
  };

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(entry.id));
  };

  return (
    <div className="consent-overlay" role="dialog" aria-modal="true" aria-label="Extension permissions">
      <div className="consent-card">
        <h2 className="consent-title">
          {widened ? `${title} wants new permissions` : `Allow “${title}”?`}
        </h2>
        <p className="consent-sub">
          {widened
            ? 'An update added permissions you haven’t approved. Review and allow to keep using it.'
            : 'This extension was installed from disk. Review what it can do before it runs.'}
        </p>
        {perms.length === 0 ? (
          <p className="consent-sub">It requests no special permissions.</p>
        ) : (
          <ul className="consent-perms">
            {perms.map((p) => (
              <li key={p}>{permLabel(p)}</li>
            ))}
          </ul>
        )}
        {scopeLines(entry).map((line) => (
          <p key={line} className="consent-scope">
            {line}
          </p>
        ))}
        <div className="consent-actions">
          <button className="btn" onClick={dismiss} disabled={busy === entry.id}>
            Not now
          </button>
          <button className="btn primary" onClick={approve} disabled={busy === entry.id}>
            {busy === entry.id ? 'Allowing…' : widened ? 'Allow new permissions' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  );
}
