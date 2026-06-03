import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const CLAUDE_DIR = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const tmp = `${SETTINGS_FILE}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
  await rename(tmp, SETTINGS_FILE);
}

export async function listSkills(): Promise<{ name: string; path: string; enabled: boolean }[]> {
  if (!existsSync(SKILLS_DIR)) return [];
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    const settings = await readSettings();
    const disabledSkills = Array.isArray(settings.disabledSkills)
      ? (settings.disabledSkills as string[])
      : [];
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: join(SKILLS_DIR, e.name),
        enabled: !disabledSkills.includes(e.name)
      }));
  } catch {
    return [];
  }
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const settings = await readSettings();
  const disabled = Array.isArray(settings.disabledSkills)
    ? [...(settings.disabledSkills as string[])]
    : [];
  if (!enabled) {
    if (!disabled.includes(name)) disabled.push(name);
  } else {
    const idx = disabled.indexOf(name);
    if (idx !== -1) disabled.splice(idx, 1);
  }
  settings.disabledSkills = disabled;
  await writeSettings(settings);
}

export async function readHooks(): Promise<unknown> {
  const settings = await readSettings();
  return settings.hooks ?? null;
}
