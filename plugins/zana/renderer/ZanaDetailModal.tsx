/**
 * Detail modal for a single Zana ticket OR artifact. Opens when a card is
 * clicked. A ticket renders its facts (status/priority/labels/assignee/sprint/
 * blockedBy), description, result summary and comments directly from the
 * already-loaded snapshot record — tickets are small, so there is no second
 * fetch. An artifact lazy-loads its full markdown `content` via
 * `host.call('getArtifact', …)` (the snapshot may ship artifacts with trimmed
 * content) and renders it with the app's shared markdown pipeline.
 *
 * Follows the app's modal convention (`palette-backdrop` + stop-propagation +
 * Escape to close), matching GusDetailModal / ShortcutsHelp.
 */

import { useEffect, useState } from 'react';
import {
  X,
  Loader2,
  MessageSquare,
  Tag,
  Ban,
  FileText,
  Ticket as TicketIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ModuleHost } from '../../../src/shared/module-api';
import type { ZanaArtifact, ZanaSprint, ZanaTicket } from '../shared/types';
import { unwrapBareFence } from '../../../src/renderer/util/markdown';

/** Either kind of record the modal can show, tagged by `kind`. */
export type ZanaSelection =
  | { kind: 'ticket'; ticket: ZanaTicket }
  | { kind: 'artifact'; artifact: ZanaArtifact };

interface Props {
  host: ModuleHost;
  selection: ZanaSelection;
  /** Resolved sprints, so a ticket can show its sprint name not just the id. */
  sprints: ZanaSprint[];
  /** Source coords for fetching an artifact's full content. */
  projectPath?: string;
  useGlobal: boolean;
  onClose: () => void;
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Shared markdown renderer — mirrors InboxDetail's MarkdownContent. */
function Markdown({ text }: { text: string }) {
  const body = unwrapBareFence(text);
  return (
    <div className="inbox-md zana-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          table: (props) => (
            <div className="zana-md-table-wrap">
              <table {...props} />
            </div>
          )
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function ZanaDetailModal({
  host,
  selection,
  sprints,
  projectPath,
  useGlobal,
  onClose
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="gus-modal zana-modal"
        role="dialog"
        aria-modal="true"
        aria-label={selection.kind === 'ticket' ? selection.ticket.title : selection.artifact.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {selection.kind === 'ticket' ? (
          <TicketDetail ticket={selection.ticket} sprints={sprints} onClose={onClose} />
        ) : (
          <ArtifactDetail
            host={host}
            artifact={selection.artifact}
            projectPath={projectPath}
            useGlobal={useGlobal}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ── Ticket ───────────────────────────────────────────────────────────────

function TicketDetail({
  ticket,
  sprints,
  onClose
}: {
  ticket: ZanaTicket;
  sprints: ZanaSprint[];
  onClose: () => void;
}) {
  const sprint = ticket.sprintId ? sprints.find((s) => s.id === ticket.sprintId) : undefined;
  const sprintLabel = sprint?.name ?? (ticket.sprintId ? shortId(ticket.sprintId) : undefined);

  const facts: Array<[string, string | undefined | null]> = [
    ['Status', ticket.status],
    ['Priority', ticket.priority],
    ['Type', ticket.type],
    ['Assignee', ticket.assigneeName],
    ['Sprint', sprintLabel],
    ['Created', fmtDateTime(ticket.createdAt) || undefined],
    ['Updated', fmtDateTime(ticket.updatedAt) || undefined],
    ['Closed', fmtDateTime(ticket.closedAt) || undefined]
  ];
  const shownFacts = facts.filter(([, v]) => v);
  const comments = ticket.comments ?? [];

  return (
    <>
      <header className="gus-modal-header">
        <div className="gus-modal-title">
          <span className="gus-card-type">
            <TicketIcon size={14} aria-hidden />
            <span>{shortId(ticket.id)}</span>
          </span>
          {ticket.priority && (
            <span className={`zana-prio zana-prio--${ticket.priority.toLowerCase()}`}>
              {ticket.priority}
            </span>
          )}
          {ticket.blockedBy.length > 0 && (
            <span className="zana-blocked-tag" title={`Blocked by ${ticket.blockedBy.length}`}>
              <Ban size={11} aria-hidden /> Blocked
            </span>
          )}
        </div>
        <div className="gus-modal-header-actions">
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="gus-modal-body">
        <h3 className="gus-modal-subject">{ticket.title}</h3>

        <dl className="gus-facts">
          {shownFacts.map(([k, v]) => (
            <div key={k} className="gus-fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {ticket.labels.length > 0 && (
          <div className="zana-modal-labels">
            {ticket.labels.map((l) => (
              <span key={l} className="zana-label-chip">
                <Tag size={10} aria-hidden /> {l}
              </span>
            ))}
          </div>
        )}

        {ticket.blockedBy.length > 0 && (
          <div className="zana-modal-section">
            <div className="gus-modal-section-label">
              <Ban size={12} aria-hidden /> Blocked by
            </div>
            <div className="zana-modal-blocked-ids">
              {ticket.blockedBy.map((id) => (
                <span key={id} className="gus-chip">
                  {shortId(id)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">Description</div>
          {ticket.description ? (
            <Markdown text={ticket.description} />
          ) : (
            <div className="gus-modal-empty">No description.</div>
          )}
        </div>

        {ticket.resultSummary && (
          <div className="zana-modal-section">
            <div className="gus-modal-section-label">Result summary</div>
            <Markdown text={ticket.resultSummary} />
          </div>
        )}

        <div className="zana-modal-section gus-modal-chatter">
          <div className="gus-modal-section-label">
            <MessageSquare size={12} aria-hidden /> Comments
            {comments.length > 0 && <span className="gus-chatter-count">{comments.length}</span>}
          </div>
          {comments.length === 0 ? (
            <div className="gus-modal-empty">No comments.</div>
          ) : (
            <ul className="gus-chatter-list">
              {comments.map((c, i) => (
                <li key={i} className="gus-chatter-post">
                  <div className="gus-chatter-avatar" aria-hidden>
                    {initials(c.author ?? '?')}
                  </div>
                  <div className="gus-chatter-main">
                    <div className="gus-chatter-head">
                      <span className="gus-chatter-author">{c.author ?? 'Unknown'}</span>
                      <span className="gus-chatter-time">{fmtDateTime(c.createdAt)}</span>
                    </div>
                    <div className="gus-chatter-body">{c.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

// ── Artifact ─────────────────────────────────────────────────────────────

function ArtifactDetail({
  host,
  artifact,
  projectPath,
  useGlobal,
  onClose
}: {
  host: ModuleHost;
  artifact: ZanaArtifact;
  projectPath?: string;
  useGlobal: boolean;
  onClose: () => void;
}) {
  // Start with whatever content the snapshot shipped; replace with the full
  // body once fetched. Soft-fails to the inline content on error.
  const [content, setContent] = useState<string>(artifact.content);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    host
      .call<ZanaArtifact | null>('getArtifact', { projectPath, useGlobal, id: artifact.id })
      .then((full) => {
        if (live && full && typeof full.content === 'string') setContent(full.content);
      })
      .catch(() => {
        /* keep inline content */
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, artifact.id, projectPath, useGlobal]);

  const facts: Array<[string, string | undefined]> = [
    ['Type', artifact.type],
    ['Created by', artifact.createdBy],
    ['Created', fmtDateTime(artifact.createdAt) || undefined],
    ['Linked tickets', artifact.linkedTickets.length ? String(artifact.linkedTickets.length) : undefined]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  return (
    <>
      <header className="gus-modal-header">
        <div className="gus-modal-title">
          <span className="gus-card-type">
            <FileText size={14} aria-hidden />
            <span>Doc</span>
          </span>
          {artifact.type && <span className="zana-type-badge">{artifact.type}</span>}
        </div>
        <div className="gus-modal-header-actions">
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="gus-modal-body">
        <h3 className="gus-modal-subject">{artifact.title}</h3>

        {shownFacts.length > 0 && (
          <dl className="gus-facts">
            {shownFacts.map(([k, v]) => (
              <div key={k} className="gus-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {artifact.tags.length > 0 && (
          <div className="zana-modal-labels">
            {artifact.tags.map((t) => (
              <span key={t} className="zana-label-chip">
                <Tag size={10} aria-hidden /> {t}
              </span>
            ))}
          </div>
        )}

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">Content</div>
          {loading && !content ? (
            <div className="gus-modal-loading">
              <Loader2 size={14} className="gus-spin" /> Loading content…
            </div>
          ) : content ? (
            <Markdown text={content} />
          ) : (
            <div className="gus-modal-empty">No content.</div>
          )}
        </div>
      </div>
    </>
  );
}
