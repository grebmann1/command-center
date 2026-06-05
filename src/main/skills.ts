import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import type { SkillEntry, SkillSource } from '../shared/types.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const USER_SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');
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

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  allowedTools?: string[];
}

/**
 * Tiny YAML-frontmatter parser. Handles the subset SKILL.md uses today —
 * `key: value` lines and `- item` list entries for `allowed-tools`.
 * No new npm deps; full YAML parsing isn't worth a dependency for a few keys.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const lines = block.split(/\r?\n/);
  const out: ParsedFrontmatter = {};
  let currentListKey: 'allowedTools' | null = null;
  for (const line of lines) {
    if (line.trim() === '') {
      currentListKey = null;
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      const v = unquote(listItem[1].trim());
      if (v) {
        if (currentListKey === 'allowedTools') {
          (out.allowedTools = out.allowedTools ?? []).push(v);
        }
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) {
      currentListKey = null;
      continue;
    }
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (key === 'name') out.name = unquote(value);
    else if (key === 'description') out.description = unquote(value);
    else if (key === 'allowed-tools' || key === 'allowedTools') {
      if (value === '') {
        currentListKey = 'allowedTools';
      } else if (value.startsWith('[') && value.endsWith(']')) {
        out.allowedTools = value
          .slice(1, -1)
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean);
        currentListKey = null;
      } else {
        out.allowedTools = [unquote(value)];
        currentListKey = null;
      }
    } else {
      currentListKey = null;
    }
  }
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

async function readSkillMd(skillDir: string): Promise<ParsedFrontmatter> {
  try {
    const raw = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
    return parseFrontmatter(raw);
  } catch {
    return {};
  }
}

async function listSkillDirs(parent: string): Promise<string[]> {
  if (!existsSync(parent)) return [];
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function buildEntry(
  source: SkillSource,
  skillDir: string,
  shortName: string,
  qualifiedName: string,
  disabledShortNames: Set<string>,
  extras: { pluginName?: string; projectId?: string }
): Promise<SkillEntry> {
  const fm = await readSkillMd(skillDir);
  return {
    id: `${source}:${qualifiedName}`,
    name: fm.name?.trim() || shortName,
    source,
    pluginName: extras.pluginName,
    projectId: extras.projectId,
    path: skillDir,
    description: fm.description,
    allowedTools: fm.allowedTools,
    // The disabledSkills list is matched by short skill name (Claude Code's
    // current behavior). Two skills with the same short name from different
    // sources collide on disable today; we surface unique ids in the UI but
    // persist the short name. Revisit if collisions actually bite.
    enabled: !disabledShortNames.has(fm.name?.trim() || shortName)
  };
}

async function listUserSkills(disabled: Set<string>): Promise<SkillEntry[]> {
  const names = await listSkillDirs(USER_SKILLS_DIR);
  const out: SkillEntry[] = [];
  for (const n of names) {
    out.push(
      await buildEntry('user', join(USER_SKILLS_DIR, n), n, n, disabled, {})
    );
  }
  return out;
}

/**
 * Walk `~/.claude/plugins/` and discover plugin skills. Plugin layout in the
 * wild varies, so we probe a couple of patterns:
 *  - `~/.claude/plugins/<plugin>/skills/<skill>/SKILL.md`
 *  - `~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<skill>/SKILL.md`
 *  - `~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/SKILL.md` (single-skill plugin)
 */
async function listPluginSkills(disabled: Set<string>): Promise<SkillEntry[]> {
  if (!existsSync(PLUGINS_DIR)) return [];
  const out: SkillEntry[] = [];
  const seen = new Set<string>();

  const visitPluginDir = async (pluginDir: string, pluginName: string) => {
    const skillsDir = join(pluginDir, 'skills');
    if (!existsSync(skillsDir)) return;
    let isSingleSkill = false;
    try {
      const stats = await stat(join(skillsDir, 'SKILL.md'));
      if (stats.isFile()) isSingleSkill = true;
    } catch {
      /* not a single-skill layout */
    }
    if (isSingleSkill) {
      const qualifiedName = pluginName;
      if (seen.has(`plugin:${qualifiedName}`)) return;
      seen.add(`plugin:${qualifiedName}`);
      out.push(
        await buildEntry('plugin', skillsDir, pluginName, qualifiedName, disabled, {
          pluginName
        })
      );
      return;
    }
    const skillNames = await listSkillDirs(skillsDir);
    for (const skillName of skillNames) {
      const skillDir = join(skillsDir, skillName);
      const qualifiedName = `${pluginName}/${skillName}`;
      const id = `plugin:${qualifiedName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(
        await buildEntry('plugin', skillDir, skillName, qualifiedName, disabled, {
          pluginName
        })
      );
    }
  };

  // Direct layout: ~/.claude/plugins/<plugin>/skills/...
  const topLevel = await listSkillDirs(PLUGINS_DIR);
  for (const name of topLevel) {
    if (name === 'marketplaces' || name === 'cache' || name === 'data') continue;
    await visitPluginDir(join(PLUGINS_DIR, name), name);
  }

  // Marketplace layout: ~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/...
  const marketplacesDir = join(PLUGINS_DIR, 'marketplaces');
  if (existsSync(marketplacesDir)) {
    const marketplaces = await listSkillDirs(marketplacesDir);
    for (const mp of marketplaces) {
      const pluginsDir = join(marketplacesDir, mp, 'plugins');
      if (!existsSync(pluginsDir)) continue;
      const plugins = await listSkillDirs(pluginsDir);
      for (const p of plugins) {
        await visitPluginDir(join(pluginsDir, p), p);
      }
    }
  }

  return out;
}

async function listProjectSkills(
  projectPath: string,
  projectId: string,
  disabled: Set<string>
): Promise<SkillEntry[]> {
  const dir = join(projectPath, '.claude', 'skills');
  const names = await listSkillDirs(dir);
  const out: SkillEntry[] = [];
  for (const n of names) {
    out.push(
      await buildEntry('project', join(dir, n), n, n, disabled, { projectId })
    );
  }
  return out;
}

export interface ListSkillsOptions {
  projectPath?: string;
  projectId?: string;
}

export async function listSkills(options: ListSkillsOptions = {}): Promise<SkillEntry[]> {
  const settings = await readSettings();
  const disabled = new Set(
    Array.isArray(settings.disabledSkills) ? (settings.disabledSkills as string[]) : []
  );
  const out: SkillEntry[] = [];
  out.push(...(await listUserSkills(disabled)));
  out.push(...(await listPluginSkills(disabled)));
  if (options.projectPath && options.projectId) {
    out.push(
      ...(await listProjectSkills(options.projectPath, options.projectId, disabled))
    );
  }
  return out;
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

export async function setManyEnabled(
  updates: Array<{ name: string; enabled: boolean }>
): Promise<void> {
  if (updates.length === 0) return;
  const settings = await readSettings();
  const disabled = new Set(
    Array.isArray(settings.disabledSkills) ? (settings.disabledSkills as string[]) : []
  );
  for (const { name, enabled } of updates) {
    if (enabled) disabled.delete(name);
    else disabled.add(name);
  }
  settings.disabledSkills = [...disabled];
  await writeSettings(settings);
}

export async function readHooks(): Promise<unknown> {
  const settings = await readSettings();
  return settings.hooks ?? null;
}

export async function revealSkillDir(
  skillId: string,
  options: ListSkillsOptions = {}
): Promise<{ ok: boolean; path: string; message?: string }> {
  const all = await listSkills(options);
  const found = all.find((s) => s.id === skillId);
  if (!found) {
    return { ok: false, path: '', message: `Skill not found: ${skillId}` };
  }
  try {
    await shell.openPath(found.path);
    return { ok: true, path: found.path };
  } catch (err) {
    return {
      ok: false,
      path: found.path,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
