/**
 * Shared Zana domain types — used by both the main capability (which fills
 * them from on-disk `.zana/` JSON files) and the renderer panel (which renders
 * them). Plain data only; safe to import from either process (no node/react).
 *
 * Zana stores work-tracking as plain JSON under a `.zana/` dir — there is no
 * daemon or MCP to talk to. The main module reads those files directly and
 * shapes them into the types below.
 */

/** One comment on a ticket. Best-effort: `comments[]` is often empty. */
export interface ZanaComment {
  /** Display name of the author, when recorded. */
  author?: string;
  /** Comment text. */
  body: string;
  /** ISO timestamp the comment was created. */
  createdAt?: string;
}

/** One Zana ticket (`.zana/tickets/<uuid>/ticket.json`), lightly normalised. */
export interface ZanaTicket {
  /** Stable ticket id (the dir uuid / `ticket.json` `id`). */
  id: string;
  title: string;
  description?: string;
  /** Free-string status, e.g. `backlog`, `in-progress`, `done`. */
  status: string;
  priority?: string;
  /** Display name of the assignee, when set. */
  assigneeName?: string;
  /** Id of the sprint this ticket belongs to, when set. */
  sprintId?: string;
  /** Free-form labels. Always an array (defaults to `[]`). */
  labels: string[];
  /** Ids of tickets blocking this one. Always an array (defaults to `[]`). */
  blockedBy: string[];
  /** Ticket type, e.g. `bug`, `feature`, `chore`. */
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  /** ISO timestamp the ticket was closed; null/absent while open. */
  closedAt?: string;
  /** Short summary written when the ticket was resolved. */
  resultSummary?: string;
  /** Inline comments, when present. */
  comments?: ZanaComment[];
}

/**
 * A Zana sprint (`.zana/sprints/_index.json` entry). Sprints are lightweight;
 * a sprint's tickets are found by matching `ZanaTicket.sprintId`, so the
 * counts below are derived in the main module rather than stored on disk.
 */
export interface ZanaSprint {
  id: string;
  status?: string;
  updatedAt?: string;
  /** Display name (falls back to a short form of the id when unnamed). */
  name?: string;
  /** Total tickets matching this sprint id (derived). */
  ticketCount?: number;
  /** Of those, how many are still open (derived). */
  openCount?: number;
}

/**
 * A generated documentation artifact (`.zana/artifacts/<uuid>.json`). The
 * `content` markdown can be large, so the snapshot ships artifacts with
 * content inlined but the panel may also fetch a single one on demand.
 */
export interface ZanaArtifact {
  id: string;
  title: string;
  /** Artifact type, e.g. `design-doc`, `requirement-spec`, `architecture-doc`. */
  type?: string;
  /** Markdown body. May be empty when the file omits it. */
  content: string;
  /** Free-form tags. Always an array (defaults to `[]`). */
  tags: string[];
  /** Who/what generated the artifact. */
  createdBy?: string;
  /** Ticket ids this artifact documents. Always an array (defaults to `[]`). */
  linkedTickets: string[];
  createdAt?: string;
}

/** Aggregate metrics computed over the loaded tickets/sprints/artifacts. */
export interface ZanaKpis {
  totalTickets: number;
  openTickets: number;
  closedTickets: number;
  /** Open tickets that have at least one entry in `blockedBy`. */
  blockedTickets: number;
  /** Ticket counts keyed by raw status string. */
  byStatus: Record<string, number>;
  /** Ticket counts keyed by priority (tickets without a priority are skipped). */
  byPriority: Record<string, number>;
  sprintCount: number;
  artifactCount: number;
  /** Tickets whose `closedAt` falls within the last 7 days. */
  throughput7d?: number;
}

/**
 * Describes where a snapshot's data was read from. A workspace can have its
 * own `.zana/`; otherwise the main module falls back to the global `~/.zana/`.
 */
export interface ZanaSource {
  /** `project` = a workspace `.zana/`; `global` = `~/.zana/`. */
  kind: 'project' | 'global';
  /** Human label for the source toggle (notes a fallback when relevant). */
  label: string;
  /** Absolute path to the resolved `.zana/` dir. */
  path: string;
}

/** Everything the panel needs for one render, from one source. */
export interface ZanaSnapshot {
  source: ZanaSource;
  kpis: ZanaKpis;
  /** Tickets sorted by `updatedAt` descending. */
  tickets: ZanaTicket[];
  sprints: ZanaSprint[];
  /** Artifacts sorted by `createdAt` descending. */
  artifacts: ZanaArtifact[];
}

/** Statuses we treat as terminal/closed when `closedAt` isn't set. */
const CLOSED_STATUSES = new Set([
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
]);

/**
 * Whether a ticket is closed. A non-null `closedAt` always wins; otherwise the
 * raw status is matched (case-insensitively) against a known closed-set.
 */
export function isClosedZanaStatus(status: string, closedAt?: string | null): boolean {
  if (closedAt) return true;
  return CLOSED_STATUSES.has((status ?? '').trim().toLowerCase());
}
