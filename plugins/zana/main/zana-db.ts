/**
 * Zana SQLite read layer.
 *
 * Zana ≥0.1.x stores tickets and sprints in a per-workspace SQLite database
 * (`<root>/.zana/tickets.db`), NOT the legacy `tickets/<uuid>/ticket.json`
 * tree. This module reads that database — read-only, WAL-aware — and maps rows
 * into the same `ZanaTicket` / `ZanaSprint` shapes the JSON reader produced, so
 * the rest of the panel is unaffected by where the data came from.
 *
 * Why read-only + WAL matters: Zana opens the DB in WAL mode, so recent writes
 * live in a `tickets.db-wal` sidecar until a checkpoint folds them into the main
 * file. A reader that ignores the WAL would show stale data (the very bug this
 * fixes). better-sqlite3 reads the WAL transparently as long as it can open the
 * sidecar, so we open the real DB file (not a copy) with `readonly: true`.
 *
 * Schema reference (Zana `packages/work/src/tickets/db.ts`): the `tickets` and
 * `sprints` tables store array/object fields (`labels`, `blockedBy`, `comments`,
 * `audit`, `ticketIds`) as JSON-encoded TEXT columns. Everything else is a
 * scalar column that maps 1:1 to our types.
 *
 * Tolerance: every accessor is defensive. A missing DB file, a locked DB, a
 * schema drift (renamed/absent column), or a corrupt JSON cell degrades to a
 * sensible default and is logged — never throws past the caller, so the panel
 * falls back to the JSON reader instead of blanking.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type {
  ZanaAuditEntry,
  ZanaSprint,
  ZanaTicket,
  ZanaTicketDetail
} from '../shared/types.js';

/** Logger shape (matches MainModuleContext['log']). */
type Log = (message: string, err?: unknown) => void;

/**
 * better-sqlite3 is a native module externalized from the main bundle. Load it
 * lazily via require so (a) it isn't pulled into any renderer/preload graph and
 * (b) a missing/unbuilt binary degrades to "no DB reader" rather than crashing
 * module init — the caller then uses the JSON fallback.
 */
const require = createRequire(import.meta.url);
type BetterSqlite3 = typeof import('better-sqlite3');
type Database = import('better-sqlite3').Database;
let _Database: BetterSqlite3 | null | undefined;
function loadDatabase(log: Log): BetterSqlite3 | null {
  if (_Database !== undefined) return _Database;
  try {
    _Database = require('better-sqlite3') as BetterSqlite3;
  } catch (err) {
    log('better-sqlite3 unavailable — Zana will use the JSON fallback', err);
    _Database = null;
  }
  return _Database;
}

/**
 * Whether the native SQLite driver is loadable. The dispatch in zana-main uses
 * this to decide between "the DB is the source of truth" and "fall back to the
 * JSON tree": when the driver is missing/unbuilt we must NOT commit to the DB
 * path (every read would return empty), so the caller falls through to JSON.
 */
export function isDbDriverAvailable(log: Log): boolean {
  return loadDatabase(log) !== null;
}

/** The SQLite DB filename Zana writes under a `.zana` root. */
const DB_FILENAME = 'tickets.db';

/** Absolute path to a `.zana` root's tickets DB. */
export function ticketsDbPath(zanaDir: string): string {
  return path.join(zanaDir, DB_FILENAME);
}

/** Whether a readable `tickets.db` exists under this `.zana` root. */
export async function hasTicketsDb(zanaDir: string): Promise<boolean> {
  try {
    const st = await fs.stat(ticketsDbPath(zanaDir));
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Open the tickets DB read-only and hand it to `fn`, always closing it after.
 * Returns `fallback` (and logs) if the driver is missing or the open fails.
 *
 * `fileMustExist` guards against better-sqlite3 creating an empty DB when the
 * path is wrong. We deliberately do NOT set any pragma: the DB already carries
 * its WAL journal mode, and a read-only connection reads committed WAL frames.
 */
function withDb<T>(zanaDir: string, log: Log, fallback: T, fn: (db: Database) => T): T {
  const Driver = loadDatabase(log);
  if (!Driver) return fallback;
  const file = ticketsDbPath(zanaDir);
  let db: Database | null = null;
  try {
    db = new Driver(file, { readonly: true, fileMustExist: true });
    // The DB is written concurrently by a live Zana daemon (WAL mode). A
    // checkpoint-restart or transient EXCLUSIVE lock can otherwise return
    // SQLITE_BUSY to even a reader; a short wait makes reads self-healing
    // instead of spuriously returning the empty fallback.
    db.pragma('busy_timeout = 3000');
    return fn(db);
  } catch (err) {
    log(`failed to read Zana tickets DB ${file}`, err);
    return fallback;
  } finally {
    try {
      db?.close();
    } catch {
      /* closing a read-only handle should never throw; ignore if it does */
    }
  }
}

/** Parse a JSON-encoded TEXT cell into a string[]; [] on null/garbage. */
function jsonStringArray(cell: unknown): string[] {
  if (typeof cell !== 'string' || cell.length === 0) return [];
  try {
    const v = JSON.parse(cell);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Coerce a possibly-null TEXT cell to `string | undefined`. */
function str(cell: unknown): string | undefined {
  return typeof cell === 'string' && cell.length > 0 ? cell : undefined;
}

/**
 * Open the tickets DB READ-WRITE and hand it to `fn`. Unlike {@link withDb} this
 * lets the callback mutate rows; it still closes the handle and surfaces errors
 * to the caller (the write path WANTS failures to propagate so the optimistic UI
 * can roll back). The DB keeps its own WAL journal mode — we don't override it.
 */
function withWritableDb<T>(zanaDir: string, log: Log, fn: (db: Database) => T): T {
  const Driver = loadDatabase(log);
  if (!Driver) throw new Error('Zana SQLite driver unavailable');
  const file = ticketsDbPath(zanaDir);
  let db: Database | null = null;
  try {
    db = new Driver(file, { readonly: false, fileMustExist: true });
    db.pragma('foreign_keys = ON');
    // Wait (rather than fail) when the live Zana daemon holds the single WAL
    // write lock. Its write transactions are short, so a few seconds of retry
    // turns an intermittent SQLITE_BUSY into a transparent, near-certain commit.
    db.pragma('busy_timeout = 5000');
    return fn(db);
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore close error */
    }
  }
}

/**
 * Persist an assignment to the DB and return the fresh detail. Mutates only the
 * three assignee columns + `updatedAt`, and appends one audit entry to the
 * JSON-encoded `audit` cell — mirroring the JSON write path's semantics so the
 * two storage backends behave identically. Wrapped in a transaction so the row
 * update and the read-back are consistent. Throws `Ticket not found` when the id
 * isn't in the DB (caller maps that to its own not-found handling).
 */
export function assignTicketInDb(
  zanaDir: string,
  id: string,
  fields: {
    assigneeProfileId: string | null;
    assigneeName: string | null;
    assigneeId: string | null;
  },
  auditEntry: ZanaAuditEntry,
  nowIso: string,
  log: Log
): ZanaTicketDetail {
  return withWritableDb(zanaDir, log, (db) => {
    // The whole read-modify-write-readback runs in ONE transaction. The `audit`
    // column is a full-JSON read-modify-write, so re-reading the row inside the
    // txn (rather than before it) is what prevents clobbering a concurrent
    // audit append by the daemon: the daemon's write serialises before or after
    // ours, never interleaved. better-sqlite3 transactions are synchronous, so
    // the returned value is the committed state.
    const apply = db.transaction((): ZanaTicketDetail => {
      const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new Error('Ticket not found');

      // Append to the existing audit log, tolerating a null/garbage cell.
      const audit = parseAudit(row.audit);
      audit.push(auditEntry);

      db.prepare(
        `UPDATE tickets
            SET assigneeProfileId = @assigneeProfileId,
                assigneeName      = @assigneeName,
                assigneeId        = @assigneeId,
                audit             = @audit,
                updatedAt         = @updatedAt
          WHERE id = @id`
      ).run({
        id,
        assigneeProfileId: fields.assigneeProfileId,
        assigneeName: fields.assigneeName,
        assigneeId: fields.assigneeId,
        audit: JSON.stringify(audit),
        updatedAt: nowIso
      });

      const fresh = readTicketDetailRow(db, id);
      if (!fresh) throw new Error('Failed to read Zana ticket back after assignment');
      return fresh;
    });
    return apply();
  });
}

/** Map the current row for `id` into a full detail, using an open handle. */
function readTicketDetailRow(db: Database, id: string): ZanaTicketDetail | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const base = rowToTicket(row);
  if (!base) return null;
  return {
    ...base,
    createdBy: str(row.createdBy),
    reworkCount: typeof row.reworkCount === 'number' ? row.reworkCount : undefined,
    reviewPhase: str(row.reviewPhase),
    audit: parseAudit(row.audit)
  };
}

/** Map one `tickets` row into the lean ZanaTicket the snapshot ships. */
function rowToTicket(row: Record<string, unknown>): ZanaTicket | null {
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '(untitled)',
    description: str(row.description),
    status: typeof row.status === 'string' && row.status ? row.status : 'unknown',
    priority: str(row.priority),
    assigneeName: str(row.assigneeName),
    assigneeId: str(row.assigneeId),
    assigneeProfileId: str(row.assigneeProfileId),
    sprintId: str(row.sprintId),
    labels: jsonStringArray(row.labels),
    blockedBy: jsonStringArray(row.blockedBy),
    type: str(row.type),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    closedAt: str(row.closedAt),
    resultSummary: str(row.resultSummary),
    comments: parseComments(row.comments)
  };
}

/** Parse the JSON-encoded `comments` cell into ZanaComment[] (or undefined). */
function parseComments(cell: unknown): ZanaTicket['comments'] {
  if (typeof cell !== 'string' || cell.length === 0) return undefined;
  try {
    const v = JSON.parse(cell);
    if (!Array.isArray(v)) return undefined;
    return v
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .filter((c) => typeof c.body === 'string')
      .map((c) => ({
        author: str(c.author),
        body: c.body as string,
        createdAt: str(c.createdAt)
      }));
  } catch {
    return undefined;
  }
}

/** Parse the JSON-encoded `audit` cell into ZanaAuditEntry[] (chronological). */
function parseAudit(cell: unknown): ZanaAuditEntry[] {
  if (typeof cell !== 'string' || cell.length === 0) return [];
  try {
    const v = JSON.parse(cell);
    if (!Array.isArray(v)) return [];
    return v
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => {
        const entry: ZanaAuditEntry = {
          action: typeof e.action === 'string' ? e.action : String(e.action ?? '')
        };
        if (typeof e.id === 'string') entry.id = e.id;
        if (typeof e.actor === 'string') entry.actor = e.actor;
        if (typeof e.timestamp === 'string') entry.timestamp = e.timestamp;
        if (e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
          entry.details = e.details as Record<string, unknown>;
        }
        return entry;
      });
  } catch {
    return [];
  }
}

/**
 * Read all tickets from the DB, newest-updated first. The driver/open/SQL are
 * all behind `withDb`, so any failure yields `[]` and the caller falls back to
 * the JSON tree.
 */
export function readTicketsFromDb(zanaDir: string, log: Log): ZanaTicket[] {
  return withDb(zanaDir, log, [], (db) => {
    const rows = db
      .prepare('SELECT * FROM tickets ORDER BY updatedAt DESC')
      .all() as Record<string, unknown>[];
    return rows
      .map(rowToTicket)
      .filter((t): t is ZanaTicket => t !== null);
  });
}

/**
 * Read one ticket's FULL detail (incl. the heavier `audit` / `createdBy` /
 * `reviewPhase` / `reworkCount` fields the snapshot trims). Returns null when
 * the id isn't present or the DB can't be read.
 */
export function readTicketDetailFromDb(
  zanaDir: string,
  id: string,
  log: Log
): ZanaTicketDetail | null {
  return withDb<ZanaTicketDetail | null>(zanaDir, log, null, (db) =>
    readTicketDetailRow(db, id)
  );
}

/**
 * Read sprints from the DB and derive per-sprint ticket counts from the passed
 * (already-loaded) tickets — mirroring how the JSON reader derived them from
 * `_index.json`. The synthetic-name fallback matches the JSON path so the
 * renderer's "is this a real name?" check behaves identically.
 */
export function readSprintsFromDb(
  zanaDir: string,
  tickets: ZanaTicket[],
  log: Log,
  isClosed: (status: string, closedAt?: string | null) => boolean
): ZanaSprint[] {
  return withDb(zanaDir, log, [], (db) => {
    const rows = db.prepare('SELECT * FROM sprints').all() as Record<string, unknown>[];
    return rows
      .filter((s) => typeof s.id === 'string' && s.id)
      .map((s) => {
        const id = s.id as string;
        const matching = tickets.filter((t) => t.sprintId === id);
        const openCount = matching.filter((t) => !isClosed(t.status, t.closedAt)).length;
        return {
          id,
          status: str(s.status),
          updatedAt: str(s.updatedAt),
          name: str(s.name) ?? `Sprint ${id.slice(0, 8)}`,
          ticketCount: matching.length,
          openCount
        } as ZanaSprint;
      });
  });
}
