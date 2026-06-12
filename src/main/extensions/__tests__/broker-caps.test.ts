import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBrokerCapabilities } from '../broker-caps.js';
import { PermissionBroker, grantFromManifest } from '../permission-broker.js';

let extDir: string;

function brokerFor(grants: Record<string, ReturnType<typeof grantFromManifest>>) {
  const broker = new PermissionBroker({
    builtinIds: new Set(['gus']),
    grants: (id) => grants[id] ?? null
  });
  return createBrokerCapabilities(broker);
}

describe('broker-caps — gated fs', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('reads a file inside a granted root', async () => {
    await mkdir(join(extDir, 'data'), { recursive: true });
    await writeFile(join(extDir, 'data', 'x.txt'), 'hello', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    expect(await caps.readFile('alpha', join(extDir, 'data', 'x.txt'))).toBe('hello');
  });

  it('rejects a read outside any granted root (traversal/escape)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [join(extDir, 'data')] }, extDir)
    });
    await expect(caps.readFile('alpha', '/etc/hosts')).rejects.toThrow(/PermissionDenied/);
    await expect(
      caps.readFile('alpha', join(extDir, 'data', '..', '..', 'escape.txt'))
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a read when fs:read is not granted at all', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.readFile('alpha', join(extDir, 'whatever'))).rejects.toThrow(/PermissionDenied/);
  });

  it('writes inside a granted root but never into a sensitive root', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [extDir] }, extDir)
    });
    await caps.writeFile('alpha', join(extDir, 'out.txt'), 'data');
    // A sensitive root is denied even if a granted root would cover it (home).
    const homeCaps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [resolve(process.env.HOME ?? '/')] }, extDir)
    });
    await expect(
      homeCaps.writeFile('alpha', resolve(process.env.HOME ?? '/', '.ssh', 'evil'), 'x')
    ).rejects.toThrow(/PermissionDenied/);
  });
});

describe('broker-caps — gated process spawn', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('runs an allowlisted bin and returns stdout', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    const res = await caps.exec('alpha', { bin: 'echo', args: ['hi'] });
    expect(res.stdout.trim()).toBe('hi');
    expect(res.code).toBe(0);
  });

  it('rejects a bin not on the allowlist', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: 'ls' })).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects when exec is not granted', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.exec('alpha', { bin: 'echo' })).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a bin given as a path (not a basename)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['echo'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: '/bin/echo' })).rejects.toThrow(/PermissionDenied/);
  });

  // S3: a spawn failure or watchdog timeout must REJECT (distinct from a clean
  // signal exit), so a hung child's kill surfaces as an error not {code:null}.
  it('REJECTS when the bin cannot be spawned (ENOENT), not a {code:null} success', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['definitely-no-such-bin-xyz'] }, extDir)
    });
    await expect(caps.exec('alpha', { bin: 'definitely-no-such-bin-xyz' })).rejects.toThrow(
      /failed to start/
    );
  });

  it('REJECTS when the process is killed by the timeout watchdog', async () => {
    // `sleep 5` with a 50ms timeout → Node kills it → killed:true → reject.
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['sleep'] }, extDir)
    });
    await expect(
      caps.exec('alpha', { bin: 'sleep', args: ['5'], timeoutMs: 50 })
    ).rejects.toThrow(/killed after .*ms/);
  });

  it('still RESOLVES a non-zero exit (ran, exited cleanly with a code)', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['exec'], { execAllowlist: ['sh'] }, extDir)
    });
    const res = await caps.exec('alpha', { bin: 'sh', args: ['-c', 'exit 3'] });
    expect(res.code).toBe(3);
  });
});

// P3-HARDEN: a symlink INSIDE a granted root that points OUTSIDE it (or at a
// sensitive root) must not let a read/write escape — the realpath re-check
// catches it after the lexical scope check passes.
describe('broker-caps — symlink/realpath escape', () => {
  // A SEPARATE temp tree that is NOT inside the ext dir (so it isn't covered by
  // the always-granted ext-dir root) — the symlink target must be truly outside.
  let outsideDir: string;
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'cc-outside-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('rejects a READ through a symlink inside a granted root pointing outside it', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // Secret lives OUTSIDE the ext dir entirely.
    await writeFile(join(outsideDir, 'secret.txt'), 'TOPSECRET', 'utf-8');
    // A symlink inside the granted root → the outside secret.
    const link = join(root, 'link-to-secret');
    await symlink(join(outsideDir, 'secret.txt'), link);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [root] }, extDir)
    });
    // Lexically `root/link-to-secret` is inside the root, but its realpath is
    // outside → must be denied.
    await expect(caps.readFile('alpha', link)).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a WRITE to a new file whose PARENT dir is a symlink escaping the root', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // A symlinked subdir inside the root that points outside the ext dir.
    const linkDir = join(root, 'sub');
    await symlink(outsideDir, linkDir);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [root] }, extDir)
    });
    // Writing root/sub/new.txt resolves the symlinked parent to `outsideDir` →
    // escapes the granted root → denied (even though the leaf doesn't exist yet).
    await expect(
      caps.writeFile('alpha', join(linkDir, 'new.txt'), 'data')
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects a WRITE through a symlink pointing into a sensitive root (~/.ssh)', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    // Symlink inside the granted root → ~/.ssh (a sensitive root).
    const link = join(root, 'ssh-link');
    await symlink(resolve(homedir(), '.ssh'), link);
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:write'], { fsRoots: [root] }, extDir)
    });
    await expect(
      caps.writeFile('alpha', join(link, 'authorized_keys'), 'pwned')
    ).rejects.toThrow(/PermissionDenied/);
  });

  it('still allows a legit read of a real file inside the granted root', async () => {
    const root = join(extDir, 'data');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'ok.txt'), 'fine', 'utf-8');
    const caps = brokerFor({
      alpha: grantFromManifest(['fs:read'], { fsRoots: [root] }, extDir)
    });
    expect(await caps.readFile('alpha', join(root, 'ok.txt'))).toBe('fine');
  });
});

describe('broker-caps — gated fetch', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-brokercaps-'));
  });
  afterEach(async () => {
    await rm(extDir, { recursive: true, force: true });
  });

  it('rejects an off-allowlist host before any network call', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
    });
    await expect(caps.fetch('alpha', 'https://evil.com/x')).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects when net is not granted', async () => {
    const caps = brokerFor({ alpha: grantFromManifest(['storage'], undefined, extDir) });
    await expect(caps.fetch('alpha', 'https://api.example.com/x')).rejects.toThrow(/PermissionDenied/);
  });

  it('rejects an invalid url', async () => {
    const caps = brokerFor({
      alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
    });
    await expect(caps.fetch('alpha', 'not a url')).rejects.toThrow(/invalid url/);
  });

  describe('redirect + body-cap hardening (B1)', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    /** A minimal Response stand-in (status + headers, no body) for redirect tests. */
    function redirectTo(location: string) {
      return new Response(null, { status: 302, headers: { location } });
    }

    it('re-asserts net on a redirect and REJECTS a hop to a non-allowlisted host (SSRF)', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // First (allowlisted) request 302s to the cloud-metadata IP — must be denied.
      globalThis.fetch = (async () =>
        redirectTo('http://169.254.169.254/latest/meta-data/')) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/start')).rejects.toThrow(
        /PermissionDenied/
      );
    });

    it('follows a redirect to ANOTHER allowlisted host', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(
          ['net'],
          { egressAllowlist: ['api.example.com', 'cdn.example.com'] },
          extDir
        )
      });
      let calls = 0;
      globalThis.fetch = (async (input: string) => {
        calls++;
        if (String(input).includes('api.example.com')) {
          return redirectTo('https://cdn.example.com/asset');
        }
        return new Response('ok', { status: 200 });
      }) as typeof fetch;
      const res = await caps.fetch('alpha', 'https://api.example.com/start');
      expect(res.status).toBe(200);
      expect(res.body).toBe('ok');
      expect(calls).toBe(2);
    });

    it('rejects a redirect loop past the hop limit', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // Always 302 back to an allowlisted host → exceeds FETCH_MAX_REDIRECTS.
      globalThis.fetch = (async () =>
        redirectTo('https://api.example.com/again')) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/start')).rejects.toThrow(
        /too many redirects/
      );
    });

    it('caps an oversized response body instead of buffering it whole', async () => {
      const caps = brokerFor({
        alpha: grantFromManifest(['net'], { egressAllowlist: ['api.example.com'] }, extDir)
      });
      // Stream more than the 8MiB cap in chunks.
      const chunk = new Uint8Array(1024 * 1024); // 1 MiB
      globalThis.fetch = (async () => {
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= 16) {
              controller.close();
              return;
            }
            sent++;
            controller.enqueue(chunk);
          }
        });
        return new Response(stream, { status: 200 });
      }) as typeof fetch;
      await expect(caps.fetch('alpha', 'https://api.example.com/big')).rejects.toThrow(
        /exceeds .* bytes/
      );
    });
  });
});
