import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, AppConfig, ProjectSettings } from '../shared/types.js';

const dataDir = join(app.getPath('home'), '.cc-center');
const projectsFile = join(dataDir, 'projects.json');
const configFile = join(dataDir, 'config.json');
const projectSettingsFile = join(dataDir, 'project-settings.json');

/** Current `projects.json` schema version. v0 = bare `Project[]`. */
export const PROJECTS_SCHEMA_VERSION = 1 as const;

/** On-disk shape since v1. v0 is the bare-array legacy form (auto-migrated on read). */
export interface ProjectsFile {
  version: typeof PROJECTS_SCHEMA_VERSION;
  projects: Project[];
}

const TAG_REGEX = /^[a-z0-9][a-z0-9_-]{0,32}$/;
const TAG_MAX_LEN = 33; // 1 + 32

function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function readJsonRaw<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

/**
 * Slugify a project name into a tag candidate. Lowercases, normalizes
 * accented characters, replaces runs of unsupported chars with `-`,
 * trims leading/trailing separators, and clamps to the 33-char regex
 * window. Returns a fallback if the input has no valid leading char.
 */
export function slugifyTag(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_MAX_LEN);
  if (base.length === 0 || !TAG_REGEX.test(base)) {
    // Fall back to a stable but non-empty seed; caller's dedupe loop
    // will append numeric suffixes if needed.
    return 'project';
  }
  return base;
}

/**
 * Append `-2`, `-3`, … until the tag is unique against `taken`. Honors
 * the regex max length (33) by trimming the base before appending the
 * numeric suffix. `taken` is a Set of already-claimed tags.
 */
export function dedupeTag(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const trimmedBase = base.length + suffix.length > TAG_MAX_LEN
      ? base.slice(0, TAG_MAX_LEN - suffix.length).replace(/-+$/, '') || 'project'
      : base;
    const candidate = `${trimmedBase}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomical fallback — cryptographically unique suffix.
  return `${base.slice(0, 24)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Pick a fresh tag for a project: slugify its name and dedupe against
 * the supplied set of already-taken tags. Exported for testability.
 */
export function pickTag(name: string, taken: Set<string>): string {
  return dedupeTag(slugifyTag(name), taken);
}

/**
 * Read & migrate `projects.json`. v0 (bare array) is treated as legacy
 * and rewritten to v1 on the next write. Unknown future versions are
 * defensively coerced to v1 with the provided projects list.
 */
function readProjectsFile(): ProjectsFile {
  const raw = readJsonRaw<unknown>(projectsFile, null);
  if (raw == null) return { version: PROJECTS_SCHEMA_VERSION, projects: [] };
  if (Array.isArray(raw)) {
    // Legacy v0 — bare array.
    return { version: PROJECTS_SCHEMA_VERSION, projects: raw as Project[] };
  }
  if (typeof raw === 'object' && raw !== null && 'projects' in raw && Array.isArray((raw as { projects: unknown }).projects)) {
    const projects = (raw as { projects: Project[] }).projects;
    return { version: PROJECTS_SCHEMA_VERSION, projects };
  }
  // Defensive: malformed shape — treat as empty rather than crash.
  return { version: PROJECTS_SCHEMA_VERSION, projects: [] };
}

function writeProjects(projects: Project[]) {
  const file: ProjectsFile = { version: PROJECTS_SCHEMA_VERSION, projects };
  writeJson(projectsFile, file);
}

/**
 * If `project.tag` is absent, slugify+dedupe its name against `taken`
 * and return a copy with the tag set. Otherwise returns the input
 * unchanged. The returned `taken` set is mutated to include the new
 * tag so callers can chain backfills in a single pass.
 */
export function backfillProjectTag(project: Project, taken: Set<string>): Project {
  if (project.tag && TAG_REGEX.test(project.tag)) return project;
  const tag = pickTag(project.name, taken);
  taken.add(tag);
  return { ...project, tag };
}

function normalizeBounds(
  bounds: AppConfig['windowBounds'] | undefined
): AppConfig['windowBounds'] | undefined {
  if (!bounds) return undefined;
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return undefined;
  const width = Math.max(900, Math.round(bounds.width));
  const height = Math.max(600, Math.round(bounds.height));
  const next: AppConfig['windowBounds'] = { width, height };
  if (typeof bounds.x === 'number' && Number.isFinite(bounds.x)) next.x = Math.round(bounds.x);
  if (typeof bounds.y === 'number' && Number.isFinite(bounds.y)) next.y = Math.round(bounds.y);
  return next;
}

function normalizeConfig(input: Partial<AppConfig>): Partial<AppConfig> {
  const normalized: Partial<AppConfig> = {};
  if (input.theme === 'dark' || input.theme === 'light') normalized.theme = input.theme;
  if (typeof input.shell === 'string' && input.shell.trim()) normalized.shell = input.shell.trim();
  if (typeof input.claudeBinary === 'string' && input.claudeBinary.trim()) {
    normalized.claudeBinary = input.claudeBinary.trim();
  }
  if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
    normalized.fontSize = Math.max(10, Math.min(20, Math.round(input.fontSize)));
  }
  if (typeof input.lastProjectId === 'string' || input.lastProjectId === null) {
    normalized.lastProjectId = input.lastProjectId;
  }
  if (input.workspaceModes && typeof input.workspaceModes === 'object') {
    normalized.workspaceModes = Object.fromEntries(
      Object.entries(input.workspaceModes).filter(
        (_entry): _entry is [string, 'terminals' | 'explorer'] =>
          _entry[1] === 'terminals' || _entry[1] === 'explorer'
      )
    );
  }
  if (typeof input.listPaneWidth === 'number' && Number.isFinite(input.listPaneWidth)) {
    normalized.listPaneWidth = Math.max(200, Math.min(600, Math.round(input.listPaneWidth)));
  }
  if (
    input.defaultModel === 'opus' ||
    input.defaultModel === 'sonnet' ||
    input.defaultModel === 'haiku' ||
    input.defaultModel === 'default'
  ) {
    normalized.defaultModel = input.defaultModel;
  }
  if (
    input.defaultPermissionMode === 'default' ||
    input.defaultPermissionMode === 'acceptEdits' ||
    input.defaultPermissionMode === 'plan' ||
    input.defaultPermissionMode === 'bypassPermissions'
  ) {
    normalized.defaultPermissionMode = input.defaultPermissionMode;
  }
  if (typeof input.inboxGuidanceEnabled === 'boolean') {
    normalized.inboxGuidanceEnabled = input.inboxGuidanceEnabled;
  }
  normalized.windowBounds = normalizeBounds(input.windowBounds);
  return normalized;
}

export const store = {
  listProjects(): Project[] {
    return readProjectsFile().projects;
  },
  addProject(path: string): Project {
    const stat = statSync(path);
    if (!stat.isDirectory()) throw new Error('not a directory');
    const projects = this.listProjects();
    const existing = projects.find((p) => p.path === path);
    if (existing) {
      existing.lastActiveAt = Date.now();
      writeProjects(projects);
      return existing;
    }
    const name = basename(path) || path;
    const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
    const tag = pickTag(name, taken);
    const project: Project = {
      id: randomUUID(),
      name,
      path,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      tag
    };
    projects.push(project);
    writeProjects(projects);
    return project;
  },
  removeProject(id: string) {
    const projects = this.listProjects().filter((p) => p.id !== id);
    writeProjects(projects);
  },
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color'>>): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    projects[idx] = { ...projects[idx], ...patch };
    writeProjects(projects);
    return projects[idx];
  },
  reorderProjects(orderedIds: string[]): Project[] {
    const projects = this.listProjects();
    const byId = new Map(projects.map((p) => [p.id, p]));
    const next: Project[] = [];
    let i = 0;
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (!p) continue;
      next.push({ ...p, sortIndex: i++ });
      byId.delete(id);
    }
    // Append any projects not included (defensive — shouldn't happen).
    for (const leftover of byId.values()) {
      next.push({ ...leftover, sortIndex: i++ });
    }
    writeProjects(next);
    return next;
  },
  touchProject(id: string): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    // Backfill `tag` for any project missing it (legacy data, or an
    // entry written before the tag-aware addProject path landed). We
    // walk all projects in one pass so duplicate fallback names get
    // distinct `-2`, `-3`, … suffixes deterministically.
    const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
    let mutated = false;
    for (let i = 0; i < projects.length; i++) {
      const before = projects[i];
      const after = backfillProjectTag(before, taken);
      if (after !== before) {
        projects[i] = after;
        mutated = true;
      }
    }

    projects[idx] = { ...projects[idx], lastActiveAt: Date.now() };
    writeProjects(projects);
    // If we backfilled tags, the write above already persisted them.
    void mutated;
    return projects[idx];
  },
  getConfig(): AppConfig {
    const fallback: AppConfig = {
      version: 1,
      theme: 'dark',
      shell: process.env.SHELL || '/bin/zsh',
      claudeBinary: 'claude',
      fontSize: 13,
      lastProjectId: null,
      workspaceModes: {}
    };
    const stored = normalizeConfig(readJsonRaw<Partial<AppConfig>>(configFile, {}));
    return { ...fallback, ...stored, version: 1 };
  },
  setConfig(patch: Partial<AppConfig>): AppConfig {
    const next = { ...this.getConfig(), ...normalizeConfig(patch), version: 1 as const };
    writeJson(configFile, next);
    return next;
  },
  getProjectSettings(id: string): ProjectSettings {
    const all = readJsonRaw<Record<string, ProjectSettings>>(projectSettingsFile, {});
    return all[id] ?? {};
  },
  setProjectSettings(id: string, patch: Partial<ProjectSettings>): ProjectSettings {
    const all = readJsonRaw<Record<string, ProjectSettings>>(projectSettingsFile, {});
    const current = all[id] ?? {};
    const next: ProjectSettings = { ...current, ...patch };
    all[id] = next;
    writeJson(projectSettingsFile, all);
    return next;
  }
};
