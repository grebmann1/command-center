import { describe, it, expect } from 'vitest';
import { buildLaunchArgs } from '../QuickAgentLauncher.js';

/**
 * `buildLaunchArgs` mirrors `LaunchPanel.launch()`'s argv assembly: the prompt
 * is the last positional element, a leading dash is escaped with `--`, and an
 * empty prompt yields no args + the profile-label fallback title. These are the
 * invariants the scheduler/pty prompt-seeding convention relies on.
 */
describe('buildLaunchArgs', () => {
  it('seeds the prompt as the last positional arg and derives a title', () => {
    const { extraArgs, title } = buildLaunchArgs('Clone a repo and report back', 'claude');
    expect(extraArgs).toEqual(['Clone a repo and report back']);
    expect(title).toBe('Clone a repo and report back');
  });

  it('escapes a dash-leading prompt with `--` so it is not parsed as a flag', () => {
    const { extraArgs } = buildLaunchArgs('--help me understand this repo', 'claude');
    expect(extraArgs).toEqual(['--', '--help me understand this repo']);
  });

  it('trims whitespace and truncates long titles to 40 chars + ellipsis', () => {
    const long = 'a'.repeat(60);
    const { extraArgs, title } = buildLaunchArgs(`   ${long}   `, 'claude');
    expect(extraArgs).toEqual([long]);
    expect(title).toBe(`${'a'.repeat(40)}…`);
  });

  it('falls back to the profile label and no args when the prompt is empty', () => {
    expect(buildLaunchArgs('', 'claude --yolo')).toEqual({
      extraArgs: undefined,
      title: 'claude --yolo'
    });
    expect(buildLaunchArgs('   ', 'claude')).toEqual({
      extraArgs: undefined,
      title: 'claude'
    });
  });
});
