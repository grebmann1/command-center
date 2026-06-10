import { describe, it, expect } from 'vitest';
import {
  columnKeyForStatus,
  backlogColumnKeyForPriority,
  isClosedStatus,
  BOARD_COLUMNS,
  BACKLOG_COLUMNS,
  OTHER_COLUMN_KEY,
  BACKLOG_UNPRIORITIZED_KEY
} from './types.js';

describe('columnKeyForStatus', () => {
  it('maps each board column status to its own key (exact match)', () => {
    for (const col of BOARD_COLUMNS) {
      if (col.status) expect(columnKeyForStatus(col.status)).toBe(col.key);
    }
  });

  it('is case-insensitive and trims', () => {
    expect(columnKeyForStatus('in progress')).toBe('in-progress');
    expect(columnKeyForStatus('  New  ')).toBe('new');
    expect(columnKeyForStatus('READY FOR REVIEW')).toBe('review');
  });

  it('routes unknown / sub-statuses to the catch-all Other column', () => {
    expect(columnKeyForStatus('Closed - Duplicate')).toBe(OTHER_COLUMN_KEY);
    expect(columnKeyForStatus('Investigating')).toBe(OTHER_COLUMN_KEY);
    expect(columnKeyForStatus('Some Future Status')).toBe(OTHER_COLUMN_KEY);
  });
});

describe('isClosedStatus', () => {
  it('treats Closed and its sub-variants as closed', () => {
    expect(isClosedStatus('Closed')).toBe(true);
    expect(isClosedStatus('Closed - No Fix - Will Not Fix')).toBe(true);
    expect(isClosedStatus('Rejected')).toBe(true);
    expect(isClosedStatus('Never')).toBe(true);
    expect(isClosedStatus('Not Reproducible')).toBe(true);
  });

  it('treats active statuses as open', () => {
    expect(isClosedStatus('New')).toBe(false);
    expect(isClosedStatus('In Progress')).toBe(false);
    expect(isClosedStatus('Ready for Review')).toBe(false);
    expect(isClosedStatus('Completed')).toBe(false);
  });
});

describe('backlogColumnKeyForPriority', () => {
  it('maps each P-level to its own backlog column (case-insensitive)', () => {
    expect(backlogColumnKeyForPriority('P0')).toBe('prio-p0');
    expect(backlogColumnKeyForPriority('p1')).toBe('prio-p1');
    expect(backlogColumnKeyForPriority('  P2 ')).toBe('prio-p2');
    expect(backlogColumnKeyForPriority('P3')).toBe('prio-p3');
    expect(backlogColumnKeyForPriority('P4')).toBe('prio-p4');
  });

  it('routes missing or unknown priorities to the Unprioritized column', () => {
    expect(backlogColumnKeyForPriority(undefined)).toBe(BACKLOG_UNPRIORITIZED_KEY);
    expect(backlogColumnKeyForPriority('')).toBe(BACKLOG_UNPRIORITIZED_KEY);
    expect(backlogColumnKeyForPriority('P9')).toBe(BACKLOG_UNPRIORITIZED_KEY);
  });

  it('covers every backlog column with its mapping', () => {
    for (const col of BACKLOG_COLUMNS) {
      // Every backlog column must be reachable: P-columns via their priority,
      // and the catch-all via an unknown/missing priority.
      const reached =
        col.key === BACKLOG_UNPRIORITIZED_KEY
          ? backlogColumnKeyForPriority(undefined)
          : backlogColumnKeyForPriority(col.title);
      expect(reached).toBe(col.key);
    }
  });

  it('makes no backlog column droppable (team-wide, read-only)', () => {
    for (const col of BACKLOG_COLUMNS) expect(col.droppable).toBe(false);
  });
});

describe('BOARD_COLUMNS', () => {
  it('has a non-droppable Closed column (closing needs a GUS sub-reason)', () => {
    const closed = BOARD_COLUMNS.find((c) => c.key === 'closed');
    expect(closed?.droppable).toBe(false);
  });

  it('marks the workflow columns droppable with an exact status', () => {
    for (const key of ['new', 'in-progress', 'review', 'fixed', 'qa', 'completed']) {
      const col = BOARD_COLUMNS.find((c) => c.key === key);
      expect(col?.droppable).toBe(true);
      expect(typeof col?.status).toBe('string');
    }
  });
});
