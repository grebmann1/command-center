/**
 * Unit tests for the host-React holder — the two supply paths and the guard.
 * Each test re-imports the module fresh so the module-level holder is reset.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const GLOBAL_KEY = '__CCTC_HOST_REACT__';

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  vi.resetModules();
});

async function freshModule() {
  vi.resetModules();
  return await import('./host-react.js');
}

describe('host-react holder', () => {
  it('throws a clear error when React was supplied by neither path', async () => {
    const { getHostReact } = await freshModule();
    expect(() => getHostReact()).toThrow(/host React unavailable/i);
  });

  it('resolves React set via setHostReact (the activate path)', async () => {
    const { getHostReact, setHostReact } = await freshModule();
    const fake = { tag: 'react' } as unknown as typeof import('react');
    setHostReact(fake);
    expect(getHostReact()).toBe(fake);
  });

  it('resolves React from the host global (the module-eval path, before activate)', async () => {
    const fake = { tag: 'global-react' } as unknown as typeof import('react');
    // Host loader assigns this before importing the bundle — i.e. before any
    // module-eval-time React API (lucide forwardRef) runs.
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = fake;
    const { getHostReact } = await freshModule();
    expect(getHostReact()).toBe(fake);
  });

  it('prefers an explicitly-set React over the global', async () => {
    const fromGlobal = { tag: 'global' } as unknown as typeof import('react');
    const fromActivate = { tag: 'activate' } as unknown as typeof import('react');
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = fromGlobal;
    const { getHostReact, setHostReact } = await freshModule();
    setHostReact(fromActivate);
    expect(getHostReact()).toBe(fromActivate);
  });
});
