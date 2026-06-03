import { useEffect, useMemo, useRef } from 'react';
import { useInbox, useInboxRead, useInboxSelection } from '../store';
import type { InboxEntry } from '@shared/types';

/**
 * Inbox sidebar list — port of OpenAlice's InboxSidebar.tsx.
 *
 * Linear-style:
 * - Date-bucketed (Today / Yesterday / This week / Older), newest-first
 * - Each row: project label · relative time · text preview · unread state
 * - j/k keyboard navigation
 * - Default-selects the newest entry on first load if none is selected
 *
 * Read semantics: SELECTION marks read. Every site that mutates the
 * selection (click / j/k / default-select) also calls markRead(id).
 * Bulk-on-visibility is deliberately avoided — see store.ts inbox-read
 * comment for the rationale.
 */
export function InboxSidebar() {
  const entries = useInbox((s) => s.entries);
  const loading = useInbox((s) => s.loading);
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const readIds = useInboxRead((s) => s.readIds);
  const markRead = useInboxRead((s) => s.markRead);

  const selectAndRead = (id: string) => {
    select(id);
    markRead(id);
  };

  // Default-select the latest entry on first non-empty load. Latch the
  // ref so once the user touches anything we never override their pick.
  const everSelectedRef = useRef(false);
  useEffect(() => {
    if (everSelectedRef.current) return;
    if (entries.length === 0) return;
    if (!selectedId) {
      selectAndRead(entries[0].id);
    }
    everSelectedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selectedId]);

  // j/k navigation across the flat newest-first sequence.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (entries.length === 0) return;
      const idx = entries.findIndex((x) => x.id === selectedId);
      const next = e.key === 'j' ? Math.min(entries.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (next !== idx && entries[next]) selectAndRead(entries[next].id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selectedId]);

  const groups = useMemo(() => groupByBucket(entries), [entries]);

  if (loading && entries.length === 0) {
    return <div className="inbox-sidebar-empty">Loading…</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="inbox-sidebar-empty">
        No inbox messages.
        <div className="inbox-sidebar-empty-hint">
          Projects will push status updates here.
        </div>
      </div>
    );
  }

  return (
    <div className="inbox-sidebar-list">
      {groups.map(([bucket, items]) => (
        <div key={bucket} className="inbox-bucket">
          <div className="inbox-bucket-label">{bucket}</div>
          <div>
            {items.map((entry) => (
              <InboxRow
                key={entry.id}
                entry={entry}
                active={entry.id === selectedId}
                unread={!readIds[entry.id]}
                onClick={() => selectAndRead(entry.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function InboxRow({
  entry,
  active,
  unread,
  onClick
}: {
  entry: InboxEntry;
  active: boolean;
  unread: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inbox-row ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
    >
      <div className="inbox-row-line1">
        <span aria-hidden className={`inbox-row-dot ${unread ? 'on' : ''}`} />
        <span className="inbox-row-label">
          {entry.projectLabel ?? entry.projectId}
        </span>
        <span className="inbox-row-ts">{formatRelative(entry.ts)}</span>
      </div>
      <div className="inbox-row-preview">{previewFor(entry)}</div>
    </div>
  );
}

/**
 * Build the second-line preview text for a sidebar row.
 * - If comments: first non-empty line, leading markdown markers stripped.
 * - Else first doc's path with "+N more" suffix when relevant.
 * - Else empty (shouldn't happen — store rejects entries with neither).
 */
function previewFor(entry: InboxEntry): string {
  const c = (entry.comments ?? '').trim();
  if (c) {
    const firstLine = c.split('\n').find((l) => l.trim().length > 0) ?? '';
    return firstLine.replace(/^[#>*\-]+\s*/, '').trim();
  }
  if (entry.docs && entry.docs.length > 0) {
    const d = entry.docs[0];
    if (d) {
      const suffix = entry.docs.length > 1 ? ` · +${entry.docs.length - 1} more` : '';
      return `📄 ${d.path}${suffix}`;
    }
  }
  return '';
}

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Older';

function groupByBucket(entries: readonly InboxEntry[]): Array<[Bucket, InboxEntry[]]> {
  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;

  const buckets: Record<Bucket, InboxEntry[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Older: []
  };

  for (const e of entries) {
    if (e.ts >= today) buckets.Today.push(e);
    else if (e.ts >= yesterday) buckets.Yesterday.push(e);
    else if (e.ts >= weekStart) buckets['This week'].push(e);
    else buckets.Older.push(e);
  }

  const order: Bucket[] = ['Today', 'Yesterday', 'This week', 'Older'];
  return order
    .map((b): [Bucket, InboxEntry[]] => [b, buckets[b]])
    .filter(([, items]) => items.length > 0);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
