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
import { mkdir, writeFile, rename } from 'node:fs/promises';

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
