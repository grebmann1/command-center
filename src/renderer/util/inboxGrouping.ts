import type { InboxEntry } from '../../shared/types.js';

/**
 * Inbox grouping: time bucket (top level) → project sub-group (nested).
 *
 * The sidebar buckets entries by recency, and within each bucket sub-groups
 * them by project so the user can scan "what happened in <project> today".
 * This module is pure (no React, no project registry) so it's unit-testable
 * and so the render layer owns live name/color resolution — the helper only
 * knows `projectId` + a fallback label snapshotted on the entry.
 */

export type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Older';

export interface ProjectSubGroup {
  projectId: string;
  /**
   * Display fallback from the entry snapshot (`projectLabel ?? projectId`).
   * The render layer overrides this with the live project name when the
   * project still exists; for a tombstoned project this is all we have.
   */
  fallbackLabel: string;
  /** Entries for this project within the bucket, newest-first (input order). */
  entries: InboxEntry[];
}

const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'This week', 'Older'];

/** Assign one entry to its time bucket using day-aligned thresholds. */
function bucketFor(ts: number, now: number): Bucket {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;
  if (ts >= today) return 'Today';
  if (ts >= yesterday) return 'Yesterday';
  if (ts >= weekStart) return 'This week';
  return 'Older';
}

/**
 * Group entries by time bucket, then by project within each bucket.
 *
 * Input is expected newest-first (the store's order). Properties:
 *  - Buckets appear in canonical order; empty buckets are omitted.
 *  - Within a bucket, project sub-groups are ordered by their most-recent
 *    entry (a `Map` keyed by projectId preserves first-seen = newest order).
 *  - Entries within a sub-group keep the newest-first input order.
 *  - Interleaved projects (A, B, A in input) collapse to one sub-group each,
 *    ordered [A, B] because A's newest entry was seen first.
 *
 * Pure: takes `now` for deterministic testing (defaults to Date.now()).
 */
export function groupByBucketThenProject(
  entries: readonly InboxEntry[],
  now: number = Date.now()
): Array<[Bucket, ProjectSubGroup[]]> {
  const byBucket = new Map<Bucket, Map<string, ProjectSubGroup>>();
  for (const b of BUCKET_ORDER) byBucket.set(b, new Map());

  for (const e of entries) {
    const bucket = bucketFor(e.ts, now);
    const groups = byBucket.get(bucket)!;
    let sg = groups.get(e.projectId);
    if (!sg) {
      sg = {
        projectId: e.projectId,
        fallbackLabel: e.projectLabel ?? e.projectId,
        entries: []
      };
      groups.set(e.projectId, sg);
    }
    sg.entries.push(e);
  }

  const result: Array<[Bucket, ProjectSubGroup[]]> = [];
  for (const bucket of BUCKET_ORDER) {
    const groups = byBucket.get(bucket)!;
    if (groups.size === 0) continue;
    result.push([bucket, [...groups.values()]]);
  }
  return result;
}

/**
 * Flatten grouped output to the entry-id sequence in *render* order
 * (bucket → project sub-group → entry). j/k navigation and default-select
 * must walk this, NOT the raw newest-first list — the two diverge once a
 * project's entries are interleaved with another's in the same bucket.
 */
export function flattenVisible(groups: Array<[Bucket, ProjectSubGroup[]]>): string[] {
  return groups.flatMap(([, subgroups]) =>
    subgroups.flatMap((sg) => sg.entries.map((e) => e.id))
  );
}
