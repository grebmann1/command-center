/**
 * gus-cdc — tests for the CDC watcher capabilities.
 *
 * Exercises:
 *   - parsePollEvery: interval parsing (2m, 30s, 1h) with min coercion
 *   - substitutePrompt: {{Field}} token substitution
 *   - detectCdcMatches: pure diff logic (CREATE/UPDATE detection)
 *   - cdcSaveTrigger: saves to storage and arms/disarms based on enabled flag
 *   - teardown: clears all timers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MainModuleContext, ExecRequest, ExecResult } from '@cctc/extension-sdk/main';
import type { CdcTrigger, GusWorkItem } from '../shared/types.js';
import { parsePollEvery, substitutePrompt, detectCdcMatches } from './gus-main.js';

type ExecFn = (req: ExecRequest) => Promise<ExecResult>;

/** Build a mock ctx whose `exec` is a vi.fn the test controls. */
function makeCtx(exec: ExecFn | undefined): {
  ctx: MainModuleContext;
  log: ReturnType<typeof vi.fn>;
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  const log = vi.fn();
  const ctx: MainModuleContext = {
    storage: {
      get: (key: string) => storage.get(key),
      set: (key: string, value: unknown) => storage.set(key, value)
    },
    log,
    exec
  };
  return { ctx, log, storage };
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

/** Fresh module per test so module-level state (timers, pending) resets. */
async function loadModule() {
  vi.resetModules();
  return (await import('./gus-main.js')).gusMainModule;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parsePollEvery', () => {
  it('parses "2m" to 120000ms', () => {
    expect(parsePollEvery('2m')).toBe(120_000);
  });

  it('coerces "30s" up to 60000ms (1m floor)', () => {
    expect(parsePollEvery('30s')).toBe(60_000);
  });

  it('parses "1h" to 3600000ms', () => {
    expect(parsePollEvery('1h')).toBe(3_600_000);
  });

  it('returns null for invalid input', () => {
    expect(parsePollEvery('invalid')).toBeNull();
    expect(parsePollEvery('')).toBeNull();
    expect(parsePollEvery('0s')).toBeNull();
  });
});

describe('substitutePrompt', () => {
  it('replaces {{field}} tokens with GusWorkItem values', () => {
    const item: GusWorkItem = {
      id: 'a01',
      name: 'W-123',
      subject: 'Fix the bug',
      status: 'New',
      priority: 'P1'
    };
    const result = substitutePrompt('Work on {{name}} ({{status}}): {{subject}}', item);
    expect(result).toBe('Work on W-123 (New): Fix the bug');
  });

  it('replaces missing fields with empty string', () => {
    const item: GusWorkItem = {
      id: 'a01',
      name: 'W-123',
      subject: 'Test',
      status: 'New'
    };
    const result = substitutePrompt('{{name}} {{assignee}}', item);
    expect(result).toBe('W-123 ');
  });

  it('resolves raw SF field-name tokens (Name/Status__c/Subject__c) from the raw row', () => {
    // The panel advertises raw SF field names in the template hint, so a user's
    // {{Name}} / {{Status__c}} must resolve — against the raw row, not the
    // lowercase mapped item.
    const item: GusWorkItem = { id: 'a01', name: 'W-123', subject: 'Fix it', status: 'Triaged' };
    const raw = { Id: 'a01', Name: 'W-123', Subject__c: 'Fix it', Status__c: 'Triaged' };
    const result = substitutePrompt('Investigate {{Name}} ({{Status__c}}): {{Subject__c}}', item, raw);
    expect(result).toBe('Investigate W-123 (Triaged): Fix it');
  });

  it('prefers the raw row but falls back to the mapped item for lowercase keys', () => {
    const item: GusWorkItem = { id: 'a01', name: 'W-9', subject: 'S', status: 'New' };
    const raw = { Id: 'a01', Name: 'W-9', Status__c: 'New' };
    // {{name}} isn't on the raw row → falls back to the mapped item.
    expect(substitutePrompt('{{Name}}/{{name}}', item, raw)).toBe('W-9/W-9');
  });
});

describe('detectCdcMatches', () => {
  it('fires on CREATE when changeType includes CREATE', () => {
    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['CREATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'New: {{name}}' },
      requireConfirm: true
    };

    const rows = [
      {
        Id: 'a01',
        Name: 'W-123',
        Subject__c: 'New bug',
        Status__c: 'New',
        SystemModstamp: '2026-06-13T10:00:00Z'
      }
    ];

    const lastSeen = {};
    const { matches, nextLastSeen } = detectCdcMatches(rows, trigger, lastSeen);

    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('W-123');
    expect(nextLastSeen['a01']).toEqual({
      modstamp: '2026-06-13T10:00:00Z',
      fields: { Status__c: 'New' }
    });
  });

  it('fires on UPDATE when watched field changes', () => {
    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'Updated: {{name}}' },
      requireConfirm: true
    };

    const rows = [
      {
        Id: 'a01',
        Name: 'W-123',
        Subject__c: 'Bug',
        Status__c: 'In Progress',
        SystemModstamp: '2026-06-13T10:05:00Z'
      }
    ];

    const lastSeen = {
      a01: {
        modstamp: '2026-06-13T10:00:00Z',
        fields: { Status__c: 'New' }
      }
    };

    const { matches, nextLastSeen } = detectCdcMatches(rows, trigger, lastSeen);

    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('In Progress');
    expect(nextLastSeen['a01'].fields.Status__c).toBe('In Progress');
  });

  it('does NOT fire on UPDATE when watched field is unchanged', () => {
    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'Updated: {{name}}' },
      requireConfirm: true
    };

    const rows = [
      {
        Id: 'a01',
        Name: 'W-123',
        Subject__c: 'Bug (edited)',
        Status__c: 'New',
        SystemModstamp: '2026-06-13T10:05:00Z'
      }
    ];

    const lastSeen = {
      a01: {
        modstamp: '2026-06-13T10:00:00Z',
        fields: { Status__c: 'New' }
      }
    };

    const { matches } = detectCdcMatches(rows, trigger, lastSeen);

    expect(matches).toHaveLength(0);
  });

  it('updates nextLastSeen even when there are no matches', () => {
    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['CREATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'Test' },
      requireConfirm: true
    };

    const rows = [
      {
        Id: 'a01',
        Name: 'W-123',
        Subject__c: 'Bug',
        Status__c: 'New',
        SystemModstamp: '2026-06-13T10:00:00Z'
      }
    ];

    const lastSeen = {
      a01: {
        modstamp: '2026-06-13T10:00:00Z',
        fields: { Status__c: 'New' }
      }
    };

    const { matches, nextLastSeen } = detectCdcMatches(rows, trigger, lastSeen);

    expect(matches).toHaveLength(0);
    expect(nextLastSeen['a01']).toEqual({
      modstamp: '2026-06-13T10:00:00Z',
      fields: { Status__c: 'New' }
    });
  });
});

describe('gus-cdc lifecycle', () => {
  it('arms a trigger with enabled=true and polls on interval', async () => {
    const mod = await loadModule();
    const exec = vi.fn<ExecFn>();
    const { ctx } = makeCtx(exec);

    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '2m',
      launch: { personaId: 'p1', promptTemplate: 'Test {{name}}' },
      requireConfirm: true
    };

    exec.mockResolvedValueOnce(identityOk()).mockResolvedValue({
      stdout: JSON.stringify({ status: 0, result: { records: [] } }),
      stderr: '',
      code: 0
    });

    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await caps.cdcSaveTrigger(trigger);

    // Wait for the initial async poll (1ms advance is enough to trigger immediate poll).
    await vi.advanceTimersByTimeAsync(1);

    // Initial poll fires immediately.
    expect(exec).toHaveBeenCalledTimes(2); // identity + initial poll

    // Advance 2m, next poll should fire.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(exec).toHaveBeenCalledTimes(3); // +1 poll after 2m
  });

  it('disarms a trigger when saved with enabled=false', async () => {
    const mod = await loadModule();
    const exec = vi.fn<ExecFn>();
    const { ctx } = makeCtx(exec);

    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'Test' },
      requireConfirm: true
    };

    exec.mockResolvedValueOnce(identityOk()).mockResolvedValue({
      stdout: JSON.stringify({ status: 0, result: { records: [] } }),
      stderr: '',
      code: 0
    });

    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await caps.cdcSaveTrigger(trigger);

    // Wait for the initial async poll to complete.
    await vi.advanceTimersByTimeAsync(1);

    // Timer armed; initial poll fired.
    expect(exec).toHaveBeenCalledTimes(2);

    // Now save with enabled=false.
    await caps.cdcSaveTrigger({ ...trigger, enabled: false });

    // Advance time; no more polls should fire.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(exec).toHaveBeenCalledTimes(2); // no new calls
  });

  it('teardown clears all timers', async () => {
    const mod = await loadModule();
    const exec = vi.fn<ExecFn>();
    const { ctx } = makeCtx(exec);

    const trigger: CdcTrigger = {
      id: 'test',
      name: 'Test',
      enabled: true,
      projectId: 'proj1',
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'],
      scope: { assignee: 'me' },
      pollEvery: '1m',
      launch: { personaId: 'p1', promptTemplate: 'Test' },
      requireConfirm: true
    };

    exec.mockResolvedValueOnce(identityOk()).mockResolvedValue({
      stdout: JSON.stringify({ status: 0, result: { records: [] } }),
      stderr: '',
      code: 0
    });

    const caps = (await mod.setup(ctx)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await caps.cdcSaveTrigger(trigger);

    // Wait for the initial async poll to complete.
    await vi.advanceTimersByTimeAsync(1);

    // Timer armed.
    expect(exec).toHaveBeenCalledTimes(2);

    // Call teardown.
    if (mod.teardown) await mod.teardown();

    // Advance time; no more polls should fire.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(exec).toHaveBeenCalledTimes(2); // no new calls after teardown
  });
});
