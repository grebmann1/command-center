import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronRight, Star } from 'lucide-react';
import { useData, useInbox, useInboxKeep, useInboxRead, useInboxSelection } from '../store';
import type { InboxEntry } from '@shared/types';
import { groupByBucketThenProject, flattenVisible, subGroupKey } from '../util/inboxGrouping';

/**
 * Inbox sidebar list — port of OpenAlice's InboxSidebar.tsx.
 *
 * Linear-style:
 * - Date-bucketed (Today / Yesterday / This week / Older), newest-first
 * - Within each bucket, entries are sub-grouped by project (color dot +
 *   name + count) so the user can scan per-project activity
 * - Each row: unread dot · relative time · text preview
 * - j/k keyboard navigation (walks the flattened render order)
 * - Default-selects the newest entry on first load if none is selected
 *
 * Read semantics: SELECTION marks read. Every site that mutates the
 * selection (click / j/k / default-select) also calls markRead(id).
 * Bulk-on-visibility is deliberately avoided — see store.ts inbox-read
 * comment for the rationale.
 */
export function InboxSidebar({
  query = '',
  unreadOnly = false
}: {
  query?: string;
  unreadOnly?: boolean;
} = {}) {
  const entries = useInbox((s) => s.entries);
  const loading = useInbox((s) => s.loading);
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const readIds = useInboxRead((s) => s.readIds);
  const keptIds = useInboxKeep((s) => s.keptIds);
  const markRead = useInboxRead((s) => s.markRead);
  const projects = useData((s) => s.projects);

  const selectAndRead = (id: string) => {
    select(id);
    markRead(id);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !unreadOnly) return entries;
    return entries.filter((e) => {
      if (unreadOnly && readIds[e.id]) return false;
      if (!q) return true;
      const hay = `${e.projectLabel ?? e.projectId} ${e.comments ?? ''} ${
        e.docs?.map((d) => d.path).join(' ') ?? ''
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, unreadOnly, readIds]);

  const groups = useMemo(() => groupByBucketThenProject(filtered), [filtered]);

  // Which (bucket, project) scheduled sections are expanded. Collapsed by
  // default so recurring jobs stay folded; toggled by clicking the header.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const toggleScheduled = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Render order (bucket → project → entry → expanded scheduled), flattened to
  // entry ids. j/k and default-select MUST walk this, not `filtered` — the two
  // diverge once a project's entries interleave, and collapsed scheduled rows
  // are intentionally excluded so nav can't land on a hidden row.
  const visibleIds = useMemo(
    () => flattenVisible(groups, expandedKeys),
    [groups, expandedKeys]
  );
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  // Default-select the latest entry on first non-empty load. Latch the
  // ref so once the user touches anything we never override their pick.
  const everSelectedRef = useRef(false);
  useEffect(() => {
    if (everSelectedRef.current) return;
    if (visibleIds.length === 0) return;
    if (!selectedId) {
      selectAndRead(visibleIds[0]);
    }
    everSelectedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, selectedId]);

  // j/k navigation across the visible (render-ordered) sequence.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (visibleIds.length === 0) return;
      const idx = visibleIds.indexOf(selectedId ?? '');
      const next = e.key === 'j' ? Math.min(visibleIds.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (next !== idx && visibleIds[next]) selectAndRead(visibleIds[next]);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, selectedId]);

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

  if (filtered.length === 0) {
    return (
      <div className="inbox-sidebar-empty">
        {unreadOnly && !query.trim()
          ? 'No unread messages.'
          : 'No matches.'}
      </div>
    );
  }

  return (
    <div className="inbox-sidebar-list">
      {groups.map(([bucket, subgroups]) => (
        <div key={bucket} className="inbox-bucket">
          <div className="inbox-bucket-label">{bucket}</div>
          {subgroups.map((sg) => {
            const project = projectsById.get(sg.projectId) ?? null;
            const name = project?.name ?? sg.fallbackLabel;
            const color = project?.color;
            const schedKey = subGroupKey(bucket, sg.projectId);
            const schedExpanded = expandedKeys.has(schedKey);
            const schedCount = sg.scheduledEntries.length;
            const schedUnread = sg.scheduledEntries.filter((e) => !readIds[e.id]).length;
            // Total count shown on the project header includes scheduled.
            const totalCount = sg.entries.length + schedCount;
            return (
              <div key={sg.projectId} className="inbox-project-group">
                <div className="inbox-project-subhead">
                  <span
                    className={`inbox-project-dot ${color ? '' : 'inbox-project-dot--none'}`}
                    style={color ? { background: color } : undefined}
                    aria-hidden
                  />
                  <span className={`inbox-project-name ${project ? '' : 'tombstoned'}`}>
                    {name}
                  </span>
                  <span className="inbox-project-count">{totalCount}</span>
                </div>
                {sg.entries.map((entry) => (
                  <InboxRow
                    key={entry.id}
                    entry={entry}
                    active={entry.id === selectedId}
                    unread={!readIds[entry.id]}
                    kept={!!keptIds[entry.id]}
                    onClick={() => selectAndRead(entry.id)}
                  />
                ))}
                {schedCount > 0 && (
                  <div className="inbox-scheduled-group">
                    <button
                      type="button"
                      className={`inbox-scheduled-head ${schedExpanded ? 'expanded' : ''}`}
                      onClick={() => toggleScheduled(schedKey)}
                      aria-expanded={schedExpanded}
                    >
                      <ChevronRight
                        size={12}
                        className="inbox-scheduled-chevron"
                        aria-hidden
                      />
                      <CalendarClock size={12} aria-hidden />
                      <span className="inbox-scheduled-label">Scheduled</span>
                      <span className="inbox-scheduled-count">
                        {schedUnread > 0 ? `${schedUnread} new · ${schedCount}` : schedCount}
                      </span>
                    </button>
                    {schedExpanded &&
                      sg.scheduledEntries.map((entry) => (
                        <InboxRow
                          key={entry.id}
                          entry={entry}
                          active={entry.id === selectedId}
                          unread={!readIds[entry.id]}
                          kept={!!keptIds[entry.id]}
                          onClick={() => selectAndRead(entry.id)}
                          indented
                        />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function InboxRow({
  entry,
  active,
  unread,
  kept = false,
  onClick,
  indented = false
}: {
  entry: InboxEntry;
  active: boolean;
  unread: boolean;
  /** Flagged "Keep" — shows a star and is protected from Clear inbox. */
  kept?: boolean;
  onClick: () => void;
  /** Extra left padding for rows nested under the Scheduled section. */
  indented?: boolean;
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
      className={`inbox-row ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${indented ? 'indented' : ''} ${kept ? 'kept' : ''}`}
    >
      <div className="inbox-row-line1">
        <span aria-hidden className={`inbox-row-dot ${unread ? 'on' : ''}`} />
        <span className="inbox-row-preview-inline">{previewFor(entry)}</span>
        {kept && (
          <Star
            size={11}
            className="inbox-row-keep-star"
            fill="currentColor"
            strokeWidth={0}
            aria-label="Kept"
          />
        )}
        <span className="inbox-row-ts">{formatRelative(entry.ts)}</span>
      </div>
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

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
