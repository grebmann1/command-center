/**
 * Post-mortem + vitals modal for a single Claude Unleashed session. Opens from a
 * terminal session's "Post-mortem" action, lazy-loads the markdown summary
 * (`cu sessions post-mortem`) and the resource vitals (`cu sessions vitals`) in
 * parallel, each with its own spinner and soft-fail.
 *
 * Follows the app's modal convention (`palette-backdrop` + stop-propagation +
 * Escape to close), matching GusDetailModal / ShortcutsHelp.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, Activity, FileText } from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import type { CuPostMortem, CuSession, CuVitals } from '../shared/types.js';
import { sessionLabel } from '../shared/types.js';
import { renderMarkdown } from './renderMarkdown.js';

interface Props {
  host: ModuleHost;
  session: CuSession;
  onClose: () => void;
}

/** Human-readable byte size (RSS). */
function fmtBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || bytes < 0) return '—';
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

export function CuPostMortemModal({ host, session, onClose }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [pmLoading, setPmLoading] = useState(true);
  const [pmError, setPmError] = useState<string | null>(null);
  const [vitals, setVitals] = useState<CuVitals | null>(null);
  const [vitalsLoading, setVitalsLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Post-mortem markdown.
  useEffect(() => {
    let live = true;
    setPmLoading(true);
    setPmError(null);
    host
      .call<CuPostMortem>('postMortem', session.id)
      .then((pm) => {
        if (live) setMarkdown(pm?.markdown ?? '');
      })
      .catch((err) => {
        if (live) setPmError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setPmLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, session.id]);

  // Vitals load in parallel — own spinner, soft-fails to empty.
  useEffect(() => {
    let live = true;
    setVitalsLoading(true);
    host
      .call<CuVitals>('vitals', session.id)
      .then((v) => {
        if (live) setVitals(v ?? {});
      })
      .catch(() => {
        if (live) setVitals({});
      })
      .finally(() => {
        if (live) setVitalsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [host, session.id]);

  const facts: Array<[string, string | undefined]> = [
    ['Status', session.status],
    ['Profile', session.profile],
    ['Model', session.model],
    ['Turns', typeof session.turns === 'number' ? String(session.turns) : undefined],
    ['Cost', typeof session.costUsd === 'number' ? `$${session.costUsd.toFixed(2)}` : undefined],
    ['Repo', session.repoPath]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="cu-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Post-mortem for ${sessionLabel(session)}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cu-modal-header">
          <div className="cu-modal-title">
            <FileText size={14} aria-hidden />
            <span>{sessionLabel(session)}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="cu-modal-body">
          <dl className="cu-facts">
            {shownFacts.map(([k, v]) => (
              <div key={k} className="cu-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="cu-modal-section">
            <div className="cu-modal-section-label">
              <Activity size={12} aria-hidden /> Vitals
            </div>
            {vitalsLoading ? (
              <div className="cu-modal-loading">
                <Loader2 size={14} className="cu-spin" /> Loading vitals…
              </div>
            ) : (
              <div className="cu-vitals">
                <span className="cu-chip">PID {vitals?.pid ?? '—'}</span>
                <span className="cu-chip">RSS {fmtBytes(vitals?.rss)}</span>
                <span className="cu-chip">
                  CPU {typeof vitals?.cpu === 'number' ? `${vitals.cpu.toFixed(0)}%` : '—'}
                </span>
              </div>
            )}
          </div>

          <div className="cu-modal-section">
            <div className="cu-modal-section-label">Post-mortem</div>
            {pmLoading && (
              <div className="cu-modal-loading">
                <Loader2 size={14} className="cu-spin" /> Loading post-mortem…
              </div>
            )}
            {pmError && <div className="cu-modal-error">{pmError}</div>}
            {!pmLoading && !pmError && markdown && (
              <div className="cu-markdown">{renderMarkdown(markdown)}</div>
            )}
            {!pmLoading && !pmError && !markdown && (
              <div className="cu-modal-empty">No post-mortem available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
