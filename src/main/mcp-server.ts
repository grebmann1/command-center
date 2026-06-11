/**
 * Local MCP server for project-scoped agent -> user push.
 *
 * Bound to `127.0.0.1:0` (OS picks a free port, captured at boot). The
 * URL path carries identity:
 *
 *   POST /mcp/:projectId               project-scoped surface
 *   POST /mcp/:projectId/:sessionId    session-scoped surface (preferred)
 *
 * Each request builds a fresh `McpServer` with the inbox tool whose
 * handler closes over `projectId` (and `sessionId` when present) parsed
 * from the URL — the agent never sees those ids in any tool schema, so
 * forgery is impossible. The session-scoped form lets `inbox_push` stamp
 * the originating terminal onto the entry so the inbox UI can route the
 * "Open" click back to that exact tab.
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
import { registerScheduleReportTool } from './schedule-report-mcp-tool.js';

export interface ProjectLookup {
  /** Return the current project meta or null if unknown. Called per-request. */
  get(projectId: string): Project | null;
}

export interface McpServerOptions {
  inboxStore: IInboxStore;
  projects: ProjectLookup;
  /** Logger used at startup; defaults to console. */
  log?: (msg: string) => void;
  /**
   * Called when a spawned session's Stop hook pings back (auto-close on
   * finish). The url path carries identity: `/hook/stop/:projectId/:sessionId`.
   * Implementations close the matching terminal. Best-effort — the route
   * always 200s so the hook stays fire-and-forget.
   */
  onStopHook?: (projectId: string, sessionId: string) => void;
  /**
   * Called when a session's Notification / UserPromptSubmit hook pings back.
   * `action` is `blocked` (agent is waiting on the user — permission prompt or
   * interactive question) or `unblocked` (user answered / turn ended). Drives
   * the live "blocked — needs you" agent status. The url path carries identity:
   * `/hook/notify/:projectId/:sessionId/:action`. Best-effort; always 200s.
   */
  onNotifyHook?: (projectId: string, sessionId: string, action: 'blocked' | 'unblocked') => void;
  /**
   * Called when a scheduled agent files a run report via the `schedule_report`
   * tool. The url path carries identity (`/mcp/:projectId/:sessionId`), so the
   * summary is attributable to an exact session — the scheduler attaches it to
   * the matching run. Best-effort; the tool returns success regardless.
   */
  onReport?: (
    projectId: string,
    sessionId: string,
    summary: string,
    status?: 'success' | 'partial' | 'failure'
  ) => void;
  /**
   * Resolve whether a session is a scheduled (background) run. Used to stamp
   * `scheduled` on `inbox_push` entries so the sidebar can group recurring
   * jobs. Returns false when the session is unknown / not scheduled.
   */
  isSessionScheduled?: (sessionId: string) => boolean;
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
  sessionId?: string;
  inboxStore: IInboxStore;
  onReport?: McpServerOptions['onReport'];
  isSessionScheduled?: McpServerOptions['isSessionScheduled'];
}): McpServer {
  const mcp = new McpServer({ name: 'cc-inbox', version: '0.1.0' });
  // Resolve scheduled-ness once at build time so inbox_push entries from a
  // background run carry the flag for sidebar grouping.
  const scheduled = !!(opts.sessionId && opts.isSessionScheduled?.(opts.sessionId));
  registerInboxPushTool(mcp, { ...opts, scheduled });
  // schedule_report attaches an agent-authored summary to the originating
  // scheduled run. It needs a session to attach to, so we only register it on
  // the session-scoped route — otherwise the agent would see a tool in its
  // list that can only ever fail. Bind projectId into the callback so the
  // tool's handler only needs the (sessionId, summary, status) shape.
  if (opts.sessionId) {
    registerScheduleReportTool(mcp, {
      sessionId: opts.sessionId,
      onReport: opts.onReport
        ? (sessionId, summary, status) => opts.onReport!(opts.projectId, sessionId, summary, status)
        : undefined
    });
  }
  return mcp;
}

/**
 * Match `/mcp/:projectId` or `/mcp/:projectId/:sessionId`. Strict: any
 * other shape 404s. Returns null when no match. Exported for unit tests.
 */
export function matchMcpRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId?: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/mcp\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!m) return null;
  return {
    projectId: decodeURIComponent(m[1]),
    sessionId: m[2] ? decodeURIComponent(m[2]) : undefined
  };
}

/**
 * Match `/hook/stop/:projectId/:sessionId` — the auto-close Stop-hook
 * callback. Both ids are required (we always close a specific session).
 * Exported for unit tests.
 */
export function matchStopHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/stop\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return {
    projectId: decodeURIComponent(m[1]),
    sessionId: decodeURIComponent(m[2])
  };
}

/**
 * Match `/hook/notify/:projectId/:sessionId/:action` where action is
 * `blocked` or `unblocked` — the live-status callback. Exported for unit tests.
 */
export function matchNotifyHookRoute(
  rawUrl: string | undefined
): { projectId: string; sessionId: string; action: 'blocked' | 'unblocked' } | null {
  if (!rawUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const m = /^\/hook\/notify\/([^/]+)\/([^/]+)\/(blocked|unblocked)$/.exec(pathname);
  if (!m) return null;
  return {
    projectId: decodeURIComponent(m[1]),
    sessionId: decodeURIComponent(m[2]),
    action: m[3] as 'blocked' | 'unblocked'
  };
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
  // Stop-hook callback (auto-close). Fire-and-forget: drain the body, invoke
  // the handler, and always 200 so the agent's hook never blocks on us.
  const stopRoute = matchStopHookRoute(req.url);
  if (stopRoute) {
    req.resume(); // drain any POST body so the socket can close cleanly
    try {
      opts.onStopHook?.(stopRoute.projectId, stopRoute.sessionId);
    } catch (err) {
      log(`[mcp] stop-hook handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  // Notification / UserPromptSubmit callback. Fire-and-forget, same contract
  // as the stop-hook route: drain the body, invoke the handler, always 200.
  const notifyRoute = matchNotifyHookRoute(req.url);
  if (notifyRoute) {
    req.resume();
    try {
      opts.onNotifyHook?.(notifyRoute.projectId, notifyRoute.sessionId, notifyRoute.action);
    } catch (err) {
      log(`[mcp] notify-hook handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  const route = matchMcpRoute(req.url);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
    return;
  }
  const { projectId, sessionId } = route;

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
    sessionId,
    inboxStore: opts.inboxStore,
    onReport: opts.onReport,
    isSessionScheduled: opts.isSessionScheduled
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
