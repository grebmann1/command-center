import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  PermissionBroker,
  PermissionDenied,
  grantFromManifest,
  type GrantProvider
} from '../permission-broker.js';

const EXT_DIR = join(tmpdir(), 'cc-ext-perm', 'alpha');

function brokerWith(provider: GrantProvider, builtins: string[] = ['gus', 'zana']) {
  const audit = vi.fn();
  const broker = new PermissionBroker({
    builtinIds: new Set(builtins),
    grants: provider,
    audit
  });
  return { broker, audit };
}

/** A disk ext that declares process-spawn(sf,git) + fs:read/write + net(api.x). */
function alphaGrant() {
  return grantFromManifest(
    ['exec', 'fs:read', 'fs:write', 'net'],
    {
      execAllowlist: ['sf', 'git'],
      fsRoots: [join(EXT_DIR, 'data')],
      egressAllowlist: ['api.example.com']
    },
    EXT_DIR
  );
}

describe('PermissionBroker — deny-by-default', () => {
  it('built-ins are always allowed and bypass the grant provider', () => {
    const provider = vi.fn(() => null);
    const { broker } = brokerWith(provider);
    expect(broker.can('gus', 'exec', { kind: 'exec', bin: 'rm' })).toBe(true);
    expect(broker.isBuiltin('gus')).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it('an unknown disk ext (no grant) is denied everything', () => {
    const { broker } = brokerWith(() => null);
    expect(broker.can('ghost', 'storage')).toBe(false);
    expect(broker.can('ghost', 'inbox:push')).toBe(false);
  });

  it('a declared permission is allowed; an undeclared one is denied', () => {
    const grant = grantFromManifest(['inbox:push'], undefined, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    expect(broker.can('alpha', 'inbox:push')).toBe(true);
    expect(broker.can('alpha', 'session:launch')).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(false);
  });

  it('process-spawn is gated by the bin allowlist; a path/shell bin is rejected', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'git' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'rm' })).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '/bin/sf' })).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '../sf' })).toBe(false);
  });

  it('fs is scoped to granted roots + the ext dir; traversal is rejected', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'data', 'x.json') })).toBe(true);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'bundle.js') })).toBe(true);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: '/etc/passwd' })).toBe(false);
    expect(
      broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'data', '..', '..', 'evil') })
    ).toBe(false);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: 'data/x.json' })).toBe(false);
  });

  it('fs:write never touches a sensitive root even if a granted root would cover it', () => {
    const grant = grantFromManifest(['fs:read', 'fs:write'], { fsRoots: [homedir()] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    const sshKey = resolve(homedir(), '.ssh', 'id_rsa');
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: sshKey })).toBe(true);
    expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: sshKey })).toBe(false);
    const ccFile = resolve(homedir(), '.cc-center', 'config.json');
    expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: ccFile })).toBe(false);
  });

  it('net is gated by the egress host allowlist (case-insensitive)', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'api.example.com' })).toBe(true);
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'API.EXAMPLE.COM' })).toBe(true);
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'evil.com' })).toBe(false);
  });

  it('assert throws PermissionDenied on a denied check and audits both outcomes', () => {
    const { broker, audit } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    broker.assert('alpha', 'exec', { kind: 'exec', bin: 'sf' });
    expect(() => broker.assert('alpha', 'exec', { kind: 'exec', bin: 'rm' })).toThrow(PermissionDenied);
    const outcomes = audit.mock.calls.map((c) => c[0].allow);
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });
});

describe('grantFromManifest — P3-D seam shape', () => {
  it('granted == declared today; the ext dir is always an fs root', () => {
    const grant = grantFromManifest(['storage', 'net'], { egressAllowlist: ['A.com'] }, EXT_DIR);
    expect(grant.permissions.has('storage')).toBe(true);
    expect(grant.permissions.has('net')).toBe(true);
    expect(grant.permissions.has('exec')).toBe(false);
    expect(grant.fsRoots).toContain(resolve(EXT_DIR));
    expect([...grant.egressAllowlist]).toEqual(['a.com']);
  });

  it('expands a ~-prefixed fsRoot to the home dir', () => {
    const grant = grantFromManifest(['fs:read'], { fsRoots: ['~/work'] }, EXT_DIR);
    expect(grant.fsRoots).toContain(resolve(homedir(), 'work'));
  });
});
