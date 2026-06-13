/**
 * Per-project `.mcp.json` files written to `~/.cc-center/mcp/<projectId>.json`.
 *
 * We deliberately do NOT touch the user's project directory. Instead, the
 * agent CLI is launched with `--mcp-config <absolute-path>` pointing at one
 * of these launcher-owned files. The `${CC_MCP_URL}` placeholder is left
 * literal — Claude's CLI evaluates it against the env the launcher injects
 * (`pty.ts` sets `CC_MCP_URL` to the live MCP server URL with the project
 * id baked in).
 *
 * Mirrors the OpenAlice pattern (`/tmp/OpenAlice/src/workspaces/context-injector.ts`)
 * but stays out of the project tree because we don't own it.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

const MCP_CONFIG_DIR = join(homedir(), '.cc-center', 'mcp');

/** Pure helper: returns the absolute path of the per-project `.mcp.json`. */
export function mcpConfigPathForProject(projectId: string): string {
  return join(MCP_CONFIG_DIR, `${projectId}.json`);
}

/**
 * Small internal registry of MCP servers personas can reference by name.
 * Unknown names are silently ignored — a persona can request a server that
 * doesn't exist yet, and it simply won't be wired up. The registry is
 * intentionally minimal in v1; future versions may auto-discover from a
 * per-user config or the MCP marketplace.
 */
const MCP_SERVER_REGISTRY: Record<string, { type: string; url?: string; command?: string; args?: string[] }> = {
  // Add known servers here as they become useful for personas. Example:
  // 'filesystem': { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
};

/**
 * `.mcp.json` body. The `${CC_MCP_URL}` placeholder is intentional —
 * Claude's CLI does env-substitution at spawn against the env we inject
 * in `pty.ts` (`CC_MCP_URL=http://127.0.0.1:<port>/mcp/<projectId>`).
 * Additional servers can be merged in via `extraServerNames` (resolved
 * against {@link MCP_SERVER_REGISTRY}).
 */
function configBody(extraServerNames?: string[]): string {
  const servers: Record<string, unknown> = {
    'cc-inbox': {
      type: 'streamable-http',
      url: '${CC_MCP_URL}'
    }
  };
  // Merge extra servers from the registry; unknown names are ignored.
  for (const name of extraServerNames ?? []) {
    const def = MCP_SERVER_REGISTRY[name];
    if (def) {
      servers[name] = def;
    }
  }
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}

/**
 * Write/overwrite the per-project `.mcp.json` atomically (tmp + rename).
 * Idempotent — if the file already exists with the same content, the
 * rename is still a no-op from the filesystem's POV. Safe to call on
 * every boot for every project.
 * @param extraServerNames Optional server names to merge from the registry.
 */
export async function ensureMcpConfigForProject(
  projectId: string,
  extraServerNames?: string[]
): Promise<string> {
  const target = mcpConfigPathForProject(projectId);
  await mkdir(MCP_CONFIG_DIR, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, configBody(extraServerNames), 'utf-8');
  await rename(tmp, target);
  return target;
}

/**
 * Synchronous twin of `ensureMcpConfigForProject`, called from `pty.create`
 * right before a claude spawn passes `--mcp-config <path>` to this file.
 *
 * The async writers (project-add fire-and-forget, boot backfill loop) run
 * *after* `setMcpBaseUrl`, so there's a window where the base URL is known but
 * the file isn't on disk yet — or a prior write silently failed. Launching
 * claude with `--mcp-config` pointing at a missing file means the cc-inbox
 * server never loads. Writing it synchronously at the spawn site closes that
 * race for good: idempotent, cheap, and independent of boot ordering.
 *
 * Best-effort: a failure here must not block the terminal from opening, so the
 * caller treats a thrown error as "skip MCP injection for this spawn".
 * @param extraServerNames Optional server names to merge from the registry.
 */
export function ensureMcpConfigForProjectSync(
  projectId: string,
  extraServerNames?: string[]
): string {
  const target = mcpConfigPathForProject(projectId);
  mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  // Unique per call (not just per pid) so two concurrent spawns for the same
  // project can't race on the same tmp path before their renames land.
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, configBody(extraServerNames), 'utf-8');
  renameSync(tmp, target);
  return target;
}
