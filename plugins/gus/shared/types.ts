/**
 * Shared GUS domain types — used by both the main capability (which fills
 * them from SOQL rows) and the renderer panel (which renders them). Plain
 * data only; safe to import from either process.
 */

/** One GUS work item (ADM_Work__c), flattened from the SOQL row. */
export interface GusWorkItem {
  /** Salesforce record id (a07…). */
  id: string;
  /** Human work number, e.g. `W-22860481`. Used to build the GUS URL. */
  name: string;
  subject: string;
  /** Raw GUS status, e.g. `In Progress`. Drives which board column it sits in. */
  status: string;
  priority?: string;
  /** Record type label: Bug / User Story / Investigation … */
  type?: string;
  storyPoints?: number;
  sprintId?: string;
  sprintName?: string;
  productTag?: string;
  epicName?: string;
  lastModified?: string;
}

/**
 * Full detail for a single work item, fetched on demand when the user opens
 * a card. Extends the board item with the heavier fields (rich-text details,
 * people, builds, timestamps) we don't fetch for every card.
 */
export interface GusWorkDetail extends GusWorkItem {
  /** Rich-text body (`Details__c`) as raw HTML; sanitised before render. */
  detailsHtml?: string;
  assignee?: string;
  qaEngineer?: string;
  scheduledBuild?: string;
  foundInBuild?: string;
  createdDate?: string;
}

/** One GUS comment/chatter post (ADM_Comment__c) on a work item. */
export interface GusChatterPost {
  id: string;
  /** Comment body (`Body__c`). May contain newlines; rendered as plain text. */
  body: string;
  author: string;
  createdDate: string;
}

/** One file attached to a work item (ContentDocument via ContentDocumentLink). */
export interface GusAttachment {
  /** ContentDocumentId — opens the file preview at `<instanceUrl>/<id>`. */
  id: string;
  title: string;
  /** File extension without dot, e.g. `png`, `mp4`, `txt`. */
  ext?: string;
  /** Size in bytes. */
  size?: number;
  author?: string;
  createdDate?: string;
}

/** A sprint the user has work in (ADM_Sprint__c), with a derived count. */
export interface GusSprint {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  /** Open work items the current user has in this sprint. */
  openCount: number;
}

export interface GusIdentity {
  username: string;
  userId: string;
  /** `https://gus.my.salesforce.com` — base for record links. */
  instanceUrl: string;
}

/**
 * A board column. Each column maps to one **exact** `Status__c` value (so a
 * drop writes that precise status — no ambiguity). `droppable` columns accept
 * dragged cards; the terminal `Closed` column does not, because closing a GUS
 * work item needs a specific sub-reason, better chosen in GUS itself.
 *
 * The synthetic `OTHER_COLUMN` (status `null`) catches every status without a
 * column — the many `Closed - *` variants, `Rejected`, `Never`, etc. — so
 * nothing silently disappears. It's never a drop target.
 */
export interface BoardColumn {
  /** Stable key used for grouping + CSS (`gus-column--<key>`). */
  key: string;
  title: string;
  /** Exact `Status__c` this column represents, or null for the catch-all. */
  status: string | null;
  droppable: boolean;
}

export const OTHER_COLUMN_KEY = 'other';

/**
 * Columns mirroring the team's GUS board (see the user's board screenshot),
 * each pinned to an exact status. Left-to-right workflow order.
 */
export const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'new', title: 'New', status: 'New', droppable: true },
  { key: 'in-progress', title: 'In Progress', status: 'In Progress', droppable: true },
  { key: 'review', title: 'Ready for Review', status: 'Ready for Review', droppable: true },
  { key: 'fixed', title: 'Fixed', status: 'Fixed', droppable: true },
  { key: 'qa', title: 'QA In Progress', status: 'QA In Progress', droppable: true },
  { key: 'completed', title: 'Completed', status: 'Completed', droppable: true },
  { key: 'closed', title: 'Closed', status: 'Closed', droppable: false }
];

/** The catch-all column for statuses without a dedicated column. */
export const OTHER_COLUMN: BoardColumn = {
  key: OTHER_COLUMN_KEY,
  title: 'Other',
  status: null,
  droppable: false
};

/** Lower-cased status → column key, for fast grouping. Built once. */
const STATUS_TO_KEY = new Map<string, string>(
  BOARD_COLUMNS.filter((c) => c.status).map((c) => [c.status!.toLowerCase(), c.key])
);

/** Which column key a work item's status belongs to (case-insensitive). */
export function columnKeyForStatus(status: string): string {
  return STATUS_TO_KEY.get(status.trim().toLowerCase()) ?? OTHER_COLUMN_KEY;
}

/** Statuses we treat as terminal/closed for the default (open-only) fetch. */
export function isClosedStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return (
    s === 'closed' ||
    s.startsWith('closed -') ||
    s === 'rejected' ||
    s === 'never' ||
    s === 'duplicate' ||
    s === 'not a bug' ||
    s === 'not reproducible' ||
    s === 'inactive' ||
    s === 'deferred'
  );
}
