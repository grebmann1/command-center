import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, AppConfig } from '../shared/types.js';

const dataDir = join(app.getPath('home'), '.cc-center');
const projectsFile = join(dataDir, 'projects.json');
const configFile = join(dataDir, 'config.json');

function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
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
  normalized.windowBounds = normalizeBounds(input.windowBounds);
  return normalized;
}

export const store = {
  listProjects(): Project[] {
    return readJson<Project[]>(projectsFile, []);
  },
  addProject(path: string): Project {
    const stat = statSync(path);
    if (!stat.isDirectory()) throw new Error('not a directory');
    const projects = this.listProjects();
    const existing = projects.find((p) => p.path === path);
    if (existing) {
      existing.lastActiveAt = Date.now();
      writeJson(projectsFile, projects);
      return existing;
    }
    const project: Project = {
      id: randomUUID(),
      name: basename(path) || path,
      path,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    projects.push(project);
    writeJson(projectsFile, projects);
    return project;
  },
  removeProject(id: string) {
    const projects = this.listProjects().filter((p) => p.id !== id);
    writeJson(projectsFile, projects);
  },
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color'>>): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    projects[idx] = { ...projects[idx], ...patch };
    writeJson(projectsFile, projects);
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
    writeJson(projectsFile, next);
    return next;
  },
  touchProject(id: string): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    projects[idx] = { ...projects[idx], lastActiveAt: Date.now() };
    writeJson(projectsFile, projects);
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
    const stored = normalizeConfig(readJson<Partial<AppConfig>>(configFile, {}));
    return { ...fallback, ...stored, version: 1 };
  },
  setConfig(patch: Partial<AppConfig>): AppConfig {
    const next = { ...this.getConfig(), ...normalizeConfig(patch), version: 1 as const };
    writeJson(configFile, next);
    return next;
  }
};
