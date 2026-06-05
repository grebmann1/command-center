import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type { Project, ScheduledTask } from '../shared/types.js';

const globalDir = () => join(app.getPath('home'), '.cc-center', 'schedules');
const projectDir = (project: Project) => join(project.path, '.cc-center', 'schedules');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

function readScheduleFile(path: string): ScheduledTask | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ScheduledTask;
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    // Defensive defaults — older hand-edited files may be missing pieces.
    raw.history = raw.history ?? { retain: 10 };
    raw.status = raw.status ?? { runCount: 0, runs: [] };
    raw.status.runs = raw.status.runs ?? [];
    raw.overlap = raw.overlap ?? 'skip';
    return raw;
  } catch {
    return null;
  }
}

function listInDir(dir: string, source: ScheduledTask['source']): ScheduledTask[] {
  if (!existsSync(dir)) return [];
  const out: ScheduledTask[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const t = readScheduleFile(join(dir, name));
    if (t) {
      t.source = source;
      out.push(t);
    }
  }
  return out;
}

/**
 * Walk both the global directory and each project's per-project directory.
 * Per-project schedules whose project no longer exists are skipped (the
 * caller never sees them; they remain on disk in case the project comes
 * back).
 */
export function listAllSchedules(projects: Project[]): ScheduledTask[] {
  const out = listInDir(globalDir(), 'global');
  for (const p of projects) {
    out.push(...listInDir(projectDir(p), { projectId: p.id }));
  }
  return out;
}

function fileFor(task: ScheduledTask, projects: Project[]): string {
  let dir = globalDir();
  if (task.source && task.source !== 'global') {
    const projectId = task.source.projectId;
    const project = projects.find((x) => x.id === projectId);
    if (project) dir = projectDir(project);
  }
  ensureDir(dir);
  return join(dir, `${task.id}.json`);
}

export function saveSchedule(task: ScheduledTask, projects: Project[]): void {
  writeJsonAtomic(fileFor(task, projects), stripTransient(task));
}

/**
 * Locate the on-disk file for a schedule by id. We search global first,
 * then each project dir — id is unique across the whole system.
 */
function locateScheduleFile(id: string, projects: Project[]): string | null {
  const candidates: string[] = [join(globalDir(), `${id}.json`)];
  for (const p of projects) candidates.push(join(projectDir(p), `${id}.json`));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function deleteSchedule(id: string, projects: Project[]): boolean {
  const path = locateScheduleFile(id, projects);
  if (!path) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `source` is loader-only metadata; never written to disk. */
function stripTransient(task: ScheduledTask): Omit<ScheduledTask, 'source'> {
  const { source: _source, ...rest } = task;
  void _source;
  return rest;
}
