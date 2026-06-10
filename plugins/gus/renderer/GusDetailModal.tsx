/**
 * Detail modal for a single GUS work item. Opens when a card is clicked,
 * lazy-loads the full record via `host.call('getWork', id)`, and renders the
 * rich-text body safely. "Open in GUS" stays available as a secondary action.
 *
 * Follows the app's modal convention (`palette-backdrop` + stop-propagation +
 * Escape to close), matching ShortcutsHelp.
 */

import { useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  Bug,
  BookOpen,
  CircleDot,
  Loader2,
  MessageSquare,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Film
} from 'lucide-react';
import type { ModuleHost } from '../../../src/shared/module-api';
import type { GusAttachment, GusChatterPost, GusWorkDetail, GusWorkItem } from '../shared/types';
import { renderRichText } from './renderRichText';

interface Props {
  host: ModuleHost;
  /** The card the user clicked — shown immediately while detail loads. */
  item: GusWorkItem;
  instanceUrl: string;
  onClose: () => void;
}

function typeIcon(type?: string, size = 14) {
  const t = (type ?? '').toLowerCase();
  if (t === 'bug') return <Bug size={size} aria-hidden />;
  if (t.includes('story')) return <BookOpen size={size} aria-hidden />;
  return <CircleDot size={size} aria-hidden />;
}

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/** Date + time, for chatter timestamps. */
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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);

function fileIcon(ext?: string) {
  const e = (ext ?? '').toLowerCase();
  if (IMAGE_EXTS.has(e)) return <ImageIcon size={14} aria-hidden />;
  if (VIDEO_EXTS.has(e)) return <Film size={14} aria-hidden />;
  return <FileText size={14} aria-hidden />;
}

/** Human-readable file size. */
function fmtSize(bytes?: number): string {
  if (typeof bytes !== 'number' || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function GusDetailModal({ host, item, instanceUrl, onClose }: Props) {
  const [detail, setDetail] = useState<GusWorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatter, setChatter] = useState<GusChatterPost[] | null>(null);
  const [chatterLoading, setChatterLoading] = useState(true);
  const [files, setFiles] = useState<GusAttachment[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    host
      .call<GusWorkDetail | null>('getWork', item.id)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, item.id]);

  // Chatter loads in parallel with detail — independent failure, own spinner.
  useEffect(() => {
    let live = true;
    setChatterLoading(true);
    host
      .call<GusChatterPost[]>('getChatter', item.id)
      .then((posts) => {
        if (live) setChatter(posts);
      })
      .catch(() => {
        if (live) setChatter([]);
      })
      .finally(() => {
        if (live) setChatterLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, item.id]);

  // Attached files, also in parallel — own spinner, soft-fails to empty.
  useEffect(() => {
    let live = true;
    setFilesLoading(true);
    host
      .call<GusAttachment[]>('getFiles', item.id)
      .then((fs) => {
        if (live) setFiles(fs);
      })
      .catch(() => {
        if (live) setFiles([]);
      })
      .finally(() => {
        if (live) setFilesLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, item.id]);

  const url = `${instanceUrl}/${item.id}`;
  const openInGus = () => host.openExternal(url);
  const openFile = (fileId: string) => host.openExternal(`${instanceUrl}/${fileId}`);
  // Merge: show the card's fields immediately, enrich with detail when loaded.
  const d: GusWorkDetail = { ...item, ...(detail ?? {}) };

  const facts: Array<[string, string | undefined | null]> = [
    ['Status', d.status],
    ['Priority', d.priority],
    ['Type', d.type],
    ['Points', typeof d.storyPoints === 'number' ? String(d.storyPoints) : undefined],
    ['Sprint', d.sprintName],
    ['Product', d.productTag],
    ['Epic', d.epicName],
    ['Assignee', d.assignee],
    ['QA', d.qaEngineer],
    ['Scheduled build', d.scheduledBuild],
    ['Found in build', d.foundInBuild],
    ['Created', fmtDate(d.createdDate)],
    ['Modified', fmtDate(d.lastModified)]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="gus-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} ${item.subject}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="gus-modal-header">
          <div className="gus-modal-title">
            <span className={`gus-card-type gus-card-type--${(d.type ?? 'other').toLowerCase().replace(/\s+/g, '-')}`}>
              {typeIcon(d.type)}
              <span>{d.name}</span>
            </span>
            {d.priority && (
              <span className={`gus-prio gus-prio--${d.priority.toLowerCase()}`}>{d.priority}</span>
            )}
          </div>
          <div className="gus-modal-header-actions">
            <button type="button" className="gus-open-btn" onClick={openInGus}>
              <ExternalLink size={13} />
              <span>Open in GUS</span>
            </button>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="gus-modal-body">
          <h3 className="gus-modal-subject">{d.subject}</h3>

          <dl className="gus-facts">
            {shownFacts.map(([k, v]) => (
              <div key={k} className="gus-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="gus-modal-details">
            <div className="gus-modal-section-label">Details</div>
            {loading && (
              <div className="gus-modal-loading">
                <Loader2 size={14} className="gus-spin" /> Loading details…
              </div>
            )}
            {error && <div className="gus-modal-error">{error}</div>}
            {!loading && !error && d.detailsHtml && (
              <div className="gus-richtext">
                {renderRichText(d.detailsHtml, (link) => host.openExternal(link))}
              </div>
            )}
            {!loading && !error && !d.detailsHtml && (
              <div className="gus-modal-empty">No description.</div>
            )}
          </div>

          {/* Attached files — hidden entirely when the item has none, so the
              section never adds empty noise to tickets without attachments. */}
          {(filesLoading || (files && files.length > 0)) && (
            <div className="gus-modal-files">
              <div className="gus-modal-section-label">
                <Paperclip size={12} aria-hidden /> Attached files
                {files && files.length > 0 && (
                  <span className="gus-chatter-count">{files.length}</span>
                )}
              </div>
              {filesLoading && (
                <div className="gus-modal-loading">
                  <Loader2 size={14} className="gus-spin" /> Loading files…
                </div>
              )}
              {!filesLoading && files && files.length > 0 && (
                <ul className="gus-file-list">
                  {files.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="gus-file"
                        onClick={() => openFile(f.id)}
                        title={`${f.title}${f.ext ? '.' + f.ext : ''} — open in GUS`}
                      >
                        <span className="gus-file-icon">{fileIcon(f.ext)}</span>
                        <span className="gus-file-name">
                          {f.title}
                          {f.ext ? `.${f.ext}` : ''}
                        </span>
                        <span className="gus-file-meta">
                          {fmtSize(f.size)}
                          <ExternalLink size={11} aria-hidden />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="gus-modal-chatter">
            <div className="gus-modal-section-label">
              <MessageSquare size={12} aria-hidden /> Chatter
              {chatter && chatter.length > 0 && (
                <span className="gus-chatter-count">{chatter.length}</span>
              )}
            </div>
            {chatterLoading && (
              <div className="gus-modal-loading">
                <Loader2 size={14} className="gus-spin" /> Loading chatter…
              </div>
            )}
            {!chatterLoading && chatter && chatter.length === 0 && (
              <div className="gus-modal-empty">No comments.</div>
            )}
            {!chatterLoading && chatter && chatter.length > 0 && (
              <ul className="gus-chatter-list">
                {chatter.map((post) => (
                  <li key={post.id} className="gus-chatter-post">
                    <div className="gus-chatter-avatar" aria-hidden>
                      {initials(post.author)}
                    </div>
                    <div className="gus-chatter-main">
                      <div className="gus-chatter-head">
                        <span className="gus-chatter-author">{post.author}</span>
                        <span className="gus-chatter-time">{fmtDateTime(post.createdDate)}</span>
                      </div>
                      <div className="gus-chatter-body">{post.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
