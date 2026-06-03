/**
 * Local MCP server for project-scoped agent -> user push.
 *
 * Bound to `127.0.0.1:0` (OS picks a free port, captured at boot). The
 * URL path carries identity:
 *
 *   POST /mcp/:projectId   project-scoped surface (inbox_push for now)
 *
 * Each request builds a fresh `McpServer` with the inbox tool whose
 * handler closes over `projectId` parsed from the URL — the agent never
 * sees that id in any tool schema, so forgery is impossible.
 *
 * Modeled after OpenAlice's `src/server/mcp.ts` but stripped of Hono /
 * `@hono/node-server` — Node's built-in `http` listener is sufficient
 * for two routes and avoids dragging another dependency tree into the
 * Electron main bundle.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IInboxStore } from './inbox-store.js';
import type { Project } from '../shared/types.js';
import { registerInboxPushTool } from './inbox-mcp-tool.js';

export interface ProjectLookup {
  /** Return the current project meta or null if unknown. Called per-request. */
  get(projectId: string): Project | null;
}

export interface McpServerOptions {
  inboxStore: IInboxStore;
  projects: ProjectLookup;
  /** Logger used at startup; defaults to console. */
  log?: (msg: string) => void;
}

export interface McpServerHandle {
  /** `http://127.0.0.1:<port>` — callers append `/mcp/:projectId`. */
  url: string;
  /** Bound port. Useful for tests. */
  port: number;
  /** Stop the listener; resolves once it's fully closed. */
  close(): Promise<void>;
}

/**
 * Build a per-request `McpServer` scoped to one projectId. Tools' handlers
 * close over the id from the URL path, never trusting any field the agent
 * supplies. We tolerate a missing project (renderer will tombstone the
 * entry) — the URL is still authoritative for the inbox key.
 */
function buildProjectMcpServer(opts: {
  projectId: string;
  projectLabel?: string;
  inboxStore: IInboxStore;
}): McpServer {
  const mcp = new McpServer({ name: 'cc-inbox', version: '0.1.0' });
  registerInboxPushTool(mcp, opts);
  return mcp;
}

/**
 * Match `/mcp/:projectId` (no trailing slash, no extra segments). Returns
 * the captured projectId or null. Strict by design: anything else 404s.
 */
function matchMcpRoute(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/mcp\/([^/]+)$/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function startMcpServer(opts: McpServerOptions): Promise<McpServerHandle> {
  const log = opts.log ?? ((m) => console.log(m));

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, opts, log);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  log(`[mcp] listening on ${url}/mcp/:projectId`);

  return {
    url,
    port: addr.port,
    async close() {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // closeAllConnections is Node 18.2+; safe to call optionally so
        // dangling SSE streams don't keep the listener alive on quit.
        const anyServer = httpServer as unknown as { closeAllConnections?: () => void };
        anyServer.closeAllConnections?.();
      });
    }
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpServerOptions,
  log: (msg: string) => void
) {
  const projectId = matchMcpRoute(req.url);
  if (!projectId) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
    return;
  }

  // Look up the label at request time — a recently renamed project
  // gets its current label snapshotted into the inbox entry.
  const project = opts.projects.get(projectId);
  const projectLabel = project?.name ?? project?.tag;

  // Stateless mode: per-request transport, no session id retention. A
  // long-lived session would pin the projectId-from-URL identity to the
  // first request and let later requests forge through reuse.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  const mcp = buildProjectMcpServer({
    projectId,
    projectLabel,
    inboxStore: opts.inboxStore
  });

  // Ensure transport + mcp tear down once the response finishes, even on
  // client disconnect. Without this, a flapping client could leak
  // listeners across hot-reloads in dev.
  const cleanup = async () => {
    try {
      await transport.close();
    } catch {
      /* already closing */
    }
    try {
      await mcp.close();
    } catch {
      /* already closed */
    }
  };
  res.on('close', () => {
    void cleanup();
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    log(`[mcp] request failed for ${projectId}: ${message}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('mcp request failed');
    } else {
      try {
        res.end();
      } catch {
        /* socket gone */
      }
    }
    await cleanup();
  }
}
