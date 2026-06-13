/**
 * Tiny read-only loader hook shared by the catalog tabs (profiles, agents,
 * workflows, schedules). Each tab calls one cu capability that returns an array;
 * this hook fetches it on mount, exposes loading/error/data, and a `reload`.
 *
 * It deliberately does NOT distinguish not-installed/daemon-down — by the time a
 * catalog tab renders, CuPanel has already gated those at the panel level (the
 * daemon is up and the CLI present), so a failure here is a genuine command
 * error worth surfacing verbatim.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';

export interface CatalogState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useCatalog<T>(
  host: ModuleHost,
  capability: string,
  ...args: unknown[]
): CatalogState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable across renders: args are simple scalars passed by the caller.
  const argKey = JSON.stringify(args);

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    host
      .call<T[]>(capability, ...args)
      .then((rows) => {
        if (alive) setData(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, capability, argKey]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);

  return { data, loading, error, reload };
}
