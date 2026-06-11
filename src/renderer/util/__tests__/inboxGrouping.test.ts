import { describe, it, expect } from 'vitest';
import type { InboxEntry } from '../../../shared/types.js';
import {
  groupByBucketThenProject,
  flattenVisible,
  subGroupKey,
  type Bucket
} from '../inboxGrouping.js';

// Fixed "now" so bucket thresholds are deterministic: noon on a known day.
const NOW = new Date('2026-06-11T12:00:00').getTime();
const DAY = 86_400_000;

function entry(over: Partial<InboxEntry> & { id: string; ts: number }): InboxEntry {
  return {
    projectId: 'p1',
    comments: 'hello',
    ...over
  };
}

/** Convenience: map bucket → array of [projectId, entryIds[]] for assertions. */
function shape(groups: Array<[Bucket, ReturnType<typeof groupByBucketThenProject>[number][1]]>) {
  return groups.map(([bucket, sgs]) => [
    bucket,
    sgs.map((sg) => [sg.projectId, sg.entries.map((e) => e.id)])
  ]);
}

describe('groupByBucketThenProject', () => {
  it('returns [] for empty input', () => {
    expect(groupByBucketThenProject([], NOW)).toEqual([]);
  });

  it('assigns entries to the right time buckets', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'today', ts: NOW - 1000 }),
      entry({ id: 'yest', ts: NOW - 1.5 * DAY }),
      entry({ id: 'week', ts: NOW - 3 * DAY }),
      entry({ id: 'old', ts: NOW - 30 * DAY })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(groups.map(([b]) => b)).toEqual(['Today', 'Yesterday', 'This week', 'Older']);
  });

  it('omits empty buckets', () => {
    const entries = [entry({ id: 'a', ts: NOW - 1000 })];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(groups.map(([b]) => b)).toEqual(['Today']);
  });

  it('orders project sub-groups by most-recent entry within a bucket', () => {
    // Newest-first input: project B's newest entry precedes A's newest.
    const entries: InboxEntry[] = [
      entry({ id: 'b1', projectId: 'B', ts: NOW - 1000 }),
      entry({ id: 'a1', projectId: 'A', ts: NOW - 2000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(shape(groups)).toEqual([
      ['Today', [['B', ['b1']], ['A', ['a1']]]]
    ]);
  });

  it('collapses interleaved projects into one sub-group each, newest-first within', () => {
    // Input A,B,A (newest-first) → groups [A(2), B(1)] because A seen first.
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 2000 }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 3000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(shape(groups)).toEqual([
      ['Today', [['A', ['a1', 'a2']], ['B', ['b1']]]]
    ]);
  });

  it('splits scheduled entries out of the inline entries list', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true }),
      entry({ id: 's2', projectId: 'A', ts: NOW - 3000, scheduled: true }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 4000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(sgs[0].scheduledEntries.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('uses projectLabel as fallbackLabel, else projectId', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a', projectId: 'P-with-label', projectLabel: 'My Project', ts: NOW - 1000 }),
      entry({ id: 'b', projectId: 'P-no-label', ts: NOW - 2000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].fallbackLabel).toBe('My Project');
    expect(sgs[1].fallbackLabel).toBe('P-no-label');
  });
});

describe('flattenVisible', () => {
  it('flattens to entry ids in render order (bucket → project → entry)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 2000 }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 3000 }),
      entry({ id: 'old', projectId: 'A', ts: NOW - 30 * DAY })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // Today: A[a1,a2], B[b1]; Older: A[old]
    expect(flattenVisible(groups)).toEqual(['a1', 'a2', 'b1', 'old']);
  });

  it('returns [] for empty groups', () => {
    expect(flattenVisible([])).toEqual([]);
  });

  it('excludes scheduled entries when their section is collapsed', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // No expanded set → collapsed → scheduled id absent.
    expect(flattenVisible(groups)).toEqual(['a1']);
  });

  it('includes scheduled entries when their section is expanded', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const expanded = new Set([subGroupKey('Today', 'A')]);
    expect(flattenVisible(groups, expanded)).toEqual(['a1', 's1']);
  });
});
