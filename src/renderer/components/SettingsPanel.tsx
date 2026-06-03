import { useEffect, useState } from 'react';
import type { AppConfig } from '@shared/types';
import { useData, useUi } from '../store';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const workbenchEnabled = useUi((s) => s.workbenchEnabled);
  const setWorkbenchEnabled = useUi((s) => s.setWorkbenchEnabled);

  useEffect(() => {
    window.cc.config.get().then(setConfig).catch(() => {});
  }, []);

  if (!config) {
    return (
      <main className="settings-panel">
        <div className="settings-empty">Loading…</div>
      </main>
    );
  }

  const update = async (patch: Partial<AppConfig>) => {
    try {
      const next = await window.cc.config.set(patch);
      setConfig(next);
      if (typeof patch.fontSize === 'number') useData.getState().setFontSize(patch.fontSize);
      setSavedAt(Date.now());
    } catch {
      // noop: user can retry by blurring again
    }
  };

  return (
    <main className="settings-panel">
      <div className="settings-inner">
        <h2>Settings</h2>

        <section className="settings-section">
          <h3>Shells</h3>
          <Field
            label="Default shell"
            help="Path to the shell launched for shell-profile tabs."
          >
            <input
              type="text"
              value={config.shell}
              onChange={(e) => setConfig({ ...config, shell: e.target.value })}
              onBlur={(e) => update({ shell: e.target.value.trim() })}
              spellCheck={false}
            />
          </Field>
          <Field
            label="Claude binary"
            help="Command run for claude / claude -c / claude --resume tabs. Just 'claude' if it's on your PATH."
          >
            <input
              type="text"
              value={config.claudeBinary}
              onChange={(e) => setConfig({ ...config, claudeBinary: e.target.value })}
              onBlur={(e) => update({ claudeBinary: e.target.value.trim() })}
              spellCheck={false}
            />
          </Field>
        </section>

        <section className="settings-section">
          <h3>Appearance</h3>
          <Field label="Terminal font size" help="Affects new tabs. Range 10–20.">
            <input
              type="number"
              min={10}
              max={20}
              value={config.fontSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) setConfig({ ...config, fontSize: n });
              }}
              onBlur={(e) => {
                const n = Math.max(10, Math.min(20, parseInt(e.target.value, 10) || 13));
                update({ fontSize: n });
              }}
            />
          </Field>
        </section>

        <section className="settings-section">
          <h3>Experimental</h3>
          <Field
            label="VSCode workbench"
            help="Replace the explorer with the full monaco-vscode-api workbench. Off by default — toggle off via DevTools (localStorage.cc.workbenchEnabled='0') if it crashes on boot."
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={workbenchEnabled}
                onChange={(e) => setWorkbenchEnabled(e.target.checked)}
              />
              <span>Enable workbench in Explorer mode</span>
            </label>
          </Field>
        </section>

        {savedAt && <div className="settings-saved">Saved · {timeAgo(savedAt)}</div>}
      </div>
    </main>
  );
}

function Field({
  label,
  help,
  children
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <label>
        <span className="settings-label">{label}</span>
        {children}
      </label>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
