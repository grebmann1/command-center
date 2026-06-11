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

const SAVED_SKILL_DIR = join(homedir(), '.claude', 'skills', 'saved-reports');
const SAVED_SKILL_FILE = join(SAVED_SKILL_DIR, 'SKILL.md');

/**
 * Resolve a shipped resource file. In dev, electron-vite runs from the repo
 * root with `__dirname = out/main`, so the source is `../../resources`. Once
 * packaged, electron-builder copies it next to app.asar via `extraResources`,
 * surfaced as `process.resourcesPath`. Mirrors `resolveIconPath` in index.ts.
 */
function resolveShippedPath(fileName: string): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, fileName) : null,
    join(__dirname, `../../resources/${fileName}`)
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Deploy one bundled SKILL.md if needed. Best-effort: never throws — a failure
 * here must not block app boot (a read-only home dir, missing resource, etc.).
 * Idempotent + edit-respecting: only (re)writes when the on-disk content
 * differs from what we ship. Returns the install path on success, else null.
 */
async function installSkill(
  context: string,
  resourceFile: string,
  dir: string,
  file: string,
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  try {
    const src = resolveShippedPath(resourceFile);
    if (!src) {
      log?.(context, new Error(`shipped ${resourceFile} not found`));
      return null;
    }
    const shipped = await readFile(src, 'utf-8');

    // Skip the write when the file already matches what we ship — avoids churn
    // and keeps any in-session user edits until the shipped content changes.
    let current: string | null = null;
    try {
      current = await readFile(file, 'utf-8');
    } catch {
      current = null; // not installed yet
    }
    if (current === shipped) return file;

    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, shipped, 'utf-8');
    await rename(tmp, file);
    return file;
  } catch (err) {
    log?.(context, err);
    return null;
  }
}

/** Deploy the bundled `cc-center` skill (schedules/templates authoring). */
export async function installCcCenterSkill(
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  return installSkill('installCcCenterSkill', 'cc-center-skill.md', SKILL_DIR, SKILL_FILE, log);
}

/** Deploy the bundled `saved-reports` skill (find & reuse saved inbox reports). */
export async function installSavedReportsSkill(
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  return installSkill(
    'installSavedReportsSkill',
    'saved-reports-skill.md',
    SAVED_SKILL_DIR,
    SAVED_SKILL_FILE,
    log
  );
}
