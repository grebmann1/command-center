import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// mcp-config derives its dir from os.homedir() at import time. Point homedir
// at a throwaway dir so the test writes there, not the real ~/.cc-center.
const fakeHome = mkdtempSync(join(tmpdir(), 'cc-mcp-home-'));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

let mod: typeof import('../mcp-config.js');

beforeAll(async () => {
  mod = await import('../mcp-config.js');
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('ensureMcpConfigForProjectSync', () => {
  it('writes a .mcp.json at the per-project path', () => {
    const path = mod.ensureMcpConfigForProjectSync('proj-abc');
    expect(path).toBe(mod.mcpConfigPathForProject('proj-abc'));
    expect(existsSync(path)).toBe(true);
  });

  it('writes the cc-inbox server with the literal ${CC_MCP_URL} placeholder', () => {
    const path = mod.ensureMcpConfigForProjectSync('proj-xyz');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['cc-inbox']).toEqual({
      type: 'streamable-http',
      url: '${CC_MCP_URL}'
    });
  });

  it('is idempotent — repeated calls leave one valid file', () => {
    const a = mod.ensureMcpConfigForProjectSync('proj-idem');
    const b = mod.ensureMcpConfigForProjectSync('proj-idem');
    expect(a).toBe(b);
    expect(() => JSON.parse(readFileSync(a, 'utf8'))).not.toThrow();
  });

  it('does not leave a .tmp file behind after the atomic rename', () => {
    mod.ensureMcpConfigForProjectSync('proj-tmp');
    const dir = join(fakeHome, '.cc-center', 'mcp');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('produces byte-identical output to the async writer', async () => {
    const syncPath = mod.ensureMcpConfigForProjectSync('proj-parity-sync');
    const asyncPath = await mod.ensureMcpConfigForProject('proj-parity-async');
    expect(readFileSync(syncPath, 'utf8')).toBe(readFileSync(asyncPath, 'utf8'));
  });
});
