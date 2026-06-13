/**
 * Shared scaffolding for a catalog tab: a header row (count + refresh) and the
 * loading / empty / error / content switch. Keeps the four catalog tabs
 * (profiles, agents, workflows, schedules) visually consistent and free of
 * repeated boilerplate.
 */
import type { ReactNode } from 'react';
import { RefreshCw, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  title: string;
  count: number;
  loading: boolean;
  error: string | null;
  /** Empty-state message when there are zero rows and no error. */
  emptyLabel: string;
  onReload: () => void;
  children: ReactNode;
}

export function CatalogShell({ title, count, loading, error, emptyLabel, onReload, children }: Props) {
  return (
    <div className="cu-catalog">
      <div className="cu-toolbar">
        <span className="cu-count-pill">
          {count} {count === 1 ? title.replace(/s$/, '') : title}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onReload}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'cu-spin' : undefined} />
        </button>
      </div>

      <div className="cu-catalog-body">
        {loading && count === 0 && (
          <div className="cu-loading">
            <Loader2 size={16} className="cu-spin" /> Loading {title}…
          </div>
        )}
        {error && (
          <div className="cu-error" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>Couldn't load {title}.</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
        {!loading && !error && count === 0 && <div className="cu-empty-inline">{emptyLabel}</div>}
        {!error && count > 0 && <ul className="cu-catalog-list">{children}</ul>}
      </div>
    </div>
  );
}
