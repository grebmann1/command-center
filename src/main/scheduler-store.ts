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
import type { LaunchProfileId, Project, ScheduledTask } from '../shared/types.js';
import { parseEvery } from '../shared/parse-every.js';

const globalDir = () => join(app.getPath('home'), '.cc-center', 'schedules');
const projectDir = (project: Project) => join(project.path, '.cc-center', 'schedules');

const VALID_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

/**
 * Validate a schedule JSON file. Returns the schedule on success, or a string
 * reason on failure (so callers can log the reason rather than silently
 * dropping bad files). Hand-edited files are common — a typoed `every` like
 * `"1 hour"` used to fall through to MIN_INTERVAL_MS and silently fire every
 * 60s; we now reject those at load time.
 */
export function validateScheduleFile(raw: unknown): ScheduledTask | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) return { error: 'missing id' };
  if (typeof r.name !== 'string' || !r.name.trim()) return { error: 'missing name' };
  if (typeof r.enabled !== 'boolean') return { error: 'enabled must be boolean' };
  if (typeof r.projectId !== 'string' || !r.projectId.trim()) return { error: 'missing projectId' };
  if (typeof r.profile !== 'string' || !VALID_PROFILES.includes(r.profile as LaunchProfileId)) {
    return { error: `invalid profile: ${String(r.profile)}` };
  }
  const schedule = r.schedule as { every?: unknown } | undefined;
  if (!schedule || typeof schedule !== 'object' || typeof schedule.every !== 'string') {
    return { error: 'missing schedule.every' };
  }
  if (parseEvery(schedule.every) === null) {
    return { error: `invalid schedule.every: ${schedule.every}` };
  }
  // Defensive defaults — older hand-edited files may be missing pieces.
  const task: ScheduledTask = {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : undefined,
    enabled: r.enabled,
    projectId: r.projectId,
    profile: r.profile as LaunchProfileId,
    extraArgs: Array.isArray(r.extraArgs)
      ? (r.extraArgs as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined,
    prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
    schedule: { every: schedule.every },
    overlap: 'skip',
    history:
      r.history && typeof r.history === 'object' && typeof (r.history as { retain?: unknown }).retain === 'number'
        ? { retain: (r.history as { retain: number }).retain }
        : { retain: 10 },
    status:
      r.status && typeof r.status === 'object'
        ? {
            runCount: typeof (r.status as { runCount?: unknown }).runCount === 'number'
              ? (r.status as { runCount: number }).runCount
              : 0,
            runs: Array.isArray((r.status as { runs?: unknown }).runs)
              ? ((r.status as { runs: ScheduledTask['status']['runs'] }).runs)
              : [],
            lastRunAt: typeof (r.status as { lastRunAt?: unknown }).lastRunAt === 'string'
              ? (r.status as { lastRunAt: string }).lastRunAt
              : undefined,
            lastRunResult:
              (r.status as { lastRunResult?: 'success' | 'error' | 'skipped' }).lastRunResult,
            lastRunSessionId:
              typeof (r.status as { lastRunSessionId?: unknown }).lastRunSessionId === 'string'
                ? (r.status as { lastRunSessionId: string }).lastRunSessionId
                : undefined,
            nextRunAt: typeof (r.status as { nextRunAt?: unknown }).nextRunAt === 'string'
              ? (r.status as { nextRunAt: string }).nextRunAt
              : undefined
          }
        : { runCount: 0, runs: [] },
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  return task;
}

function readScheduleFile(
  path: string,
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    onInvalid?.(path, `unreadable JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const result = validateScheduleFile(parsed);
  if ('error' in result) {
    onInvalid?.(path, result.error);
    return null;
  }
  return result;
}

function listInDir(
  dir: string,
  source: ScheduledTask['source'],
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask[] {
  if (!existsSync(dir)) return [];
  const out: ScheduledTask[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const t = readScheduleFile(join(dir, name), onInvalid);
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
 *
 * `onInvalid` is called once per unreadable / invalid file — wire it to
 * `logMainError` so users can spot why their hand-edited schedule isn't
 * loading.
 */
export function listAllSchedules(
  projects: Project[],
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask[] {
  const out = listInDir(globalDir(), 'global', onInvalid);
  for (const p of projects) {
    out.push(...listInDir(projectDir(p), { projectId: p.id }, onInvalid));
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
