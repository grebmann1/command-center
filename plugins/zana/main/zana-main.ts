/**
 * Zana module — main process side.
 *
 * Reads Zana's on-disk work-tracking data (plain JSON under a `.zana/` dir)
 * and shapes it into a snapshot for the renderer panel. There is no daemon or
 * MCP — data is read straight from the filesystem with `fs.promises`.
 *
 * Data resolves to one of two `.zana/` roots:
 *   - per-workspace: `<project.path>/.zana/`
 *   - global fallback: `~/.zana/`
 *
 * Capabilities exposed to the renderer via `ModuleHost.call`:
 *   - getSnapshot(opts?) → ZanaSnapshot   (tickets + sprints + artifacts + KPIs)
 *   - getArtifact(opts)  → ZanaArtifact | null  (one artifact, content on demand)
 *   - listSources(opts?) → ZanaSource[]   (which roots exist: project / global)
 *
 * Decoupling: imports only the module contract (`@shared/module-main`) and its
 * own shared types. No core internals. Reads are bounded and per-file tolerant:
 * a missing dir or corrupt file is skipped + logged, never failing the call.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MainModule, MainModuleContext } from '../../../src/shared/module-main.js';
import {
  type ZanaArtifact,
  type ZanaKpis,
  type ZanaSnapshot,
  type ZanaSource,
  type ZanaSprint,
  type ZanaTicket,
  isClosedZanaStatus
} from '../shared/types.js';

/** Defensive caps so a runaway `.zana/` dir can't stall the read. */
const MAX_TICKETS = 2000;
const MAX_ARTIFACTS = 1000;
/** Window for the `throughput7d` KPI. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Matches a uuid-shaped artifact filename (`<uuid>.json`), skipping the rest. */
const UUID_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

type Log = MainModuleContext['log'];

/** Whether a path exists and is a directory. */
async function isDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Read + parse a JSON file, returning null (and logging) on any failure. */
async function readJson<T>(file: string, log: Log): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    log(`skipped unreadable file ${file}`, err);
    return null;
  }
}

/** The global `~/.zana` dir. */
function globalZanaDir(): string {
  return path.join(os.homedir(), '.zana');
}

/**
 * Resolve which `.zana` root a call should read, and describe it.
 *   - useGlobal               → `~/.zana` (kind 'global')
 *   - projectPath with .zana  → `<projectPath>/.zana` (kind 'project')
 *   - otherwise               → `~/.zana` (kind 'global', label notes fallback)
 */
async function resolveSource(opts: { projectPath?: string; useGlobal?: boolean }): Promise<ZanaSource> {
  if (!opts.useGlobal && opts.projectPath) {
    const projectDir = path.join(opts.projectPath, '.zana');
    if (await isDir(projectDir)) {
      return { kind: 'project', label: `Project (${path.basename(opts.projectPath)})`, path: projectDir };
    }
    return {
      kind: 'global',
      label: 'Global (~/.zana) — no project .zana found',
      path: globalZanaDir()
    };
  }
  return { kind: 'global', label: 'Global (~/.zana)', path: globalZanaDir() };
}

/** Normalise a raw ticket.json object into a ZanaTicket (defaults arrays). */
function mapTicket(raw: any): ZanaTicket | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '(untitled)',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    priority: typeof raw.priority === 'string' ? raw.priority : undefined,
    assigneeName: typeof raw.assigneeName === 'string' ? raw.assigneeName : undefined,
    sprintId: typeof raw.sprintId === 'string' ? raw.sprintId : undefined,
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l: unknown) => typeof l === 'string') : [],
    blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.filter((b: unknown) => typeof b === 'string') : [],
    type: typeof raw.type === 'string' ? raw.type : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : undefined,
    resultSummary: typeof raw.resultSummary === 'string' ? raw.resultSummary : undefined,
    comments: Array.isArray(raw.comments)
      ? raw.comments
          .filter((c: any) => c && typeof c.body === 'string')
          .map((c: any) => ({
            author: typeof c.author === 'string' ? c.author : undefined,
            body: c.body,
            createdAt: typeof c.createdAt === 'string' ? c.createdAt : undefined
          }))
      : undefined
  };
}

/** Normalise a raw artifact.json object into a ZanaArtifact. */
function mapArtifact(raw: any): ZanaArtifact | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '(untitled)',
    type: typeof raw.type === 'string' ? raw.type : undefined,
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string') : [],
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    linkedTickets: Array.isArray(raw.linkedTickets)
      ? raw.linkedTickets.filter((t: unknown) => typeof t === 'string')
      : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined
  };
}

/** Read every `tickets/<uuid>/ticket.json` under a `.zana` root (bounded). */
async function readTickets(zanaDir: string, log: Log): Promise<ZanaTicket[]> {
  const ticketsDir = path.join(zanaDir, 'tickets');
  if (!(await isDir(ticketsDir))) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(ticketsDir);
  } catch (err) {
    log(`failed to list tickets dir ${ticketsDir}`, err);
    return [];
  }
  const tickets: ZanaTicket[] = [];
  for (const name of entries) {
    if (tickets.length >= MAX_TICKETS) {
      log(`ticket cap (${MAX_TICKETS}) reached; remaining tickets skipped`);
      break;
    }
    const file = path.join(ticketsDir, name, 'ticket.json');
    const raw = await readJson<any>(file, log);
    if (!raw) continue;
    const t = mapTicket(raw);
    if (t) tickets.push(t);
  }
  return tickets;
}

/** Read `sprints/_index.json`, deriving counts + a display name per sprint. */
async function readSprints(zanaDir: string, tickets: ZanaTicket[], log: Log): Promise<ZanaSprint[]> {
  const indexFile = path.join(zanaDir, 'sprints', '_index.json');
  const raw = await readJson<any[]>(indexFile, log);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.id === 'string')
    .map((s) => {
      const matching = tickets.filter((t) => t.sprintId === s.id);
      const openCount = matching.filter((t) => !isClosedZanaStatus(t.status, t.closedAt)).length;
      return {
        id: s.id,
        status: typeof s.status === 'string' ? s.status : undefined,
        updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : undefined,
        name: typeof s.name === 'string' && s.name ? s.name : `Sprint ${s.id.slice(0, 8)}`,
        ticketCount: matching.length,
        openCount
      } as ZanaSprint;
    });
}

/** Read every uuid-named `artifacts/*.json` (skips `blobs/` + non-uuid files). */
async function readArtifacts(zanaDir: string, log: Log): Promise<ZanaArtifact[]> {
  const artifactsDir = path.join(zanaDir, 'artifacts');
  if (!(await isDir(artifactsDir))) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  } catch (err) {
    log(`failed to list artifacts dir ${artifactsDir}`, err);
    return [];
  }
  const artifacts: ZanaArtifact[] = [];
  for (const ent of entries) {
    if (artifacts.length >= MAX_ARTIFACTS) {
      log(`artifact cap (${MAX_ARTIFACTS}) reached; remaining artifacts skipped`);
      break;
    }
    // Skip the blobs/ subdir and any non-uuid file (indexes, etc.).
    if (!ent.isFile() || !UUID_FILE_RE.test(ent.name)) continue;
    const raw = await readJson<any>(path.join(artifactsDir, ent.name), log);
    if (!raw) continue;
    const a = mapArtifact(raw);
    if (a) artifacts.push(a);
  }
  return artifacts;
}

/** Compute aggregate KPIs over the loaded data. */
function computeKpis(
  tickets: ZanaTicket[],
  sprints: ZanaSprint[],
  artifacts: ZanaArtifact[]
): ZanaKpis {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let openTickets = 0;
  let closedTickets = 0;
  let blockedTickets = 0;
  let throughput7d = 0;
  const cutoff = Date.now() - SEVEN_DAYS_MS;

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    const closed = isClosedZanaStatus(t.status, t.closedAt);
    if (closed) {
      closedTickets += 1;
      if (t.closedAt) {
        const ts = Date.parse(t.closedAt);
        if (!Number.isNaN(ts) && ts >= cutoff) throughput7d += 1;
      }
    } else {
      openTickets += 1;
      if (t.blockedBy.length > 0) blockedTickets += 1;
    }
  }

  return {
    totalTickets: tickets.length,
    openTickets,
    closedTickets,
    blockedTickets,
    byStatus,
    byPriority,
    sprintCount: sprints.length,
    artifactCount: artifacts.length,
    throughput7d
  };
}

/** Descending string compare on optional ISO timestamps (missing sorts last). */
function byDateDesc(a?: string, b?: string): number {
  return (b ?? '').localeCompare(a ?? '');
}

export const zanaMainModule: MainModule = {
  id: 'zana',
  setup(ctx) {
    const { log } = ctx;

    return {
      /**
       * THE main capability: read a full snapshot from one `.zana` root.
       * opts.useGlobal    — force `~/.zana`.
       * opts.projectPath  — prefer `<projectPath>/.zana` (falls back to global).
       */
      async getSnapshot(opts?: { projectPath?: string; useGlobal?: boolean }): Promise<ZanaSnapshot> {
        try {
          const source = await resolveSource(opts ?? {});
          const tickets = await readTickets(source.path, log);
          const sprints = await readSprints(source.path, tickets, log);
          const artifacts = await readArtifacts(source.path, log);
          tickets.sort((a, b) => byDateDesc(a.updatedAt, b.updatedAt));
          artifacts.sort((a, b) => byDateDesc(a.createdAt, b.createdAt));
          const kpis = computeKpis(tickets, sprints, artifacts);
          return { source, kpis, tickets, sprints, artifacts };
        } catch (err) {
          log('getSnapshot failed', err);
          throw new Error('Failed to read Zana data');
        }
      },

      /**
       * Read one artifact by id from a `.zana` root. Used by the detail modal
       * so large `content` is fetched on demand. Returns null when not found.
       */
      async getArtifact(opts: {
        projectPath?: string;
        useGlobal?: boolean;
        id: string;
      }): Promise<ZanaArtifact | null> {
        if (!opts || typeof opts.id !== 'string' || !opts.id) return null;
        try {
          const source = await resolveSource(opts);
          const file = path.join(source.path, 'artifacts', `${opts.id}.json`);
          const raw = await readJson<any>(file, log);
          return raw ? mapArtifact(raw) : null;
        } catch (err) {
          log(`getArtifact failed (${opts.id})`, err);
          throw new Error('Failed to read Zana artifact');
        }
      },

      /**
       * Which sources are available — the project `.zana` (if it exists) and
       * the global `~/.zana` (if it exists). Lets the panel offer a toggle.
       */
      async listSources(opts?: { projectPath?: string }): Promise<ZanaSource[]> {
        try {
          const sources: ZanaSource[] = [];
          if (opts?.projectPath) {
            const projectDir = path.join(opts.projectPath, '.zana');
            if (await isDir(projectDir)) {
              sources.push({
                kind: 'project',
                label: `Project (${path.basename(opts.projectPath)})`,
                path: projectDir
              });
            }
          }
          const globalDir = globalZanaDir();
          if (await isDir(globalDir)) {
            sources.push({ kind: 'global', label: 'Global (~/.zana)', path: globalDir });
          }
          return sources;
        } catch (err) {
          log('listSources failed', err);
          throw new Error('Failed to list Zana sources');
        }
      }
    };
  }
};
