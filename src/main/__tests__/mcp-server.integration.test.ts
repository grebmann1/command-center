/**
 * End-to-end integration tests for the inbox MCP server.
 *
 * Unlike mcp-server.test.ts (which unit-tests the route matcher), these
 * boot the *real* http listener via startMcpServer() and drive it with a
 * genuine MCP client over StreamableHTTP — the same transport Claude's CLI
 * uses. We assert the full path: client.callTool('inbox_push') -> the entry
 * lands in the store with the projectId/sessionId taken from the URL, never
 * from anything the client supplies.
 *
 * Covers three concerns the user asked about:
 *   1. It works     — a real push round-trips and persists.
 *   2. It's safe    — projectId/sessionId come from the URL, not the agent;
 *                     a different project's server can't write your inbox.
 *   3. It recovers  — a tool error doesn't kill the server; a client
 *                     disconnect mid-stream doesn't leak or wedge it;
 *                     close() shuts the listener.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from '../mcp-server.js';
import { createMemoryInboxStore, type IInboxStore } from '../inbox-store.js';
import type { Project } from '../../shared/types.js';

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}`, createdAt: 0, lastActiveAt: 0 };
}

/** Connect a real MCP client to `${baseUrl}/mcp/<path>`. */
async function connectClient(baseUrl: string, path: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${path}`));
  await client.connect(transport);
  return client;
}

describe('inbox MCP server (end-to-end)', () => {
  let handle: McpServerHandle | null = null;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  async function boot(
    store: IInboxStore,
    projects: Project[],
    onReport?: (
      projectId: string,
      sessionId: string,
      summary: string,
      status?: 'success' | 'partial' | 'failure'
    ) => void
  ) {
    const map = new Map(projects.map((p) => [p.id, p]));
    handle = await startMcpServer({
      inboxStore: store,
      projects: { get: (id) => map.get(id) ?? null },
      onReport,
      log: () => {} // keep test output quiet
    });
    return handle;
  }

  it('1. works: a session-scoped inbox_push persists with the URL identity', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // The tool schema only exposes { docs, comments } — no projectId/sessionId.
    const tools = await client.listTools();
    const push = tools.tools.find((t) => t.name === 'inbox_push');
    expect(push, 'inbox_push tool is registered').toBeTruthy();
    const props = (push!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['comments', 'docs']);

    const res = await client.callTool({
      name: 'inbox_push',
      arguments: { comments: 'analysis complete' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].comments).toBe('analysis complete');
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].projectLabel).toBe('My Project');
    // The decisive assertion: sessionId came from the URL path.
    expect(entries[0].sessionId).toBe('sess-A');
  });

  it('1b. works: the legacy project-scoped route persists with no sessionId', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'legacy push' } });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].sessionId).toBeUndefined();
  });

  it('2. safe: the agent cannot forge projectId/sessionId — only the URL counts', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // Try to smuggle a different project/session through the arguments.
    await client.callTool({
      name: 'inbox_push',
      arguments: {
        comments: 'forgery attempt',
        // These are NOT in the schema; sent raw on the wire.
        projectId: 'proj-2',
        sessionId: 'sess-EVIL'
      }
    });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    // URL wins; the smuggled values are ignored entirely. This is
    // defense-in-depth: the SDK's zod schema strips the unknown
    // projectId/sessionId keys before the handler runs, AND the handler
    // closes over the URL identity rather than reading from args. Either
    // layer alone blocks the forgery; both are present.
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].sessionId).toBe('sess-A');
    expect(entries[0].comments).toBe('forgery attempt'); // the legit field still landed
  });

  it('2b. safe: an unknown project still keys the URL projectId (renderer tombstones it)', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, []); // no projects registered

    const client = await connectClient(h.url, 'ghost-proj/sess-X');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'orphan' } });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe('ghost-proj');
    expect(entries[0].projectLabel).toBeUndefined(); // no live label to snapshot
    expect(entries[0].sessionId).toBe('sess-X');
  });

  it('3. recovers: a tool-level error is reported but does NOT kill the server', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);

    // First call: invalid input (neither docs nor comments) -> store throws,
    // tool returns isError, server stays up.
    const c1 = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(c1);
    const bad = await c1.callTool({ name: 'inbox_push', arguments: {} });
    expect((bad as { isError?: boolean }).isError).toBe(true);
    const errText = JSON.stringify((bad as { content?: unknown }).content ?? '');
    expect(errText).toMatch(/at least one of docs or comments/);

    // Second call on a FRESH connection: the listener survived the error
    // and still serves a valid push.
    const c2 = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(c2);
    const ok = await c2.callTool({ name: 'inbox_push', arguments: { comments: 'after error' } });
    expect((ok as { isError?: boolean }).isError).toBeFalsy();

    const { entries } = await store.read();
    expect(entries).toHaveLength(1); // only the valid one persisted
    expect(entries[0].comments).toBe('after error');
  });

  it('3b. recovers: an abrupt client close mid-session does not wedge the server', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]);

    // Open, push, then hard-close the transport (simulates the agent's tab
    // being killed). The per-request cleanup should fire without throwing.
    const c1 = await connectClient(h.url, 'proj-1/sess-A');
    await c1.callTool({ name: 'inbox_push', arguments: { comments: 'first' } });
    await c1.close(); // abrupt teardown

    // A brand-new client connects and works — proves no leaked state pins
    // the listener or the projectId identity from the previous connection.
    const c2 = await connectClient(h.url, 'proj-2/sess-B');
    clients.push(c2);
    await c2.callTool({ name: 'inbox_push', arguments: { comments: 'second' } });

    const { entries } = await store.read();
    expect(entries.map((e) => e.comments).sort()).toEqual(['first', 'second']);
    const second = entries.find((e) => e.comments === 'second')!;
    expect(second.projectId).toBe('proj-2'); // NOT proj-1 — no identity bleed
    expect(second.sessionId).toBe('sess-B');
  });

  it('3c. recovers: close() shuts the listener so the port stops accepting', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const url = h.url;

    const c1 = await connectClient(url, 'proj-1/sess-A');
    await c1.callTool({ name: 'inbox_push', arguments: { comments: 'before close' } });
    await c1.close();

    await h.close();
    handle = null; // afterEach must not double-close

    // A fresh connection to the now-closed port must fail to connect.
    await expect(connectClient(url, 'proj-1/sess-A')).rejects.toThrow();
  });

  it('4. schedule_report: fires onReport with the URL sessionId, schema hides ids', async () => {
    const store = createMemoryInboxStore();
    const calls: Array<{ projectId: string; sessionId: string; summary: string; status?: string }> = [];
    const h = await boot(store, [makeProject('proj-1', 'P1')], (projectId, sessionId, summary, status) =>
      calls.push({ projectId, sessionId, summary, status })
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // The tool schema only exposes { summary, status } — no projectId/sessionId.
    const tools = await client.listTools();
    const report = tools.tools.find((t) => t.name === 'schedule_report');
    expect(report, 'schedule_report tool is registered').toBeTruthy();
    const props = (report!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['status', 'summary']);

    const res = await client.callTool({
      name: 'schedule_report',
      arguments: { summary: 'did the thing', status: 'success' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    expect(calls).toHaveLength(1);
    expect(calls[0].summary).toBe('did the thing');
    expect(calls[0].status).toBe('success');
    // Decisive: identity comes from the URL, not the agent.
    expect(calls[0].projectId).toBe('proj-1');
    expect(calls[0].sessionId).toBe('sess-A');
  });

  it('4b. schedule_report is NOT registered on the legacy project-scoped route', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')], () => {});

    // No sessionId in the URL → nothing to attach to, so the tool isn't
    // offered at all (rather than offered-but-always-failing).
    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'schedule_report')).toBeFalsy();
    // inbox_push is still available on this route.
    expect(tools.tools.find((t) => t.name === 'inbox_push')).toBeTruthy();
  });
});
