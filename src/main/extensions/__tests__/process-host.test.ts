import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExtensionProcessHost,
  type ChildEndpoint,
  type HostStorage,
  type BrokerCapabilities
} from '../process-host.js';
import { ModuleRouter } from '../module-router.js';
import type { ChildToHost, HostToChild } from '../host-protocol.js';

/**
 * A mock child endpoint that lets a test drive the child side of the protocol:
 * it captures host→child messages and can inject child→host messages. No real
 * utilityProcess — this exercises the host's RPC routing, timeout, teardown, and
 * crash-isolation logic, which is the unit-testable surface of P3-A.
 */
class MockEndpoint implements ChildEndpoint {
  sent: HostToChild[] = [];
  private msgListener?: (m: ChildToHost) => void;
  private exitListener?: (code: number | null) => void;
  killed = false;

  postMessage(msg: HostToChild): void {
    this.sent.push(msg);
  }
  onMessage(listener: (m: ChildToHost) => void): void {
    this.msgListener = listener;
  }
  onExit(listener: (code: number | null) => void): void {
    this.exitListener = listener;
  }
  kill(): void {
    this.killed = true;
  }

  // ---- test drivers (the "child") ----
  emit(msg: ChildToHost): void {
    this.msgListener?.(msg);
  }
  crash(code: number | null = 1): void {
    this.exitListener?.(code);
  }
  /** The last `call` the host sent, for replying by callId. */
  lastCall(): Extract<HostToChild, { type: 'call' }> {
    const call = [...this.sent].reverse().find((m) => m.type === 'call');
    if (!call) throw new Error('no call sent');
    return call as Extract<HostToChild, { type: 'call' }>;
  }
}

function makeHost(opts?: {
  storage?: HostStorage;
  caps?: BrokerCapabilities;
  callTimeoutMs?: number;
  teardownTimeoutMs?: number;
  setupTimeoutMs?: number;
}) {
  const endpoints = new Map<string, MockEndpoint>();
  const storage: HostStorage =
    opts?.storage ??
    (() => {
      const data = new Map<string, unknown>();
      return {
        get: (id, key) => data.get(`${id}:${key}`),
        set: (id, key, value) => data.set(`${id}:${key}`, value)
      };
    })();
  const host = new ExtensionProcessHost({
    spawn: (_entry, moduleId) => {
      const ep = new MockEndpoint();
      endpoints.set(moduleId, ep);
      return ep;
    },
    storage,
    caps: opts?.caps,
    log: () => {},
    callTimeoutMs: opts?.callTimeoutMs ?? 1000,
    teardownTimeoutMs: opts?.teardownTimeoutMs ?? 50,
    setupTimeoutMs: opts?.setupTimeoutMs ?? 1000
  });
  return { host, endpoints, storage };
}

/** Spawn + report ready in one helper. Returns the mock endpoint. */
async function spawnReady(host: ExtensionProcessHost, endpoints: Map<string, MockEndpoint>, id: string) {
  const p = host.spawn({ moduleId: id, entryPath: `/x/${id}/main.js` });
  const ep = endpoints.get(id)!;
  ep.emit({ type: 'ready', moduleId: id, capabilities: ['ping'] });
  expect(await p).toBe(true);
  return ep;
}

describe('ExtensionProcessHost', () => {
  beforeEach(() => vi.useRealTimers());

  it('spawn sends init then resolves true on ready; lists the id as live', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    expect(ep.sent[0]).toEqual({ type: 'init', entryPath: '/x/alpha/main.js', moduleId: 'alpha' });
    expect(host.has('alpha')).toBe(true);
    expect([...host.liveModuleIds()]).toEqual(['alpha']);
  });

  it('spawn resolves false on setup-error and drops the child (not live, killed)', async () => {
    const { host, endpoints } = makeHost();
    const p = host.spawn({ moduleId: 'bad', entryPath: '/x/bad/main.js' });
    const ep = endpoints.get('bad')!;
    ep.emit({ type: 'setup-error', moduleId: 'bad', error: 'boom' });
    expect(await p).toBe(false);
    expect(ep.killed).toBe(true);
    expect(host.has('bad')).toBe(false);
    expect([...host.liveModuleIds()]).toEqual([]);
  });

  it('spawn resolves false when the spawn factory throws (boot isolation)', async () => {
    const host = new ExtensionProcessHost({
      spawn: () => {
        throw new Error('fork failed');
      },
      storage: { get: () => undefined, set: () => {} },
      log: () => {}
    });
    expect(await host.spawn({ moduleId: 'z', entryPath: '/x' })).toBe(false);
    expect(host.has('z')).toBe(false);
  });

  it('dispatch round-trips a call → result by callId', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const callP = host.dispatch('alpha', 'ping', [1, 2]);
    const call = ep.lastCall();
    expect(call).toMatchObject({ type: 'call', capability: 'ping', args: [1, 2] });
    ep.emit({ type: 'result', callId: call.callId, ok: true, result: 'pong' });
    expect(await callP).toBe('pong');
  });

  it('dispatch rejects with the child error on ok:false', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const callP = host.dispatch('alpha', 'ping', []);
    const call = ep.lastCall();
    ep.emit({ type: 'result', callId: call.callId, ok: false, error: 'capability blew up' });
    await expect(callP).rejects.toThrow('capability blew up');
  });

  it('dispatch rejects unknown / not-ready modules', async () => {
    const { host, endpoints } = makeHost();
    await expect(host.dispatch('nope', 'x', [])).rejects.toThrow('Unknown module: nope');
    // Spawned but not ready yet → "not ready".
    host.spawn({ moduleId: 'pending', entryPath: '/x' });
    await expect(host.dispatch('pending', 'x', [])).rejects.toThrow('Module not ready');
    endpoints.get('pending')!.emit({ type: 'ready', moduleId: 'pending', capabilities: [] });
  });

  it('dispatch rejects on timeout without wedging (fake timers)', async () => {
    vi.useFakeTimers();
    const { host, endpoints } = makeHost({ callTimeoutMs: 100 });
    const p = host.spawn({ moduleId: 'slow', entryPath: '/x' });
    endpoints.get('slow')!.emit({ type: 'ready', moduleId: 'slow', capabilities: [] });
    await p;
    const callP = host.dispatch('slow', 'hang', []);
    const assertion = expect(callP).rejects.toThrow('Capability timed out: slow.hang');
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    vi.useRealTimers();
  });

  it('a child crash rejects every in-flight call and isolates the module', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const a = host.dispatch('alpha', 'one', []);
    const b = host.dispatch('alpha', 'two', []);
    ep.crash(139);
    await expect(a).rejects.toThrow('Extension alpha exited (code 139)');
    await expect(b).rejects.toThrow('exited (code 139)');
    // No longer live, but the crash is recorded so a later dispatch gives a
    // clear message (router keeps routing it here, not "Unknown module").
    expect([...host.liveModuleIds()]).not.toContain('alpha');
    expect(host.has('alpha')).toBe(true);
    await expect(host.dispatch('alpha', 'ping', [])).rejects.toThrow(
      'Extension alpha crashed — relaunch to retry'
    );
    // A fresh spawn clears the crash record.
    const ep2 = await spawnReady(host, endpoints, 'alpha');
    const reP = host.dispatch('alpha', 'ping', []);
    ep2.emit({ type: 'result', callId: ep2.lastCall().callId, ok: true, result: 'back' });
    expect(await reP).toBe('back');
    // Sibling unaffected: a second extension still dispatches fine.
    const epb = await spawnReady(host, endpoints, 'beta');
    const cP = host.dispatch('beta', 'ping', []);
    epb.emit({ type: 'result', callId: epb.lastCall().callId, ok: true, result: 'ok' });
    expect(await cP).toBe('ok');
  });

  it('teardown sends a teardown RPC then kills, and drops the module', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const tdP = host.teardown('alpha');
    const td = ep.sent.find((m) => m.type === 'teardown') as Extract<HostToChild, { type: 'teardown' }>;
    expect(td).toBeTruthy();
    ep.emit({ type: 'result', callId: td.callId, ok: true });
    await tdP;
    expect(ep.killed).toBe(true);
    expect(host.has('alpha')).toBe(false);
  });

  it('broker storage.get/set is keyed by the AUTHENTICATED id, ignoring any payload id', async () => {
    const data = new Map<string, unknown>();
    const storage: HostStorage = {
      get: (id, key) => data.get(`${id}:${key}`),
      set: (id, key, value) => data.set(`${id}:${key}`, value)
    };
    const { host, endpoints } = makeHost({ storage });
    const ep = await spawnReady(host, endpoints, 'alpha');

    // Child sets a key — host stores it under 'alpha' (the bound id).
    ep.emit({ type: 'broker', reqId: 1, method: 'storage.set', args: ['k', 'v'] });
    expect(data.get('alpha:k')).toBe('v');
    const setReply = ep.sent.find(
      (m) => m.type === 'broker-result'
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(setReply).toMatchObject({ type: 'broker-result', reqId: 1, ok: true });

    // Child reads it back — host serves from 'alpha' namespace.
    ep.emit({ type: 'broker', reqId: 2, method: 'storage.get', args: ['k'] });
    const getReply = ep.sent
      .filter((m) => m.type === 'broker-result')
      .find((m) => (m as { reqId: number }).reqId === 2) as Extract<
      HostToChild,
      { type: 'broker-result' }
    >;
    expect(getReply).toMatchObject({ ok: true, result: 'v' });
    // Nothing was ever written to a sibling namespace.
    expect(data.has('beta:k')).toBe(false);
  });
});

describe('ModuleRouter (built-in vs child routing)', () => {
  function fakeBuiltins() {
    const live = new Set<string>(['gus', 'zana']);
    return {
      dispatch: vi.fn(async (id: string) => `builtin:${id}`),
      storageGet: vi.fn((id: string, key: string) => `bg:${id}:${key}`),
      storageSet: vi.fn(),
      liveModuleIds: vi.fn(() => new Set(live)),
      teardown: vi.fn(async () => {})
    };
  }

  it('routes a disk-ext id to the process host and a built-in id in-process', async () => {
    const { host, endpoints } = makeHost();
    await spawnReady(host, endpoints, 'diskext');
    const builtins = fakeBuiltins();
    const router = new ModuleRouter(builtins, host);

    // Built-in id → in-process host.
    expect(await router.dispatch('gus', 'cap', [])).toBe('builtin:gus');
    expect(builtins.dispatch).toHaveBeenCalledWith('gus', 'cap', []);

    // Disk-ext id → child RPC.
    const dP = router.dispatch('diskext', 'ping', []);
    const ep = endpoints.get('diskext')!;
    ep.emit({ type: 'result', callId: ep.lastCall().callId, ok: true, result: 'child!' });
    expect(await dP).toBe('child!');
    // Built-in host was NOT consulted for the disk-ext call.
    expect(builtins.dispatch).toHaveBeenCalledTimes(1);
  });

  it('liveModuleIds unions both hosts; teardown routes to the owner', async () => {
    const { host, endpoints } = makeHost();
    await spawnReady(host, endpoints, 'diskext');
    const builtins = fakeBuiltins();
    const router = new ModuleRouter(builtins, host);

    expect([...router.liveModuleIds()].sort()).toEqual(['diskext', 'gus', 'zana']);

    await router.teardown('diskext');
    expect(host.has('diskext')).toBe(false);
    expect(builtins.teardown).not.toHaveBeenCalled();

    await router.teardown('gus');
    expect(builtins.teardown).toHaveBeenCalledWith('gus');
  });
});

describe('ExtensionProcessHost — brokered caps routing (P3-B)', () => {
  it('routes a broker exec request to caps with the AUTHENTICATED id, replies ok', async () => {
    const calls: Array<{ id: string; bin: string }> = [];
    const caps: BrokerCapabilities = {
      exec: async (id, req) => {
        calls.push({ id, bin: req.bin });
        return { stdout: 'out', stderr: '', code: 0 };
      },
      readFile: async () => '',
      writeFile: async () => {},
      readdir: async () => [],
      fetch: async () => ({ status: 200, ok: true, headers: {}, body: '' })
    };
    const { host, endpoints } = makeHost({ caps });
    const ep = await spawnReady(host, endpoints, 'alpha');
    // Child posts a broker exec; the host gates+performs and replies broker-result.
    ep.emit({ type: 'broker', reqId: 7, method: 'exec', args: [{ bin: 'sf', args: ['--version'] }] });
    await new Promise((r) => setTimeout(r, 0)); // let the async op settle
    // The performer saw the bound id 'alpha', never a payload-supplied id.
    expect(calls).toEqual([{ id: 'alpha', bin: 'sf' }]);
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 7
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply).toMatchObject({ ok: true, result: { stdout: 'out', code: 0 } });
  });

  it('a caps throw (PermissionDenied) comes back as ok:false', async () => {
    const caps: BrokerCapabilities = {
      exec: async () => {
        throw new Error('PermissionDenied: alpha lacks "exec" (bin=rm)');
      },
      readFile: async () => '',
      writeFile: async () => {},
      readdir: async () => [],
      fetch: async () => ({ status: 200, ok: true, headers: {}, body: '' })
    };
    const { host, endpoints } = makeHost({ caps });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 9, method: 'exec', args: [{ bin: 'rm' }] });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 9
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/PermissionDenied/);
  });

  it('a broker cap request with no caps performer is denied', async () => {
    const { host, endpoints } = makeHost(); // no caps
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 3, method: 'fs.readFile', args: ['/x'] });
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 3
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/PermissionDenied|unavailable/);
  });
});
