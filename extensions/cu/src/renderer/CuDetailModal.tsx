/**
 * Generic detail modal for a catalog item (profile / agent / agent-group /
 * workflow / schedule / subscription). Opens when a catalog row is clicked,
 * lazy-loads `cu <kind> show <name>` via the `showDetail` capability, and renders
 * the full definition — a fenced text block (the YAML/JSON the CLI dumps), with a
 * compact facts grid on top when the payload parses to an object.
 *
 * Modal convention matches the rest of the extension (`palette-backdrop` +
 * stop-propagation + Escape to close).
 */
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';

/** What kind of catalog item — maps to the cu `show` subcommand in the main module. */
export type DetailKind =
  | 'profile'
  | 'agent'
  | 'agent-group'
  | 'workflow'
  | 'schedule'
  | 'subscription';

interface Props {
  host: ModuleHost;
  kind: DetailKind;
  name: string;
  /** Agents only: scope the lookup to the active repo's merged catalog. */
  repoPath?: string;
  onClose: () => void;
}

const KIND_LABEL: Record<DetailKind, string> = {
  profile: 'Profile',
  agent: 'Agent',
  'agent-group': 'Agent group',
  workflow: 'Workflow',
  schedule: 'Schedule',
  subscription: 'GUS trigger'
};

/** Flatten a parsed object's top-level scalar fields into [label, value] facts. */
function scalarFacts(parsed: unknown): Array<[string, string]> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      // Skip long multi-line strings (e.g. systemPrompt) — they belong in the body.
      if (v.includes('\n') || v.length > 80) continue;
      out.push([k, v]);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out.push([k, String(v)]);
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      out.push([k, (v as string[]).join(', ')]);
    }
  }
  return out;
}

export function CuDetailModal({ host, kind, name, repoPath, onClose }: Props) {
  const [text, setText] = useState<string>('');
  const [parsed, setParsed] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .call<{ text: string; parsed: unknown }>('showDetail', kind, name, repoPath)
      .then((res) => {
        if (!live) return;
        setText(res?.text ?? '');
        setParsed(res?.parsed ?? null);
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
  }, [host, kind, name, repoPath]);

  const facts = scalarFacts(parsed);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="cu-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${KIND_LABEL[kind]} ${name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cu-modal-header">
          <div className="cu-modal-title">
            <span className="cu-detail-kind">{KIND_LABEL[kind]}</span>
            <span>{name}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="cu-modal-body">
          {loading && (
            <div className="cu-modal-loading">
              <Loader2 size={14} className="cu-spin" /> Loading…
            </div>
          )}
          {error && <div className="cu-modal-error">{error}</div>}

          {!loading && !error && facts.length > 0 && (
            <dl className="cu-facts">
              {facts.map(([k, v]) => (
                <div key={k} className="cu-fact">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {!loading && !error && (
            <div className="cu-modal-section">
              <div className="cu-modal-section-label">Definition</div>
              {text ? (
                <pre className="cu-code cu-detail-body">{text}</pre>
              ) : (
                <div className="cu-modal-empty">No definition returned.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
