/**
 * Claude Unleashed (cu) module — renderer panel root. A tabbed shell over the
 * local daemon's "vocabulary": the live Fleet (sessions) plus read catalogs for
 * Profiles, Agents, Workflows, and Schedules (+ GUS-CDC triggers).
 *
 * CuPanel owns the daemon GATE: it polls `daemonStatus` and resolves one of
 * three blocking states that apply to ALL tabs —
 *   • not-installed   (`claude-unleashed` not on PATH → capability throws)
 *   • needs-relaunch   (extension seeded mid-run, main child not spawned yet)
 *   • daemon-down      (`running:false`; offers a one-click Start)
 * Only when the daemon is up does it render the tab strip + the active tab. Each
 * tab does its own data fetching; a tab that hits a gate-level failure calls
 * `onFatal`, which re-runs the gate so the whole panel reflects it.
 *
 * Decoupling: talks to the host ONLY through `ModuleHost` (no core stores/IPC).
 * Styling uses the shared `cu-*` classes in global.css.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, RotateCw, Power, ExternalLink, Loader2 } from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { CuFleetTab } from './CuFleetTab.js';
import { CuProfilesTab } from './CuProfilesTab.js';
import { CuAgentsTab } from './CuAgentsTab.js';
import { CuWorkflowsTab } from './CuWorkflowsTab.js';
import { CuSchedulesTab } from './CuSchedulesTab.js';
import {
  type CuDaemonStatus,
  type CuActionResult,
  type CuTab,
  CU_TABS
} from '../shared/types.js';

const STORAGE_TAB_KEY = 'activeTab';
const DOCS_URL = 'https://git.soma.salesforce.com/cc-oms/claude-unleashed';

/** Blocking gate states that replace all tab content. */
type Gate = 'loading' | 'not-installed' | 'needs-relaunch' | 'daemon-down' | 'ok';

function gateForError(message: string): Exclude<Gate, 'loading' | 'ok' | 'daemon-down'> | null {
  const m = message.toLowerCase();
  if (m.includes('unknown module') || m.includes('no such module')) return 'needs-relaunch';
  if (m.includes('not found') || m.includes('not installed') || m.includes('unexpectedly'))
    return 'not-installed';
  return null;
}

const TAB_LABELS: Record<CuTab, string> = {
  fleet: 'Fleet',
  profiles: 'Profiles',
  agents: 'Agents',
  workflows: 'Workflows',
  schedules: 'Schedules'
};

export default function CuPanel({ host }: { host: ModuleHost }) {
  const [gate, setGate] = useState<Gate>('loading');
  const [daemon, setDaemon] = useState<CuDaemonStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeTab, setActiveTab] = useState<CuTab>('fleet');
  const [hydrated, setHydrated] = useState(false);

  // Restore last active tab before first render of content.
  useEffect(() => {
    let alive = true;
    host.storage.get<CuTab>(STORAGE_TAB_KEY).then((t) => {
      if (!alive) return;
      if (t && (CU_TABS as readonly string[]).includes(t)) setActiveTab(t);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);

  /** Probe daemon liveness → resolve the gate. */
  const checkGate = useCallback(async () => {
    setGate((g) => (g === 'ok' ? g : 'loading'));
    try {
      const status = await host.call<CuDaemonStatus>('daemonStatus');
      setDaemon(status);
      setGate(status.running ? 'ok' : 'daemon-down');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGate(gateForError(msg) ?? 'daemon-down');
    }
  }, [host]);

  useEffect(() => {
    void checkGate();
  }, [checkGate]);

  const selectTab = (t: CuTab) => {
    setActiveTab(t);
    void host.storage.set(STORAGE_TAB_KEY, t);
  };

  // A tab signalled a gate-level failure — re-evaluate at the panel level.
  const onFatal = useCallback(() => {
    void checkGate();
  }, [checkGate]);

  const startDaemon = useCallback(async () => {
    setStarting(true);
    try {
      const res = await host.call<CuActionResult>('startDaemon');
      if (res?.ok) {
        host.toast('Daemon started.');
        await checkGate();
      } else {
        host.toast(`Couldn't start daemon${res?.message ? ` — ${res.message}` : ''}`, 'error');
      }
    } catch (err) {
      host.toast(
        `Couldn't start daemon — ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setStarting(false);
    }
  }, [host, checkGate]);

  return (
    <section className="cu-panel">
      <header className="cu-header">
        <div className="cu-header-title">
          <Bot size={16} className="cu-header-icon" aria-hidden />
          <h2>Claude Unleashed</h2>
          <DaemonPill gate={gate} daemon={daemon} />
        </div>
      </header>

      {/* Tab strip — only meaningful when the daemon is up; hidden otherwise so
          the blocking gate states own the full content area. */}
      {gate === 'ok' && (
        <nav className="cu-tabs" role="tablist" aria-label="Claude Unleashed sections">
          {CU_TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`cu-tab ${activeTab === t ? 'active' : ''}`}
              onClick={() => selectTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      )}

      <div className="cu-content">
        {gate === 'loading' && (
          <div className="cu-loading">
            <Loader2 size={16} className="cu-spin" /> Connecting to the daemon…
          </div>
        )}

        {gate === 'needs-relaunch' && (
          <div className="cu-empty-state">
            <RotateCw size={32} aria-hidden />
            <strong>Relaunch to activate</strong>
            <p>
              Claude Unleashed was just installed. Its background process starts when the app
              launches — quit and reopen Claude Code Terminal Center to finish activating it.
            </p>
          </div>
        )}

        {gate === 'not-installed' && (
          <div className="cu-empty-state">
            <Bot size={32} aria-hidden />
            <strong>Claude Unleashed isn't installed</strong>
            <p>
              The <code>claude-unleashed</code> CLI isn't on your PATH. Install it, then refresh.
            </p>
            <button type="button" className="cu-btn" onClick={() => host.openExternal(DOCS_URL)}>
              <ExternalLink size={13} /> <span>Open docs</span>
            </button>
          </div>
        )}

        {gate === 'daemon-down' && (
          <div className="cu-empty-state">
            <Power size={32} aria-hidden />
            <strong>Daemon stopped</strong>
            <p>The local claude-unleashed daemon isn't running. Start it to use Claude Unleashed.</p>
            <button
              type="button"
              className="cu-btn cu-btn--primary"
              onClick={() => void startDaemon()}
              disabled={starting}
            >
              {starting ? <Loader2 size={13} className="cu-spin" /> : <Power size={13} />}
              <span>Start daemon</span>
            </button>
          </div>
        )}

        {gate === 'ok' && hydrated && (
          <>
            {activeTab === 'fleet' && <CuFleetTab host={host} onFatal={onFatal} />}
            {activeTab === 'profiles' && <CuProfilesTab host={host} />}
            {activeTab === 'agents' && <CuAgentsTab host={host} />}
            {activeTab === 'workflows' && <CuWorkflowsTab host={host} />}
            {activeTab === 'schedules' && <CuSchedulesTab host={host} />}
          </>
        )}
      </div>
    </section>
  );
}

function DaemonPill({ gate, daemon }: { gate: Gate; daemon: CuDaemonStatus | null }) {
  if (gate === 'not-installed') {
    return <span className="cu-daemon-pill cu-daemon-pill--off">CLI missing</span>;
  }
  if (gate === 'needs-relaunch') {
    return <span className="cu-daemon-pill cu-daemon-pill--off">Relaunch</span>;
  }
  if (gate === 'loading') {
    return <span className="cu-daemon-pill">…</span>;
  }
  const up = gate === 'ok' && (daemon?.running ?? true);
  return (
    <span className={`cu-daemon-pill ${up ? 'cu-daemon-pill--on' : 'cu-daemon-pill--off'}`}>
      <span className="cu-daemon-dot" aria-hidden />
      {up ? 'Daemon up' : 'Daemon down'}
    </span>
  );
}
