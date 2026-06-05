import { describe, it, expect } from 'vitest';
import {
  parseEvery,
  formatInterval,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS
} from '../../shared/parse-every.js';

describe('parseEvery', () => {
  it('parses simple units', () => {
    expect(parseEvery('5m')).toBe(5 * 60_000);
    expect(parseEvery('1h')).toBe(3_600_000);
    expect(parseEvery('24h')).toBe(24 * 3_600_000);
  });

  it('parses mixed units', () => {
    expect(parseEvery('1h30m')).toBe(60 * 60_000 + 30 * 60_000);
    expect(parseEvery('  2h 0m  ')).toBeNull(); // whitespace inside isn't allowed
    expect(parseEvery('2h0m')).toBe(2 * 3_600_000);
  });

  it('floors below the minimum', () => {
    // "10s" is shorter than the floor — it gets rounded up rather than rejected
    // so a hand-edited typo doesn't fork-bomb the laptop.
    expect(parseEvery('10s')).toBe(MIN_INTERVAL_MS);
    expect(parseEvery('30s')).toBe(MIN_INTERVAL_MS);
  });

  it('caps at the 24-day maximum', () => {
    // Node's setTimeout clamps delays > ~24.85d to 1ms; cap defensively below that.
    expect(parseEvery('30d')).toBe(MAX_INTERVAL_MS);
    expect(parseEvery('100d')).toBe(MAX_INTERVAL_MS);
  });

  it('returns null for garbage', () => {
    expect(parseEvery('1 hour')).toBeNull();
    expect(parseEvery('1hr')).toBeNull();
    expect(parseEvery('60')).toBeNull();
    expect(parseEvery('')).toBeNull();
    expect(parseEvery('abc')).toBeNull();
  });
});

describe('formatInterval', () => {
  it('formats common values', () => {
    expect(formatInterval(5 * 60_000)).toBe('5m');
    expect(formatInterval(60 * 60_000)).toBe('1h');
    expect(formatInterval(60 * 60_000 + 30 * 60_000)).toBe('1h 30m');
    expect(formatInterval(24 * 60 * 60_000)).toBe('1d');
    expect(formatInterval(25 * 60 * 60_000)).toBe('1d 1h');
  });
});
