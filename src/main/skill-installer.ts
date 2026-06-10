/**
 * Install the bundled `cc-center` Claude Code skill into `~/.claude/skills/`.
 *
 * The app ships `resources/cc-center-skill.md` — a SKILL.md that teaches an
 * agent how to author schedules and templates as JSON in `.cc-center`. The
 * skill catalogue is read-only (it lists `~/.claude/skills/`, never writes),
 * so to make our skill *available* we deploy it on boot, the same way
 * `ensureMcpConfigForProject` deploys the per-project `.mcp.json`.
 *
 * Install target: `~/.claude/skills/cc-center/SKILL.md`.
 *
 * Idempotent + edit-respecting: we only (re)write when the on-disk content
 * differs from what we ship. That means
 *   - first boot installs it,
 *   - a shipped-content bump (new app version) propagates,
 *   - but we don't rewrite an identical file on every boot (no churn, and the
 *     skills watcher doesn't fire needlessly).
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_DIR = join(homedir(), '.claude', 'skills', 'cc-center');
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md');

/**
 * Resolve the shipped SKILL.md. In dev, electron-vite runs from the repo root
 * with `__dirname = out/main`, so the source is `../../resources`. Once
 * packaged, electron-builder copies it next to app.asar via `extraResources`,
 * surfaced as `process.resourcesPath`. Mirrors `resolveIconPath` in index.ts.
 */
function resolveShippedSkillPath(): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'cc-center-skill.md') : null,
    join(__dirname, '../../resources/cc-center-skill.md')
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Deploy the bundled skill if needed. Best-effort: never throws — a failure
 * here must not block app boot (a read-only home dir, missing resource, etc.).
 * Returns the install path on success, or null if nothing was installed.
 */
export async function installCcCenterSkill(
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  try {
    const src = resolveShippedSkillPath();
    if (!src) {
      log?.('installCcCenterSkill', new Error('shipped cc-center-skill.md not found'));
      return null;
    }
    const shipped = await readFile(src, 'utf-8');

    // Skip the write when the file already matches what we ship — avoids churn
    // and keeps any in-session user edits until the shipped content changes.
    let current: string | null = null;
    try {
      current = await readFile(SKILL_FILE, 'utf-8');
    } catch {
      current = null; // not installed yet
    }
    if (current === shipped) return SKILL_FILE;

    await mkdir(SKILL_DIR, { recursive: true });
    const tmp = `${SKILL_FILE}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, shipped, 'utf-8');
    await rename(tmp, SKILL_FILE);
    return SKILL_FILE;
  } catch (err) {
    log?.('installCcCenterSkill', err);
    return null;
  }
}
