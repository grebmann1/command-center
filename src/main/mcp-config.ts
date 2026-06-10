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
 * `.mcp.json` body. The `${CC_MCP_URL}` placeholder is intentional —
 * Claude's CLI does env-substitution at spawn against the env we inject
 * in `pty.ts` (`CC_MCP_URL=http://127.0.0.1:<port>/mcp/<projectId>`).
 */
function configBody(): string {
  return JSON.stringify(
    {
      mcpServers: {
        'cc-inbox': {
          type: 'streamable-http',
          url: '${CC_MCP_URL}'
        }
      }
    },
    null,
    2
  ) + '\n';
}

/**
 * Write/overwrite the per-project `.mcp.json` atomically (tmp + rename).
 * Idempotent — if the file already exists with the same content, the
 * rename is still a no-op from the filesystem's POV. Safe to call on
 * every boot for every project.
 */
export async function ensureMcpConfigForProject(projectId: string): Promise<string> {
  const target = mcpConfigPathForProject(projectId);
  await mkdir(MCP_CONFIG_DIR, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, configBody(), 'utf-8');
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
 */
export function ensureMcpConfigForProjectSync(projectId: string): string {
  const target = mcpConfigPathForProject(projectId);
  mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  // Unique per call (not just per pid) so two concurrent spawns for the same
  // project can't race on the same tmp path before their renames land.
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, configBody(), 'utf-8');
  renameSync(tmp, target);
  return target;
}
