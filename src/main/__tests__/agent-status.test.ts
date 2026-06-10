import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyOscTitle,
  extractLastOscTitle,
  AgentStatusTracker
} from '../agent-status.js';

describe('classifyOscTitle', () => {
  it('maps a leading braille spinner glyph to working', () => {
    expect(classifyOscTitle('⠹ Cooking…')).toBe('working');
    expect(classifyOscTitle('⠀ idle-looking braille')).toBe('working');
    expect(classifyOscTitle('⣿ tail of range')).toBe('working');
  });

  it('maps a leading ✳ (U+2733) to idle', () => {
    expect(classifyOscTitle('✳ my-project')).toBe('idle');
  });

  it('tolerates leading whitespace before the marker', () => {
    expect(classifyOscTitle('  ⠹ working')).toBe('working');
  });

  it('returns null for titles with no agent signal', () => {
    expect(classifyOscTitle('~/code/my-project')).toBeNull();
    expect(classifyOscTitle('zsh')).toBeNull();
    expect(classifyOscTitle('')).toBeNull();
  });
});

describe('extractLastOscTitle', () => {
  it('extracts an OSC 2 title terminated by BEL', () => {
    expect(extractLastOscTitle('\x1b]2;hello\x07')).toBe('hello');
  });

  it('extracts an OSC 0 title terminated by ST (ESC backslash)', () => {
    expect(extractLastOscTitle('\x1b]0;hello\x1b\\')).toBe('hello');
  });

  it('returns the LAST title when a chunk sets several', () => {
    const chunk = '\x1b]2;⠹ a\x07 output \x1b]2;⠹ b\x07 more \x1b]2;✳ done\x07';
    expect(extractLastOscTitle(chunk)).toBe('✳ done');
  });

  it('returns null when the chunk has no title sequence', () => {
    expect(extractLastOscTitle('just some plain output\r\n')).toBeNull();
  });
});

describe('AgentStatusTracker (debounced emits)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits a debounced status change from an OSC-title data chunk', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, string]> = [];
    tracker.on('status', (id, state) => seen.push([id, state]));

    tracker.observeData('s1', '\x1b]2;⠹ Working…\x07');
    expect(seen).toEqual([]); // not yet — debounced
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([['s1', 'working']]);
    expect(tracker.get('s1')).toBe('working');
  });

  it('coalesces a burst into a single emit of the final state', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, string]> = [];
    tracker.on('status', (id, state) => seen.push([id, state]));

    // Spinner frames then settle to idle, all within one window.
    tracker.report('s1', 'working');
    tracker.report('s1', 'working');
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([['s1', 'idle']]);
  });

  it('does not emit when the state is unchanged', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'working'); // same state again
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['working']);
  });

  it('emits separate transitions across windows', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['working', 'idle']);
  });

  it('clears pending timers on remove', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    tracker.remove('s1');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([]);
    expect(tracker.get('s1')).toBe('unknown');
  });

  it('ignores data chunks with no agent signal', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.observeData('s1', 'plain output, no OSC title\r\n');
    tracker.observeData('s1', '\x1b]2;~/some/cwd\x07'); // title, but no marker
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([]);
  });
});
