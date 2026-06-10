import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { augmentPath } from '../env.js';

describe('augmentPath', () => {
  const local = join(homedir(), '.local', 'bin');

  it('appends the known CLI dirs when missing', () => {
    const result = augmentPath('/usr/bin:/bin').split(':');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain('/usr/local/bin');
    expect(result).toContain(local);
  });

  it('does not duplicate dirs already present', () => {
    const result = augmentPath('/opt/homebrew/bin:/usr/bin').split(':');
    const homebrewCount = result.filter((d) => d === '/opt/homebrew/bin').length;
    expect(homebrewCount).toBe(1);
  });

  it('preserves original PATH order (existing dirs first)', () => {
    const result = augmentPath('/custom/first:/usr/bin').split(':');
    expect(result[0]).toBe('/custom/first');
    expect(result[1]).toBe('/usr/bin');
  });

  it('handles an empty/undefined PATH by returning just the fallback dirs', () => {
    const result = augmentPath(undefined).split(':').filter(Boolean);
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain(local);
    expect(result.length).toBeGreaterThan(0);
  });

  it('drops empty path segments', () => {
    const result = augmentPath('/usr/bin::/bin:').split(':');
    expect(result).not.toContain('');
  });
});
