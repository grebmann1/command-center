import { describe, it, expect } from 'vitest';
import {
  columnKeyForStatus,
  isClosedStatus,
  BOARD_COLUMNS,
  OTHER_COLUMN_KEY
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
