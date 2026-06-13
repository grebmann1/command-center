/**
 * GUS module — main process side.
 *
 * Fetches the current user's GUS work items and sprints by running the
 * Salesforce CLI (`sf`) against the `gus` target-org. This reuses the
 * user's existing CLI auth — no OAuth flow or stored secrets in the app.
 *
 * The CLI is invoked exclusively through the brokered `ctx.exec` capability
 * (NOT a raw node builtin), so this module uses ONLY context capabilities +
 * pure JS. That keeps it survivable under the disk-extension Node-builtin
 * denylist (`host-child-guard.ts`): as a trusted built-in it gets an ungated
 * in-process `exec`; as an isolated disk extension (GUS-EXT-B) the SAME
 * `ctx.exec({ bin: 'sf' })` call forwards to the permission-gated broker.
 *
 * Capabilities exposed to the renderer via `ModuleHost.call`:
 *   - whoami()              → GusIdentity
 *   - listWork(opts?)       → GusWorkItem[]
 *   - listSprints()         → GusSprint[]
 *   - getWork(id)           → GusWorkDetail
 *   - setStatus(id, status) → { ok, status } (writes Status__c)
 *   - getChatter(id)        → GusChatterPost[]
 *
 * Decoupling: imports only the module contract (`@shared/module-main`) and
 * its own shared types. No core internals.
 */

import type { MainModule, MainModuleContext } from '@cctc/extension-sdk/main';
import {
  type GusIdentity,
  type GusSprint,
  type GusTeam,
  type GusWorkItem,
  type GusWorkDetail,
  type GusChatterPost,
  type GusAttachment,
  type CdcTrigger,
  type CdcLastSeen,
  type CdcPendingMatch,
  isClosedStatus
} from '../shared/types.js';

/** GUS target-org alias. The user authed this as `gus` in the sf CLI. */
const TARGET_ORG = 'gus';
/** sf queries can be slow on a cold org; give them room but bound them. */
const QUERY_TIMEOUT_MS = 30_000;

/** The brokered exec capability (from `MainModuleContext.exec`). */
type Exec = NonNullable<MainModuleContext['exec']>;

/**
 * Run `sf` via the brokered `ctx.exec` and return its stdout.
 *
 * Result mapping vs. the old `execFile` callback:
 *   - `ctx.exec` REJECTS on a spawn failure (sf missing / not on PATH) or a
 *     host watchdog kill (timeout / output-cap) — S3 semantics. We translate
 *     that reject into a single, renderer-friendly "sf CLI unavailable" error
 *     so the board surfaces a clean message instead of a raw ENOENT/timeout.
 *   - A process that RAN and exited non-zero RESOLVES with `code !== 0` and
 *     still prints JSON to stdout (sf's pattern). We return that stdout
 *     unchanged so the existing per-command JSON parsing can extract sf's own
 *     precise `message` (auth/validation errors), preserving prior behaviour.
 */
async function sfExec(
  exec: Exec,
  args: string[],
  log: MainModuleContext['log']
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  try {
    return await exec({ bin: 'sf', args, timeoutMs: QUERY_TIMEOUT_MS });
  } catch (err) {
    // S3 reject = sf never produced a result (not installed / not on PATH, or
    // killed by the watchdog). Distinct from a non-zero exit, which resolves.
    const detail = err instanceof Error ? err.message : String(err);
    log(`sf exec failed: ${detail}`);
    throw new Error('sf CLI unavailable — check that the Salesforce CLI is installed and authed (target-org "gus").');
  }
}

interface SfQueryResponse<T> {
  status: number;
  result?: { records?: T[] };
  message?: string;
}

/** A raw ADM_Work__c row as returned by `sf data query --json`. */
interface RawWork {
  Id: string;
  Name: string;
  Subject__c?: string;
  Status__c?: string;
  Priority__c?: string;
  RecordType?: { Name?: string } | null;
  Story_Points__c?: number | null;
  Sprint__c?: string | null;
  Sprint__r?: { Name?: string } | null;
  Scrum_Team__c?: string | null;
  Scrum_Team__r?: { Name?: string } | null;
  Assignee__c?: string | null;
  Assignee__r?: { Name?: string } | null;
  CreatedBy?: { Name?: string } | null;
  Product_Tag__r?: { Name?: string } | null;
  Epic__r?: { Name?: string } | null;
  LastModifiedDate?: string;
}

/** Extra fields fetched only for the detail view. */
interface RawWorkDetail extends RawWork {
  Details__c?: string | null;
  QA_Engineer__r?: { Name?: string } | null;
  Scheduled_Build__r?: { Name?: string } | null;
  Found_in_Build__r?: { Name?: string } | null;
  CreatedDate?: string;
}

/** A raw ContentDocumentLink row (file attached to a work item). */
interface RawContentLink {
  ContentDocumentId: string;
  ContentDocument?: {
    Title?: string | null;
    FileExtension?: string | null;
    ContentSize?: number | null;
    CreatedDate?: string | null;
    CreatedBy?: { Name?: string } | null;
  } | null;
}

/** A raw FeedItem (Chatter post) row. */
interface RawFeedItem {
  Id: string;
  Body?: string | null;
  Type?: string | null;
  CreatedDate?: string;
  CreatedBy?: { Name?: string } | null;
}

/**
 * Run `sf data query` and return parsed records. Throws (with the CLI's
 * own message when available) on non-zero exit or unparseable output, so the
 * renderer surfaces a real error instead of an empty board. A spawn failure /
 * watchdog kill is translated to the "sf CLI unavailable" error by `sfExec`.
 */
async function sfQuery<T>(exec: Exec, soql: string, log: MainModuleContext['log']): Promise<T[]> {
  const { stdout, stderr } = await sfExec(
    exec,
    ['data', 'query', '--target-org', TARGET_ORG, '--json', '-q', soql],
    log
  );
  // sf exits non-zero on query errors but still prints JSON to stdout;
  // prefer parsing that for a precise message before falling back.
  let parsed: SfQueryResponse<T> | undefined;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout) as SfQueryResponse<T>;
    } catch {
      /* fall through to error handling */
    }
  }
  if (parsed && parsed.status === 0) {
    return parsed.result?.records ?? [];
  }
  const msg = parsed?.message || stderr || 'sf data query failed';
  log(`query failed: ${msg}`);
  throw new Error(msg);
}

/**
 * Run `sf data update record` and resolve on success. Used by `setStatus`.
 * Rejects with the CLI's message so the renderer can surface (and the
 * optimistic UI can roll back) a rejected write.
 */
async function sfUpdateField(
  exec: Exec,
  recordId: string,
  field: string,
  value: string,
  log: MainModuleContext['log']
): Promise<void> {
  const { stdout, stderr } = await sfExec(
    exec,
    [
      'data',
      'update',
      'record',
      '--target-org',
      TARGET_ORG,
      '--sobject',
      'ADM_Work__c',
      '--record-id',
      recordId,
      '--values',
      `${field}=${value}`,
      '--json'
    ],
    log
  );
  let parsed: { status?: number; message?: string } | undefined;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      /* fall through */
    }
  }
  if (parsed && parsed.status === 0) {
    return;
  }
  const msg = parsed?.message || stderr || 'sf data update failed';
  log(`update failed (${recordId} ${field}): ${msg}`);
  throw new Error(msg);
}

/** Resolve the authed GUS user. Cached for the process lifetime. */
let identityCache: GusIdentity | null = null;

async function loadIdentity(exec: Exec, log: MainModuleContext['log']): Promise<GusIdentity> {
  if (identityCache) return identityCache;
  const { stdout } = await sfExec(
    exec,
    ['org', 'display', 'user', '--target-org', TARGET_ORG, '--json'],
    log
  );
  let parsed:
    | { status: number; result?: { username?: string; id?: string; instanceUrl?: string }; message?: string }
    | undefined;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      /* ignore */
    }
  }
  const r = parsed?.result;
  if (parsed?.status === 0 && r?.id && r.username) {
    identityCache = {
      username: r.username,
      userId: r.id,
      instanceUrl: r.instanceUrl || 'https://gus.my.salesforce.com'
    };
    return identityCache;
  }
  const msg = parsed?.message || 'sf org display user failed';
  log(`identity failed: ${msg}`);
  throw new Error(msg);
}

/** SOQL string-literal escape (single quotes + backslashes). */
function soqlEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function mapWork(r: RawWork): GusWorkItem {
  const status = r.Status__c ?? 'New';
  return {
    id: r.Id,
    name: r.Name,
    subject: r.Subject__c ?? '(no subject)',
    status,
    priority: r.Priority__c ?? undefined,
    type: r.RecordType?.Name ?? undefined,
    storyPoints: typeof r.Story_Points__c === 'number' ? r.Story_Points__c : undefined,
    sprintId: r.Sprint__c ?? undefined,
    sprintName: r.Sprint__r?.Name ?? undefined,
    teamId: r.Scrum_Team__c ?? undefined,
    teamName: r.Scrum_Team__r?.Name ?? undefined,
    assigneeId: r.Assignee__c ?? undefined,
    assignee: r.Assignee__r?.Name ?? undefined,
    author: r.CreatedBy?.Name ?? undefined,
    productTag: r.Product_Tag__r?.Name ?? undefined,
    epicName: r.Epic__r?.Name ?? undefined,
    lastModified: r.LastModifiedDate
  };
}

const WORK_FIELDS =
  'Id, Name, Subject__c, Status__c, Priority__c, RecordType.Name, Story_Points__c, ' +
  'Sprint__c, Sprint__r.Name, Scrum_Team__c, Scrum_Team__r.Name, ' +
  'Assignee__c, Assignee__r.Name, CreatedBy.Name, Product_Tag__r.Name, Epic__r.Name, LastModifiedDate';

/** Heavier field set for the single-record detail view. */
const WORK_DETAIL_FIELDS =
  WORK_FIELDS +
  ', Details__c, QA_Engineer__r.Name, ' +
  'Scheduled_Build__r.Name, Found_in_Build__r.Name, CreatedDate';

function mapWorkDetail(r: RawWorkDetail): GusWorkDetail {
  return {
    ...mapWork(r),
    detailsHtml: r.Details__c ?? undefined,
    qaEngineer: r.QA_Engineer__r?.Name ?? undefined,
    scheduledBuild: r.Scheduled_Build__r?.Name ?? undefined,
    foundInBuild: r.Found_in_Build__r?.Name ?? undefined,
    createdDate: r.CreatedDate
  };
}

/**
 * Parse a poll interval string (e.g. "2m", "30s", "1h") into milliseconds.
 * Mirrors src/shared/parse-every.ts pattern but extension-local to avoid core deps.
 * Returns null on invalid input; coerces below 1m up to 1m.
 */
export function parsePollEvery(every: string): number | null {
  const MIN_MS = 60_000; // 1 minute floor
  const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  const trimmed = (every ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    const ms = UNIT_MS[unit];
    if (!ms) return null;
    total += value * ms;
    consumed += match[0].length;
  }
  if (total <= 0 || consumed !== trimmed.length) return null;
  return Math.max(MIN_MS, Math.round(total));
}

/**
 * Substitute {{Field}} tokens in a prompt template with values from a work item.
 * E.g. "Investigate {{Name}} ({{Status__c}})" becomes "Investigate W-123 (New)".
 */
/**
 * Substitute `{{Field}}` tokens in a prompt template. Resolves each token
 * against the RAW Salesforce row FIRST (so a user writes the SF field names the
 * trigger's `fields` list and the panel hint use — `{{Name}}`, `{{Status__c}}`,
 * `{{Subject__c}}`), then falls back to the mapped {@link GusWorkItem}'s
 * convenience keys (`name`, `status`, `subject`). An unresolved token becomes
 * the empty string. Passing only the mapped item still resolves the lowercase
 * keys, so the function is usable without a raw row.
 */
export function substitutePrompt(
  template: string,
  item: GusWorkItem,
  raw?: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, field) => {
    const rawVal = raw ? raw[field] : undefined;
    const val = rawVal != null ? rawVal : (item as unknown as Record<string, unknown>)[field];
    return val != null ? String(val) : '';
  });
}

/**
 * CDC watcher state. Module-scoped so the teardown can clean up all timers.
 * Each armed trigger has a setInterval timer ID stored here.
 */
const cdcTimers = new Map<string, number>();

/**
 * Detect CDC matches by diffing fresh rows against last-seen state.
 * Pure function: takes raw query results + trigger config + last-seen map,
 * returns matched work items + updated last-seen map.
 */
export function detectCdcMatches(
  rows: RawWork[],
  trigger: CdcTrigger,
  lastSeen: Record<string, { modstamp: string; fields: Record<string, unknown> }>
): {
  matches: GusWorkItem[];
  /** Raw SF row for each matched item, keyed by id — so prompt-template tokens
   *  can resolve against SF field names (`Status__c`) the panel advertises. */
  rawById: Record<string, Record<string, unknown>>;
  nextLastSeen: Record<string, { modstamp: string; fields: Record<string, unknown> }>;
} {
  const matches: GusWorkItem[] = [];
  const rawById: Record<string, Record<string, unknown>> = {};
  const nextLastSeen = { ...lastSeen };

  for (const row of rows) {
    const id = row.Id;
    const modstamp = (row as unknown as Record<string, unknown>).SystemModstamp as string | undefined;
    const seen = nextLastSeen[id];
    const isNew = !seen;
    const isUpdate = seen && seen.modstamp !== modstamp;

    // Check if any watched field changed (UPDATE filter).
    let fieldChanged = false;
    if (isUpdate) {
      for (const field of trigger.fields) {
        const oldVal = seen.fields[field];
        const newVal = (row as unknown as Record<string, unknown>)[field];
        if (oldVal !== newVal) {
          fieldChanged = true;
          break;
        }
      }
    }

    // Match if: (CREATE and new) or (UPDATE and changed field).
    const matchCreate = trigger.changeType.includes('CREATE') && isNew;
    const matchUpdate = trigger.changeType.includes('UPDATE') && isUpdate && fieldChanged;
    if (matchCreate || matchUpdate) {
      matches.push(mapWork(row));
      rawById[id] = row as unknown as Record<string, unknown>;
    }

    // Update last-seen for this row.
    nextLastSeen[id] = {
      modstamp: modstamp ?? '',
      fields: trigger.fields.reduce((acc, f) => {
        acc[f] = (row as unknown as Record<string, unknown>)[f];
        return acc;
      }, {} as Record<string, unknown>)
    };
  }

  return { matches, rawById, nextLastSeen };
}

/**
 * Pending CDC matches (requireConfirm=true). Renderer fetches these via
 * cdcGetPending and displays Launch buttons. Module-scoped so it survives
 * multiple capability calls.
 */
let pendingMatches: CdcPendingMatch[] = [];

export const gusMainModule: MainModule = {
  id: 'gus',
  setup(ctx) {
    const { log } = ctx;
    // gus runs `sf` solely through the brokered exec capability. Built-ins get
    // an ungated in-process exec (wired in the module host); a disk extension
    // gets the permission-gated broker exec. If neither provided one, every
    // capability fails cleanly rather than silently returning empty data.
    const exec = ctx.exec;
    if (!exec) {
      throw new Error('gus: ctx.exec capability is unavailable; cannot run the sf CLI.');
    }

    return {
      async whoami(): Promise<GusIdentity> {
        return loadIdentity(exec, log);
      },

      /**
       * Work items assigned to the current user.
       * opts.includeClosed — include terminal statuses (default false).
       * opts.sprintId       — restrict to one sprint.
       */
      async listWork(opts?: { includeClosed?: boolean; sprintId?: string }): Promise<GusWorkItem[]> {
        const { userId } = await loadIdentity(exec, log);
        const where: string[] = [`Assignee__r.Id = '${soqlEscape(userId)}'`];
        if (opts?.sprintId) {
          where.push(`Sprint__c = '${soqlEscape(opts.sprintId)}'`);
        }
        const soql =
          `SELECT ${WORK_FIELDS} FROM ADM_Work__c WHERE ${where.join(' AND ')} ` +
          `ORDER BY LastModifiedDate DESC LIMIT 500`;
        const rows = await sfQuery<RawWork>(exec, soql, log);
        const items = rows.map(mapWork);
        // Filter closed statuses in JS so the many `Closed - *` variants are
        // all caught (a SOQL NOT IN list can't enumerate them reliably).
        return opts?.includeClosed ? items : items.filter((it) => !isClosedStatus(it.status));
      },

      /** Sprints the user has open work in, most recent first. */
      async listSprints(): Promise<GusSprint[]> {
        const { userId } = await loadIdentity(exec, log);
        // Pull open work and aggregate sprints in JS — keeps the closed-status
        // definition in one place (isClosedStatus) instead of a SOQL list.
        const soql =
          `SELECT Status__c, Sprint__c, Sprint__r.Name, Sprint__r.Start_Date__c, Sprint__r.End_Date__c ` +
          `FROM ADM_Work__c WHERE Assignee__r.Id = '${soqlEscape(userId)}' AND Sprint__c != null ` +
          `LIMIT 2000`;
        const rows = await sfQuery<RawWork & { Sprint__r?: { Name?: string; Start_Date__c?: string; End_Date__c?: string } | null }>(
          exec,
          soql,
          log
        );
        const byId = new Map<string, GusSprint>();
        for (const r of rows) {
          if (!r.Sprint__c || isClosedStatus(r.Status__c ?? '')) continue;
          const existing = byId.get(r.Sprint__c);
          if (existing) {
            existing.openCount += 1;
          } else {
            byId.set(r.Sprint__c, {
              id: r.Sprint__c,
              name: r.Sprint__r?.Name ?? '(unnamed sprint)',
              startDate: r.Sprint__r?.Start_Date__c ?? undefined,
              endDate: r.Sprint__r?.End_Date__c ?? undefined,
              openCount: 1
            });
          }
        }
        return Array.from(byId.values()).sort((a, b) =>
          (b.startDate ?? '').localeCompare(a.startDate ?? '')
        );
      },

      /**
       * Scrum teams the current user has open work on — the candidate set for
       * the backlog team picker. `openCount` is the user's open work on each
       * team (a relevance signal), not the team's full backlog size.
       */
      async listTeams(): Promise<GusTeam[]> {
        const { userId } = await loadIdentity(exec, log);
        const soql =
          `SELECT Status__c, Scrum_Team__c, Scrum_Team__r.Name FROM ADM_Work__c ` +
          `WHERE Assignee__r.Id = '${soqlEscape(userId)}' AND Scrum_Team__c != null LIMIT 2000`;
        const rows = await sfQuery<RawWork>(exec, soql, log);
        const byId = new Map<string, GusTeam>();
        for (const r of rows) {
          if (!r.Scrum_Team__c || isClosedStatus(r.Status__c ?? '')) continue;
          const existing = byId.get(r.Scrum_Team__c);
          if (existing) {
            existing.openCount += 1;
          } else {
            byId.set(r.Scrum_Team__c, {
              id: r.Scrum_Team__c,
              name: r.Scrum_Team__r?.Name ?? '(unnamed team)',
              openCount: 1
            });
          }
        }
        return Array.from(byId.values()).sort((a, b) => b.openCount - a.openCount);
      },

      /**
       * A team's backlog: open work on the team that isn't scheduled into any
       * sprint (`Sprint__c = null`). Team-wide (not assignee-scoped) and
       * read-only in the UI. Ordered by Sprint_Rank__c (the team's manual
       * triage order) so the most-ready items surface first.
       */
      async listBacklog(opts: { teamId: string; includeClosed?: boolean }): Promise<GusWorkItem[]> {
        const teamId = opts?.teamId;
        if (typeof teamId !== 'string' || !teamId) throw new Error('Missing team id');
        const soql =
          `SELECT ${WORK_FIELDS} FROM ADM_Work__c ` +
          `WHERE Scrum_Team__c = '${soqlEscape(teamId)}' AND Sprint__c = null ` +
          `ORDER BY Sprint_Rank__c NULLS LAST, LastModifiedDate DESC LIMIT 500`;
        const rows = await sfQuery<RawWork>(exec, soql, log);
        const items = rows.map(mapWork);
        return opts?.includeClosed ? items : items.filter((it) => !isClosedStatus(it.status));
      },

      /** Full detail for one work item, fetched when a card is opened. */
      async getWork(id: string): Promise<GusWorkDetail | null> {
        if (typeof id !== 'string' || !id) return null;
        const soql =
          `SELECT ${WORK_DETAIL_FIELDS} FROM ADM_Work__c ` +
          `WHERE Id = '${soqlEscape(id)}' LIMIT 1`;
        const rows = await sfQuery<RawWorkDetail>(exec, soql, log);
        return rows.length ? mapWorkDetail(rows[0]) : null;
      },

      /**
       * Write a new `Status__c` on a work item (drag/drop between columns).
       * Returns the status on success; throws on validation-rule rejection so
       * the renderer can roll back its optimistic move and toast the error.
       */
      async setStatus(id: string, status: string): Promise<{ ok: true; status: string }> {
        if (typeof id !== 'string' || !id) throw new Error('Missing work item id');
        if (typeof status !== 'string' || !status) throw new Error('Missing status');
        await sfUpdateField(exec, id, 'Status__c', `'${soqlEscape(status)}'`, log);
        return { ok: true, status };
      },

      /** Recent comments/chatter on a work item (ADM_Comment__c). */
      async getChatter(id: string): Promise<GusChatterPost[]> {
        if (typeof id !== 'string' || !id) return [];
        const soql =
          `SELECT Id, Body__c, CreatedDate, CreatedBy.Name FROM ADM_Comment__c ` +
          `WHERE Work__c = '${soqlEscape(id)}' ORDER BY CreatedDate DESC LIMIT 50`;
        const rows = await sfQuery<RawFeedItem & { Body__c?: string | null }>(exec, soql, log);
        return rows
          .filter((r) => (r.Body__c ?? '').trim())
          .map((r) => ({
            id: r.Id,
            body: r.Body__c ?? '',
            author: r.CreatedBy?.Name ?? 'Unknown',
            createdDate: r.CreatedDate ?? ''
          }));
      },

      /** Files attached to a work item (ContentDocument via ContentDocumentLink). */
      async getFiles(id: string): Promise<GusAttachment[]> {
        if (typeof id !== 'string' || !id) return [];
        const soql =
          `SELECT ContentDocumentId, ContentDocument.Title, ContentDocument.FileExtension, ` +
          `ContentDocument.ContentSize, ContentDocument.CreatedDate, ContentDocument.CreatedBy.Name ` +
          `FROM ContentDocumentLink WHERE LinkedEntityId = '${soqlEscape(id)}' LIMIT 100`;
        const rows = await sfQuery<RawContentLink>(exec, soql, log);
        return rows.map((r) => ({
          id: r.ContentDocumentId,
          title: r.ContentDocument?.Title ?? '(untitled)',
          ext: r.ContentDocument?.FileExtension ?? undefined,
          size: typeof r.ContentDocument?.ContentSize === 'number' ? r.ContentDocument.ContentSize : undefined,
          author: r.ContentDocument?.CreatedBy?.Name ?? undefined,
          createdDate: r.ContentDocument?.CreatedDate ?? undefined
        }));
      },

      /**
       * CDC capabilities — poll-based trigger watcher. The renderer calls cdcArm
       * on mount to start watchers for enabled triggers; cdcDisarm to stop them.
       */

      /** List all CDC triggers (from ctx.storage). */
      async cdcListTriggers(): Promise<CdcTrigger[]> {
        const triggers = (await ctx.storage.get<CdcTrigger[]>('cdcTriggers')) ?? [];
        return triggers;
      },

      /** Save/update a trigger. Arms it if it's enabled. */
      async cdcSaveTrigger(trigger: CdcTrigger): Promise<{ ok: true }> {
        const triggers = (await ctx.storage.get<CdcTrigger[]>('cdcTriggers')) ?? [];
        const idx = triggers.findIndex((t) => t.id === trigger.id);
        if (idx >= 0) {
          triggers[idx] = trigger;
        } else {
          triggers.push(trigger);
        }
        ctx.storage.set('cdcTriggers', triggers);

        // Re-arm if enabled; disarm if disabled.
        if (trigger.enabled) {
          cdcArm(trigger, exec, ctx, log);
        } else {
          cdcDisarm(trigger.id);
        }
        return { ok: true };
      },

      /** Delete a trigger (disarms it first). */
      async cdcDeleteTrigger(id: string): Promise<{ ok: true }> {
        cdcDisarm(id);
        const triggers = (await ctx.storage.get<CdcTrigger[]>('cdcTriggers')) ?? [];
        ctx.storage.set('cdcTriggers', triggers.filter((t) => t.id !== id));
        return { ok: true };
      },

      /** Arm all enabled triggers (called by renderer on mount). */
      async cdcArmAll(): Promise<{ ok: true }> {
        const triggers = (await ctx.storage.get<CdcTrigger[]>('cdcTriggers')) ?? [];
        for (const t of triggers) {
          if (t.enabled) {
            cdcArm(t, exec, ctx, log);
          }
        }
        return { ok: true };
      },

      /** Disarm all triggers (e.g. before hot-reload). */
      async cdcDisarmAll(): Promise<{ ok: true }> {
        for (const id of cdcTimers.keys()) {
          cdcDisarm(id);
        }
        return { ok: true };
      },

      /** Get pending matches (requireConfirm=true queue). */
      async cdcGetPending(): Promise<CdcPendingMatch[]> {
        return pendingMatches;
      },

      /** Clear a pending match (after user launches or dismisses it). */
      async cdcClearPending(matchId: string): Promise<{ ok: true }> {
        pendingMatches = pendingMatches.filter((m) => m.matchId !== matchId);
        return { ok: true };
      }
    };
  },

  /**
   * Teardown: clean up all CDC timers. Called when the extension is disabled,
   * uninstalled, or hot-reloaded. Prevents orphaned timers.
   */
  teardown() {
    for (const timerId of cdcTimers.values()) {
      clearInterval(timerId);
    }
    cdcTimers.clear();
  }
};

/**
 * Arm a CDC trigger: start a setInterval that polls the SOQL query at the
 * trigger's pollEvery rate, diffs against last-seen, and fires on changes.
 */
function cdcArm(
  trigger: CdcTrigger,
  exec: NonNullable<MainModuleContext['exec']>,
  ctx: MainModuleContext,
  log: MainModuleContext['log']
): void {
  // Disarm first if already armed (re-arm on config change).
  cdcDisarm(trigger.id);

  const intervalMs = parsePollEvery(trigger.pollEvery);
  if (!intervalMs) {
    log(`CDC trigger ${trigger.id}: invalid pollEvery "${trigger.pollEvery}"`);
    return;
  }

  const poll = async () => {
    try {
      // Resolve identity for 'me' scope.
      const identity = await loadIdentity(exec, log);

      // Build SOQL: SELECT watched fields + SystemModstamp WHERE scope.
      const fields = ['Id', 'Name', 'SystemModstamp', ...trigger.fields];
      const uniqueFields = Array.from(new Set(fields));
      const where: string[] = [];
      if (trigger.scope.assignee === 'me') {
        where.push(`Assignee__r.Id = '${soqlEscape(identity.userId)}'`);
      }
      if (trigger.scope.scrumTeam) {
        where.push(`Scrum_Team__c = '${soqlEscape(trigger.scope.scrumTeam)}'`);
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const soql = `SELECT ${uniqueFields.join(', ')} FROM ${trigger.object} ${whereClause} ORDER BY SystemModstamp DESC LIMIT 100`;

      const rows = await sfQuery<RawWork & { SystemModstamp?: string }>(exec, soql, log);

      // Load last-seen state for this trigger.
      const lastSeenAll = (await ctx.storage.get<CdcLastSeen>('cdcLastSeen')) ?? {};
      const lastSeen = lastSeenAll[trigger.id] ?? {};

      // Detect matches and compute next last-seen state.
      const { matches, rawById, nextLastSeen } = detectCdcMatches(rows, trigger, lastSeen);

      // Persist updated last-seen.
      lastSeenAll[trigger.id] = nextLastSeen;
      ctx.storage.set('cdcLastSeen', lastSeenAll);

      // Fire: queue or notify for each match.
      if (matches.length > 0) {
        log(`CDC trigger ${trigger.id}: ${matches.length} match(es)`);
        for (const item of matches) {
          const prompt = substitutePrompt(trigger.launch.promptTemplate, item, rawById[item.id]);
          if (trigger.requireConfirm) {
            // Queue for renderer to display.
            pendingMatches.push({
              matchId: `${trigger.id}-${item.id}-${Date.now()}`,
              triggerId: trigger.id,
              triggerName: trigger.name,
              workItem: item,
              resolvedPrompt: prompt,
              personaId: trigger.launch.personaId,
              detectedAt: new Date().toISOString()
            });
          } else {
            // Auto-launch note: the MAIN module can't call host.launchSession
            // (that's renderer-only). For requireConfirm=false, the renderer
            // must poll cdcGetPending and auto-launch or we need a different
            // mechanism. For v1, we REQUIRE requireConfirm=true (default).
            log(`CDC trigger ${trigger.id}: auto-launch not implemented (requireConfirm must be true)`);
          }
        }
      }
    } catch (err) {
      log(`CDC trigger ${trigger.id} poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Poll immediately, then on interval.
  void poll();
  const timerId = setInterval(() => void poll(), intervalMs) as unknown as number;
  cdcTimers.set(trigger.id, timerId);
  log(`CDC trigger ${trigger.id} armed (poll every ${intervalMs}ms)`);
}

/**
 * Disarm a CDC trigger: clear its interval timer.
 */
function cdcDisarm(id: string): void {
  const timerId = cdcTimers.get(id);
  if (timerId) {
    clearInterval(timerId);
    cdcTimers.delete(id);
  }
}
