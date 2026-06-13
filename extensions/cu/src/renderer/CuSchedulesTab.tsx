/**
 * Schedules tab — cron-driven launches (`cu schedules ls`) with enable / disable
 * / run-now, plus GUS-CDC subscriptions (`cu gus-cdc subscriptions ls`) shown
 * beneath as event-driven triggers. Both fire `cu run` / `cu workflow run`; the
 * difference is the trigger (cron vs. a GUS work-item change).
 */
import { useState } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { Clock, Play, Loader2, Power, PowerOff, Webhook } from 'lucide-react';
import { CatalogShell } from './CatalogShell.js';
import { CatalogRow } from './CatalogRow.js';
import { CuDetailModal, type DetailKind } from './CuDetailModal.js';
import { useCatalog } from './useCatalog.js';
import type { CuSchedule, CuSubscription, CuActionResult } from '../shared/types.js';

export function CuSchedulesTab({ host }: { host: ModuleHost }) {
  const schedules = useCatalog<CuSchedule>(host, 'listSchedules');
  const subs = useCatalog<CuSubscription>(host, 'listSubscriptions');
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ kind: DetailKind; name: string } | null>(null);

  const act = async (
    name: string,
    capability: 'scheduleEnable' | 'scheduleDisable' | 'scheduleRunNow',
    verb: string
  ) => {
    setBusy(name);
    try {
      const res = await host.call<CuActionResult>(capability, name);
      host.toast(
        res?.ok ? `${name}: ${verb} ok.` : `${name}: ${verb} failed${res?.message ? ` — ${res.message}` : ''}`,
        res?.ok ? 'info' : 'error'
      );
      if (res?.ok) schedules.reload();
    } catch (err) {
      host.toast(`${name}: ${verb} failed — ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cu-schedules-tab">
      <CatalogShell
        title="schedules"
        count={schedules.data.length}
        loading={schedules.loading}
        error={schedules.error}
        emptyLabel="No schedules. Create one with `cu schedules add`."
        onReload={schedules.reload}
      >
        {schedules.data.map((s) => (
          <CatalogRow
            key={s.name}
            icon={<Clock size={13} className="cu-catalog-icon" aria-hidden />}
            name={s.name}
            dim={s.enabled === false}
            badge={
              <>
                {s.lastFailed && <span className="cu-chip cu-chip--fail">last run failed</span>}
                {s.cron && <code className="cu-cron">{s.cron}</code>}
              </>
            }
            onOpen={() => setDetail({ kind: 'schedule', name: s.name })}
          >
            {s.kind && <span className="cu-chip">{s.kind}</span>}
            {(s.agent || s.agentGroup) && (
              <span className="cu-chip cu-chip--profile">{s.agent ?? s.agentGroup}</span>
            )}
            {busy === s.name ? (
              <Loader2 size={13} className="cu-spin" />
            ) : (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  title="Run now"
                  aria-label="Run now"
                  onClick={() => void act(s.name, 'scheduleRunNow', 'run-now')}
                >
                  <Play size={13} />
                </button>
                {s.enabled === false ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Enable"
                    aria-label="Enable"
                    onClick={() => void act(s.name, 'scheduleEnable', 'enable')}
                  >
                    <Power size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Disable"
                    aria-label="Disable"
                    onClick={() => void act(s.name, 'scheduleDisable', 'disable')}
                  >
                    <PowerOff size={13} />
                  </button>
                )}
              </>
            )}
          </CatalogRow>
        ))}
      </CatalogShell>

      {subs.data.length > 0 && (
        <CatalogShell
          title="GUS triggers"
          count={subs.data.length}
          loading={subs.loading}
          error={subs.error}
          emptyLabel="No GUS-CDC subscriptions."
          onReload={subs.reload}
        >
          {subs.data.map((s) => (
            <CatalogRow
              key={s.name}
              icon={<Webhook size={13} className="cu-catalog-icon" aria-hidden />}
              name={s.name}
              dim={s.enabled === false}
              description={s.fields && s.fields.length > 0 ? `on ${s.fields.join(', ')}` : undefined}
              onOpen={() => setDetail({ kind: 'subscription', name: s.name })}
            >
              {s.targetType && <span className="cu-chip">{s.targetType}</span>}
              {s.changeTypes &&
                s.changeTypes.map((c) => (
                  <span key={c} className="cu-chip">
                    {c}
                  </span>
                ))}
            </CatalogRow>
          ))}
        </CatalogShell>
      )}

      {detail && (
        <CuDetailModal
          host={host}
          kind={detail.kind}
          name={detail.name}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
