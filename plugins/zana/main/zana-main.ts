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
 *   - getSnapshot(opts?)   → ZanaSnapshot   (tickets + sprints + artifacts + KPIs)
 *   - getTicket(opts)      → ZanaTicketDetail | null  (one ticket, full detail
 *                            incl. audit/activity log, on demand)
 *   - getArtifact(opts)    → ZanaArtifact | null  (one artifact, content on demand)
 *   - listSources(opts?)   → ZanaSource[]   (which roots exist: project / global)
 *   - probeProjects(opts)  → ZanaProjectSource[]  (global + projects with .zana,
 *                            each with a cheap open-ticket count for the rail)
 *   - listProfiles()       → ZanaProfile[]   (ALL profiles — workspace
 *                            `~/.zana/profiles/*.json` AND Zana's built-in
 *                            profiles shipped in `@zana-ai/core`; workspace
 *                            overrides built-in by id. Drives the picker + view)
 *   - getProfile(opts)     → ZanaProfileDetail | null  (one profile, full detail
 *                            incl. the system prompt, on demand)
 *   - assignTicket(opts)   → ZanaTicketDetail  (WRITE: set/clear a ticket's
 *                            assignee by profile id (or free-text name), append
 *                            an audit entry, atomic-write `ticket.json`)
 *
 * Decoupling: imports only the module contract (`@shared/module-main`) and its
 * own shared types. No core internals. Reads are bounded and per-file tolerant:
 * a missing dir or corrupt file is skipped + logged, never failing the call.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { MainModule, MainModuleContext } from '@cctc/extension-sdk/main';
import {
  type ZanaArtifact,
  type ZanaAuditEntry,
  type ZanaKpis,
  type ZanaProfile,
  type ZanaProfileDetail,
  type ZanaProjectSource,
  type ZanaSnapshot,
  type ZanaSource,
  type ZanaSprint,
  type ZanaTicket,
  type ZanaTicketDetail,
  isClosedZanaStatus
} from '../shared/types.js';

/** Defensive caps so a runaway `.zana/` dir can't stall the read. */
const MAX_TICKETS = 2000;
const MAX_ARTIFACTS = 1000;
/** Defensive cap on how many projects the rail probe will inspect. */
const MAX_PROBE_PROJECTS = 100;
/** Defensive cap on how many profile files each source contributes. */
const MAX_PROFILES = 300;
/** Defensive cap on how many npx hash dirs the built-in scan will inspect. */
const MAX_NPX_HASH_DIRS = 200;
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
 * The workspace profiles dir (`~/.zana/profiles`). These are the user's own
 * profiles, independent of which `.zana` root tickets come from.
 */
function globalProfilesDir(): string {
  return path.join(globalZanaDir(), 'profiles');
}

/**
 * Resolve the directory(ies) that hold Zana's BUILT-IN profiles, shipped inside
 * the npx-installed `@zana-ai/core` package. npx unpacks each package run under
 * `~/.npm/_npx/<hash>/`, where `<hash>` is content-addressed and NOT stable, so
 * we must discover it rather than hardcode it.
 *
 * Strategy (cheap + fully tolerant):
 *   - Scan `~/.npm/_npx/*` (bounded to MAX_NPX_HASH_DIRS entries).
 *   - For each hash dir, the candidate is
 *     `<hash>/node_modules/@zana-ai/core/profiles`; keep the ones that are dirs.
 *   - Return ALL matching dirs, most-recently-modified first, so callers that
 *     dedupe by id naturally prefer the freshest install.
 *
 * Any error (missing `_npx`, unreadable entry, …) degrades to no built-ins:
 * we return `[]` and Zana falls back to workspace-only profiles.
 */
async function builtinProfilesDirs(log: Log): Promise<string[]> {
  const npxBase = path.join(os.homedir(), '.npm', '_npx');
  if (!(await isDir(npxBase))) return [];
  let hashes: string[];
  try {
    hashes = await fs.readdir(npxBase);
  } catch (err) {
    log(`failed to list npx base ${npxBase}`, err);
    return [];
  }
  const found: Array<{ dir: string; mtimeMs: number }> = [];
  for (const hash of hashes.slice(0, MAX_NPX_HASH_DIRS)) {
    const dir = path.join(npxBase, hash, 'node_modules', '@zana-ai', 'core', 'profiles');
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) found.push({ dir, mtimeMs: st.mtimeMs });
    } catch {
      // Not every hash dir hosts @zana-ai/core; silently skip.
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.map((f) => f.dir);
}

/**
 * Normalise a raw profile.json object into a ZanaProfile (id required). The
 * caller supplies the `origin` since the same shape ships from both a workspace
 * file and a built-in package.
 */
function mapProfile(raw: any, origin: ZanaProfile['origin']): ZanaProfile | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const toolList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t: unknown): t is string => typeof t === 'string') : undefined;
  return {
    id: raw.id,
    displayName:
      typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : raw.id,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    origin,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    allowedTools: toolList(raw.allowedTools),
    disallowedTools: toolList(raw.disallowedTools)
  };
}

/**
 * Normalise a raw profile.json into a ZanaProfileDetail — the ZanaProfile base
 * plus the heavier fields the list payload drops (system prompt et al.).
 */
function mapProfileDetail(raw: any, origin: ZanaProfile['origin']): ZanaProfileDetail | null {
  const base = mapProfile(raw, origin);
  if (!base) return null;
  return {
    ...base,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : undefined,
    permissionMode: typeof raw.permissionMode === 'string' ? raw.permissionMode : undefined,
    effortLevel: typeof raw.effortLevel === 'string' ? raw.effortLevel : undefined
  };
}

/**
 * Read + map all `*.json` profiles from a single directory, tagging them with
 * `origin`. Bounded to MAX_PROFILES files. Tolerant: a missing dir returns [],
 * a corrupt/invalid file is skipped + logged.
 */
async function readProfilesFromDir(
  dir: string,
  origin: ZanaProfile['origin'],
  log: Log
): Promise<ZanaProfile[]> {
  if (!(await isDir(dir))) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    log(`failed to list profiles dir ${dir}`, err);
    return [];
  }
  const profiles: ZanaProfile[] = [];
  for (const name of entries) {
    if (profiles.length >= MAX_PROFILES) {
      log(`profile cap (${MAX_PROFILES}) reached in ${dir}; remaining skipped`);
      break;
    }
    if (!name.endsWith('.json')) continue;
    const raw = await readJson<any>(path.join(dir, name), log);
    if (!raw) continue;
    const p = mapProfile(raw, origin);
    if (p) profiles.push(p);
  }
  return profiles;
}

/**
 * Resolve a single profile id to its full detail, preferring a workspace file
 * over any built-in. Returns null if the id isn't found in either place.
 */
async function findProfileDetail(id: string, log: Log): Promise<ZanaProfileDetail | null> {
  // Workspace wins.
  const wsFile = path.join(globalProfilesDir(), `${id}.json`);
  const wsRaw = await readJson<any>(wsFile, log);
  const wsDetail = wsRaw ? mapProfileDetail(wsRaw, 'workspace') : null;
  if (wsDetail) return wsDetail;
  // Then built-in dirs (freshest first).
  for (const dir of await builtinProfilesDirs(log)) {
    const biRaw = await readJson<any>(path.join(dir, `${id}.json`), log);
    const biDetail = biRaw ? mapProfileDetail(biRaw, 'builtin') : null;
    if (biDetail) return biDetail;
  }
  return null;
}

/**
 * Atomically write `data` to `file`: serialise, write to a sibling temp file,
 * then `rename` over the target. Mirrors `ModuleStorage.set` in the core
 * registry. The real file is never left partially written.
 */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${randomUUID()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
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
    assigneeId: typeof raw.assigneeId === 'string' ? raw.assigneeId : undefined,
    assigneeProfileId: typeof raw.assigneeProfileId === 'string' ? raw.assigneeProfileId : undefined,
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

/** Normalise one raw `audit[]` entry, coercing fields and tolerating garbage. */
function mapAuditEntry(raw: any): ZanaAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry: ZanaAuditEntry = {
    action: typeof raw.action === 'string' ? raw.action : String(raw.action ?? '')
  };
  if (typeof raw.id === 'string') entry.id = raw.id;
  if (typeof raw.actor === 'string') entry.actor = raw.actor;
  if (typeof raw.timestamp === 'string') entry.timestamp = raw.timestamp;
  if (raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)) {
    entry.details = raw.details as Record<string, unknown>;
  }
  return entry;
}

/**
 * Normalise a raw ticket.json into a ZanaTicketDetail — the lean base from
 * `mapTicket` plus the heavier on-demand fields the snapshot drops. Tolerant of
 * missing/garbage per-field (never throws).
 */
function mapTicketDetail(raw: any): ZanaTicketDetail | null {
  const base = mapTicket(raw);
  if (!base) return null;
  const audit = Array.isArray(raw.audit)
    ? raw.audit.map(mapAuditEntry).filter((e: ZanaAuditEntry | null): e is ZanaAuditEntry => e !== null)
    : [];
  return {
    ...base,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    reworkCount: typeof raw.reworkCount === 'number' ? raw.reworkCount : undefined,
    reviewPhase: typeof raw.reviewPhase === 'string' ? raw.reviewPhase : undefined,
    audit
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

/**
 * Cheap open-ticket count for a `.zana` root, for the rail badge. Reuses the
 * already-bounded `readTickets` (capped at MAX_TICKETS) and counts non-closed
 * tickets. Tolerant: any failure resolves to 0 rather than throwing.
 */
async function countOpenTickets(zanaDir: string, log: Log): Promise<number> {
  try {
    const tickets = await readTickets(zanaDir, log);
    return tickets.filter((t) => !isClosedZanaStatus(t.status, t.closedAt)).length;
  } catch (err) {
    log(`countOpenTickets failed for ${zanaDir}`, err);
    return 0;
  }
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
       * Read one ticket by id from a `.zana` root, returning the FULL detail
       * (incl. the `audit` activity log and other heavier fields the snapshot
       * trims). Used by the detail modal to enrich the lean snapshot ticket.
       * Returns null when the ticket file is missing.
       */
      async getTicket(opts: {
        projectPath?: string;
        useGlobal?: boolean;
        id: string;
      }): Promise<ZanaTicketDetail | null> {
        if (!opts || typeof opts.id !== 'string' || !opts.id) return null;
        try {
          const source = await resolveSource(opts);
          const file = path.join(source.path, 'tickets', opts.id, 'ticket.json');
          const raw = await readJson<any>(file, log);
          return raw ? mapTicketDetail(raw) : null;
        } catch (err) {
          log(`getTicket failed (${opts.id})`, err);
          throw new Error('Failed to read Zana ticket');
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
      },

      /**
       * Probe the passed projects for the source rail. Always returns a Global
       * entry first (`~/.zana`), followed by one entry per passed project that
       * actually has a `<path>/.zana` dir. Each entry carries a cheap open-ticket
       * count for its rail badge. The probe is bounded (first MAX_PROBE_PROJECTS
       * projects) and per-source tolerant: a failing project counts 0 and is
       * never allowed to fail the whole call.
       */
      async probeProjects(opts?: {
        projects?: Array<{ id: string; name: string; path: string }>;
      }): Promise<ZanaProjectSource[]> {
        const out: ZanaProjectSource[] = [];

        // Global entry first.
        const globalDir = globalZanaDir();
        const globalHasZana = await isDir(globalDir);
        out.push({
          id: '',
          name: 'Global',
          path: '',
          kind: 'global',
          hasZana: globalHasZana,
          openTickets: globalHasZana ? await countOpenTickets(globalDir, log) : 0
        });

        const projects = Array.isArray(opts?.projects) ? opts!.projects : [];
        for (const p of projects.slice(0, MAX_PROBE_PROJECTS)) {
          if (!p || typeof p.path !== 'string' || !p.path) continue;
          try {
            const projectDir = path.join(p.path, '.zana');
            if (!(await isDir(projectDir))) continue; // only projects with a .zana/
            out.push({
              id: typeof p.id === 'string' ? p.id : '',
              name: typeof p.name === 'string' && p.name ? p.name : path.basename(p.path),
              path: p.path,
              kind: 'project',
              hasZana: true,
              openTickets: await countOpenTickets(projectDir, log)
            });
          } catch (err) {
            log(`probeProjects: skipped project ${p?.path}`, err);
          }
        }
        return out;
      },

      /**
       * List ALL available agent profiles: Zana's BUILT-IN profiles (shipped in
       * the npx-installed `@zana-ai/core` package) merged with the user's
       * WORKSPACE profiles (`~/.zana/profiles/*.json`). A workspace profile with
       * the same id as a built-in REPLACES it (and keeps `origin: 'workspace'`).
       *
       * Drives both the assignment picker and the Profiles view. Tolerant: a
       * missing built-in package or workspace dir simply contributes nothing; a
       * corrupt/invalid file is skipped + logged. Each source is bounded to
       * MAX_PROFILES files. Sorted by category then displayName.
       */
      async listProfiles(): Promise<ZanaProfile[]> {
        try {
          const byId = new Map<string, ZanaProfile>();
          // Built-ins first (across all resolved dirs; freshest dir wins per id).
          for (const dir of await builtinProfilesDirs(log)) {
            for (const p of await readProfilesFromDir(dir, 'builtin', log)) {
              if (!byId.has(p.id)) byId.set(p.id, p);
            }
          }
          // Workspace profiles override built-ins by id.
          for (const p of await readProfilesFromDir(globalProfilesDir(), 'workspace', log)) {
            byId.set(p.id, p);
          }
          const profiles = [...byId.values()];
          profiles.sort((a, b) => {
            const cat = (a.category ?? '').localeCompare(b.category ?? '');
            return cat !== 0 ? cat : a.displayName.localeCompare(b.displayName);
          });
          return profiles;
        } catch (err) {
          log('listProfiles failed', err);
          throw new Error('Failed to list Zana profiles');
        }
      },

      /**
       * Read one profile by id, returning its FULL detail (incl. the system
       * prompt the list payload drops). Looks up the workspace file first, then
       * any built-in dir. Returns null when the id isn't found anywhere.
       */
      async getProfile(opts: { id: string }): Promise<ZanaProfileDetail | null> {
        if (!opts || typeof opts.id !== 'string' || !opts.id) return null;
        try {
          return await findProfileDetail(opts.id, log);
        } catch (err) {
          log(`getProfile failed (${opts.id})`, err);
          throw new Error('Failed to read Zana profile');
        }
      },

      /**
       * WRITE capability: set or clear a ticket's assignee, then persist.
       *
       * Resolves the ticket source the same way reads do, then mutates
       * `<root>/tickets/<id>/ticket.json` directly (Zana has no daemon/API here).
       * The FULL raw JSON is read and rewritten so every field the module doesn't
       * model is preserved. An `assigned`/`unassigned` audit entry is appended and
       * `updatedAt` is bumped. The file is written atomically (temp + rename).
       *
       * Assignment rules:
       *   - profileId non-empty  → assign to that profile; assigneeName resolves
       *                            from opts.assigneeName ?? the profile's
       *                            displayName ?? profileId; assigneeId is kept
       *                            (or seeded from profileId when previously null).
       *   - profileId null/'' and no assigneeName → UNASSIGN (clear all three).
       *   - assigneeName only    → free-text assign; clears assigneeProfileId,
       *                            keeps assigneeId.
       *
       * Returns the freshly re-read ticket detail (incl. the new audit entry).
       */
      async assignTicket(opts: {
        projectPath?: string;
        useGlobal?: boolean;
        id: string;
        profileId?: string | null;
        assigneeName?: string;
        actor?: string;
      }): Promise<ZanaTicketDetail> {
        if (!opts || typeof opts.id !== 'string' || !opts.id) {
          throw new Error('A ticket id is required');
        }
        let file = '';
        try {
          const source = await resolveSource(opts);
          file = path.join(source.path, 'tickets', opts.id, 'ticket.json');

          const raw = await readJson<any>(file, log);
          if (!raw || typeof raw !== 'object') {
            throw new Error('Ticket not found');
          }

          const prevAssigneeName =
            typeof raw.assigneeName === 'string' ? raw.assigneeName : null;
          const profileId =
            typeof opts.profileId === 'string' && opts.profileId ? opts.profileId : null;
          const explicitName =
            typeof opts.assigneeName === 'string' && opts.assigneeName
              ? opts.assigneeName
              : undefined;

          let newProfileId: string | null;
          let newAssigneeName: string | null;
          let newAssigneeId: string | null;
          let action: 'assigned' | 'unassigned';

          if (profileId) {
            // Assign to a profile.
            let resolvedName = explicitName;
            if (!resolvedName) {
              // Resolve across workspace AND built-in profiles, so assigning a
              // built-in (e.g. `architect`) still resolves its displayName.
              const mapped = await findProfileDetail(profileId, log);
              resolvedName = mapped?.displayName;
            }
            newProfileId = profileId;
            newAssigneeName = resolvedName ?? profileId;
            newAssigneeId = typeof raw.assigneeId === 'string' ? raw.assigneeId : profileId;
            action = 'assigned';
          } else if (explicitName) {
            // Free-text assign (no profile).
            newProfileId = null;
            newAssigneeName = explicitName;
            newAssigneeId = typeof raw.assigneeId === 'string' ? raw.assigneeId : null;
            action = 'assigned';
          } else {
            // Unassign.
            newProfileId = null;
            newAssigneeName = null;
            newAssigneeId = null;
            action = 'unassigned';
          }

          const nowIso = new Date().toISOString();

          // Preserve every unmodelled field; only touch the assignment fields.
          raw.assigneeProfileId = newProfileId;
          raw.assigneeName = newAssigneeName;
          raw.assigneeId = newAssigneeId;
          raw.updatedAt = nowIso;

          const auditEntry: ZanaAuditEntry = {
            id: randomUUID(),
            action,
            actor: typeof opts.actor === 'string' && opts.actor ? opts.actor : 'cc-center',
            details: {
              profileId: newProfileId,
              assigneeName: newAssigneeName,
              from: prevAssigneeName
            },
            timestamp: nowIso
          };
          if (Array.isArray(raw.audit)) {
            raw.audit.push(auditEntry);
          } else {
            raw.audit = [auditEntry];
          }

          await writeJsonAtomic(file, raw);

          // Re-read so the renderer gets the canonical persisted record.
          const fresh = await readJson<any>(file, log);
          const detail = fresh ? mapTicketDetail(fresh) : null;
          if (!detail) throw new Error('Failed to read Zana ticket back after assignment');
          return detail;
        } catch (err) {
          // Let the specific not-found message through; wrap everything else.
          if (err instanceof Error && err.message === 'Ticket not found') throw err;
          log(`assignTicket failed (${opts.id})`, err);
          throw new Error('Failed to assign Zana ticket');
        }
      }
    };
  }
};
