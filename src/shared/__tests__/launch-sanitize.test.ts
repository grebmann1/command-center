import { describe, it, expect } from 'vitest';
import { sanitizeExtraArgs, DENIED_LAUNCH_FLAGS } from '../launch-sanitize.js';

describe('sanitizeExtraArgs', () => {
  it('passes benign args through unchanged', () => {
    const { args, removed } = sanitizeExtraArgs(['--model', 'opus', '-p', 'hello']);
    expect(args).toEqual(['--model', 'opus', '-p', 'hello']);
    expect(removed).toEqual([]);
  });

  it('strips --dangerously-skip-permissions', () => {
    const { args, removed } = sanitizeExtraArgs(['--dangerously-skip-permissions', '--model', 'opus']);
    expect(args).toEqual(['--model', 'opus']);
    expect(removed).toEqual(['--dangerously-skip-permissions']);
  });

  it('strips a denied flag AND its following value (space form)', () => {
    const { args, removed } = sanitizeExtraArgs(['--mcp-config', '/tmp/evil.json', '--model', 'opus']);
    expect(args).toEqual(['--model', 'opus']);
    expect(removed).toEqual(['--mcp-config']);
  });

  it('strips a denied flag in --flag=value form (single token)', () => {
    const { args, removed } = sanitizeExtraArgs(['--permission-mode=acceptEdits', '-p', 'x']);
    expect(args).toEqual(['-p', 'x']);
    expect(removed).toEqual(['--permission-mode']);
  });

  it('does not eat a following flag as a value', () => {
    const { args, removed } = sanitizeExtraArgs(['--append-system-prompt', '--model', 'opus']);
    expect(args).toEqual(['--model', 'opus']);
    expect(removed).toEqual(['--append-system-prompt']);
  });

  it('handles empty / undefined', () => {
    expect(sanitizeExtraArgs(undefined)).toEqual({ args: [], removed: [] });
    expect(sanitizeExtraArgs([])).toEqual({ args: [], removed: [] });
  });

  it('every denied flag is actually stripped', () => {
    for (const flag of DENIED_LAUNCH_FLAGS) {
      const { args, removed } = sanitizeExtraArgs([flag, 'val']);
      expect(removed).toContain(flag);
      expect(args).not.toContain(flag);
    }
  });
});
