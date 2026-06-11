/**
 * GUS module — main process side.
 *
 * Fetches the current user's GUS work items and sprints by shelling out to
 * the Salesforce CLI (`sf`) against the `gus` target-org. This reuses the
 * user's existing CLI auth — no OAuth flow or stored secrets in the app.
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

import { execFile } from 'node:child_process';
import type { MainModule, MainModuleContext } from '@cctc/extension-sdk/main';
import {
  type GusIdentity,
  type GusSprint,
  type GusTeam,
  type GusWorkItem,
  type GusWorkDetail,
  type GusChatterPost,
  type GusAttachment,
  isClosedStatus
} from '../shared/types.js';

/** GUS target-org alias. The user authed this as `gus` in the sf CLI. */
const TARGET_ORG = 'gus';
/** sf queries can be slow on a cold org; give them room but bound them. */
const QUERY_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

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
 * Run `sf data query` and return parsed records. Rejects (with the CLI's
 * own message when available) on non-zero exit or unparseable output, so the
 * renderer surfaces a real error instead of an empty board.
 */
function sfQuery<T>(soql: string, log: MainModuleContext['log']): Promise<T[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'sf',
      ['data', 'query', '--target-org', TARGET_ORG, '--json', '-q', soql],
      { timeout: QUERY_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        // sf exits non-zero on query errors but still prints JSON to stdout;
        // prefer parsing that for a precise message before falling back.
        let parsed: SfQueryResponse<T> | undefined;
        if (stdout) {
          try {
            parsed = JSON.parse(stdout) as SfQueryResponse<T>;
          } catch {
            /* fall through to err handling */
          }
        }
        if (parsed && parsed.status === 0) {
          resolve(parsed.result?.records ?? []);
          return;
        }
        const msg =
          parsed?.message ||
          (err ? err.message : '') ||
          stderr ||
          'sf data query failed';
        log(`query failed: ${msg}`);
        reject(new Error(msg));
      }
    );
  });
}

/**
 * Run `sf data update record` and resolve on success. Used by `setStatus`.
 * Rejects with the CLI's message so the renderer can surface (and the
 * optimistic UI can roll back) a rejected write.
 */
function sfUpdateField(
  recordId: string,
  field: string,
  value: string,
  log: MainModuleContext['log']
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'sf',
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
      { timeout: QUERY_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        let parsed: { status?: number; message?: string } | undefined;
        if (stdout) {
          try {
            parsed = JSON.parse(stdout);
          } catch {
            /* fall through */
          }
        }
        if (parsed && parsed.status === 0) {
          resolve();
          return;
        }
        const msg = parsed?.message || (err ? err.message : '') || stderr || 'sf data update failed';
        log(`update failed (${recordId} ${field}): ${msg}`);
        reject(new Error(msg));
      }
    );
  });
}

/** Resolve the authed GUS user. Cached for the process lifetime. */
let identityCache: GusIdentity | null = null;

function loadIdentity(log: MainModuleContext['log']): Promise<GusIdentity> {
  if (identityCache) return Promise.resolve(identityCache);
  return new Promise((resolve, reject) => {
    execFile(
      'sf',
      ['org', 'display', 'user', '--target-org', TARGET_ORG, '--json'],
      { timeout: QUERY_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
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
          resolve(identityCache);
          return;
        }
        const msg = parsed?.message || (err ? err.message : '') || 'sf org display user failed';
        log(`identity failed: ${msg}`);
        reject(new Error(msg));
      }
    );
  });
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

export const gusMainModule: MainModule = {
  id: 'gus',
  setup(ctx) {
    const { log } = ctx;

    return {
      async whoami(): Promise<GusIdentity> {
        return loadIdentity(log);
      },

      /**
       * Work items assigned to the current user.
       * opts.includeClosed — include terminal statuses (default false).
       * opts.sprintId       — restrict to one sprint.
       */
      async listWork(opts?: { includeClosed?: boolean; sprintId?: string }): Promise<GusWorkItem[]> {
        const { userId } = await loadIdentity(log);
        const where: string[] = [`Assignee__r.Id = '${soqlEscape(userId)}'`];
        if (opts?.sprintId) {
          where.push(`Sprint__c = '${soqlEscape(opts.sprintId)}'`);
        }
        const soql =
          `SELECT ${WORK_FIELDS} FROM ADM_Work__c WHERE ${where.join(' AND ')} ` +
          `ORDER BY LastModifiedDate DESC LIMIT 500`;
        const rows = await sfQuery<RawWork>(soql, log);
        const items = rows.map(mapWork);
        // Filter closed statuses in JS so the many `Closed - *` variants are
        // all caught (a SOQL NOT IN list can't enumerate them reliably).
        return opts?.includeClosed ? items : items.filter((it) => !isClosedStatus(it.status));
      },

      /** Sprints the user has open work in, most recent first. */
      async listSprints(): Promise<GusSprint[]> {
        const { userId } = await loadIdentity(log);
        // Pull open work and aggregate sprints in JS — keeps the closed-status
        // definition in one place (isClosedStatus) instead of a SOQL list.
        const soql =
          `SELECT Status__c, Sprint__c, Sprint__r.Name, Sprint__r.Start_Date__c, Sprint__r.End_Date__c ` +
          `FROM ADM_Work__c WHERE Assignee__r.Id = '${soqlEscape(userId)}' AND Sprint__c != null ` +
          `LIMIT 2000`;
        const rows = await sfQuery<RawWork & { Sprint__r?: { Name?: string; Start_Date__c?: string; End_Date__c?: string } | null }>(
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
        const { userId } = await loadIdentity(log);
        const soql =
          `SELECT Status__c, Scrum_Team__c, Scrum_Team__r.Name FROM ADM_Work__c ` +
          `WHERE Assignee__r.Id = '${soqlEscape(userId)}' AND Scrum_Team__c != null LIMIT 2000`;
        const rows = await sfQuery<RawWork>(soql, log);
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
        const rows = await sfQuery<RawWork>(soql, log);
        const items = rows.map(mapWork);
        return opts?.includeClosed ? items : items.filter((it) => !isClosedStatus(it.status));
      },

      /** Full detail for one work item, fetched when a card is opened. */
      async getWork(id: string): Promise<GusWorkDetail | null> {
        if (typeof id !== 'string' || !id) return null;
        const soql =
          `SELECT ${WORK_DETAIL_FIELDS} FROM ADM_Work__c ` +
          `WHERE Id = '${soqlEscape(id)}' LIMIT 1`;
        const rows = await sfQuery<RawWorkDetail>(soql, log);
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
        await sfUpdateField(id, 'Status__c', `'${soqlEscape(status)}'`, log);
        return { ok: true, status };
      },

      /** Recent comments/chatter on a work item (ADM_Comment__c). */
      async getChatter(id: string): Promise<GusChatterPost[]> {
        if (typeof id !== 'string' || !id) return [];
        const soql =
          `SELECT Id, Body__c, CreatedDate, CreatedBy.Name FROM ADM_Comment__c ` +
          `WHERE Work__c = '${soqlEscape(id)}' ORDER BY CreatedDate DESC LIMIT 50`;
        const rows = await sfQuery<RawFeedItem & { Body__c?: string | null }>(soql, log);
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
        const rows = await sfQuery<RawContentLink>(soql, log);
        return rows.map((r) => ({
          id: r.ContentDocumentId,
          title: r.ContentDocument?.Title ?? '(untitled)',
          ext: r.ContentDocument?.FileExtension ?? undefined,
          size: typeof r.ContentDocument?.ContentSize === 'number' ? r.ContentDocument.ContentSize : undefined,
          author: r.ContentDocument?.CreatedBy?.Name ?? undefined,
          createdDate: r.ContentDocument?.CreatedDate ?? undefined
        }));
      }
    };
  }
};
