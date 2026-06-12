/**
 * gus-main — exercises the `ctx.exec` migration (GUS-EXT-A).
 *
 * gus no longer touches any raw node spawn API; it runs `sf` solely through the
 * brokered `ctx.exec` capability. These tests use a mock ctx to assert:
 *   - capabilities call `exec({ bin: 'sf', args: [...] })` with the right argv
 *   - a non-zero exit that still prints JSON RESOLVES and is parsed (sf pattern)
 *   - a non-zero exit with an error JSON throws the CLI's own message
 *   - an exec REJECT (sf missing / watchdog kill — S3) surfaces a clean
 *     "sf CLI unavailable" error, not the raw ENOENT/timeout
 *   - `setup` throws if no `exec` is on the ctx at all
 *
 * The module caches identity in a process-level singleton, so each test does a
 * fresh `import` after `vi.resetModules()` to isolate that cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MainModuleContext, ExecRequest, ExecResult } from '@cctc/extension-sdk/main';

type ExecFn = (req: ExecRequest) => Promise<ExecResult>;

/** Build a mock ctx whose `exec` is a vi.fn the test controls. */
function makeCtx(exec: ExecFn | undefined): { ctx: MainModuleContext; log: ReturnType<typeof vi.fn> } {
  const log = vi.fn();
  const ctx: MainModuleContext = {
    storage: { get: () => undefined, set: () => undefined },
    log,
    exec
  };
  return { ctx, log };
}

/** Fresh module per test so the module-level identityCache can't leak across. */
async function loadModule() {
  vi.resetModules();
  return (await import('./gus-main.js')).gusMainModule;
}

/** A successful `org display user` exec result (used to satisfy loadIdentity). */
function identityOk(): ExecResult {
  return {
    stdout: JSON.stringify({
      status: 0,
      result: { id: '005xx', username: 'me@gus', instanceUrl: 'https://gus.my.salesforce.com' }
    }),
    stderr: '',
    code: 0
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('gus-main ctx.exec migration', () => {
  it('setup throws when the ctx provides no exec capability', async () => {
    const mod = await loadModule();
    const { ctx } = makeCtx(undefined);
    expect(() => mod.setup(ctx)).toThrow(/exec capability is unavailable/i);
  });

  it('whoami calls exec({ bin: "sf", args: [org display user …] }) and parses identity', async () => {
    const mod = await loadModule();
    const exec = vi.fn<ExecFn>().mockResolvedValue(identityOk());
    const { ctx } = makeCtx(exec);
    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const id = await caps.whoami();

    expect(exec).toHaveBeenCalledTimes(1);
    const req = exec.mock.calls[0][0];
    expect(req.bin).toBe('sf');
    expect(req.args).toEqual(['org', 'display', 'user', '--target-org', 'gus', '--json']);
    expect(id).toEqual({ username: 'me@gus', userId: '005xx', instanceUrl: 'https://gus.my.salesforce.com' });
  });

  it('listWork runs a data query and maps records (exec called with the query argv)', async () => {
    const mod = await loadModule();
    const exec = vi.fn<ExecFn>();
    // first call: identity; second call: the work query.
    exec.mockResolvedValueOnce(identityOk()).mockResolvedValueOnce({
      stdout: JSON.stringify({
        status: 0,
        result: { records: [{ Id: 'a01', Name: 'W-1', Subject__c: 'Fix it', Status__c: 'New' }] }
      }),
      stderr: '',
      code: 0
    });
    const { ctx } = makeCtx(exec);
    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const items = (await caps.listWork()) as Array<{ id: string; name: string; status: string }>;

    expect(exec).toHaveBeenCalledTimes(2);
    const queryReq = exec.mock.calls[1][0];
    expect(queryReq.bin).toBe('sf');
    expect(queryReq.args?.slice(0, 5)).toEqual(['data', 'query', '--target-org', 'gus', '--json']);
    expect(items).toEqual([{ id: 'a01', name: 'W-1', subject: 'Fix it', status: 'New' } as unknown]);
  });

  it('setStatus runs a data update record with the right argv and resolves on status 0', async () => {
    const mod = await loadModule();
    const exec = vi
      .fn<ExecFn>()
      .mockResolvedValue({ stdout: JSON.stringify({ status: 0 }), stderr: '', code: 0 });
    const { ctx } = makeCtx(exec);
    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const res = await caps.setStatus('a01', 'In Progress');

    expect(res).toEqual({ ok: true, status: 'In Progress' });
    const req = exec.mock.calls[0][0];
    expect(req.bin).toBe('sf');
    expect(req.args).toEqual([
      'data',
      'update',
      'record',
      '--target-org',
      'gus',
      '--sobject',
      'ADM_Work__c',
      '--record-id',
      'a01',
      '--values',
      "Status__c='In Progress'",
      '--json'
    ]);
  });

  it('surfaces sf’s own message on a non-zero exit that resolves with error JSON', async () => {
    const mod = await loadModule();
    // sf auth/validation failures exit non-zero but RESOLVE (code != 0) with a
    // JSON body carrying `message` — gus parses that for a precise error.
    const exec = vi.fn<ExecFn>().mockResolvedValue({
      stdout: JSON.stringify({ status: 1, message: 'No authorization found for org gus' }),
      stderr: '',
      code: 1
    });
    const { ctx, log } = makeCtx(exec);
    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    await expect(caps.whoami()).rejects.toThrow('No authorization found for org gus');
    // NOT the "unavailable" reject path — exec resolved, so we keep sf's message.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('identity failed'));
  });

  it('translates an exec REJECT (sf missing / watchdog kill, S3) into a clean "sf CLI unavailable" error', async () => {
    const mod = await loadModule();
    const exec = vi
      .fn<ExecFn>()
      .mockRejectedValue(new Error('exec: failed to start "sf" (ENOENT)'));
    const { ctx, log } = makeCtx(exec);
    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;

    await expect(caps.whoami()).rejects.toThrow(/sf CLI unavailable/i);
    // The raw ENOENT is logged for diagnosis but not shown to the renderer.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });
});
