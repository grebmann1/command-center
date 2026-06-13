/**
 * Launch-session modal. A form over `cu run --repo … --prompt …` with the
 * optional model / profile / agent / caps / permission-mode flags. The repo
 * defaults to the shell's active project and offers a picker over all open
 * projects, so the common case (launch in the project you're looking at) is one
 * field. On success it toasts the new session's short name and asks the panel to
 * refresh.
 *
 * Modal convention matches the rest of the extension (`palette-backdrop` +
 * stop-propagation + Escape to close).
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Rocket } from 'lucide-react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { PERMISSION_MODES, type CuPermissionMode, type CuRunOptions, type CuRunResult } from '../shared/types.js';

interface Props {
  host: ModuleHost;
  onClose: () => void;
  /** Called after a successful launch so the panel can refetch the fleet. */
  onLaunched: () => void;
}

export function CuLaunchModal({ host, onClose, onLaunched }: Props) {
  const projects = useMemo(() => host.listProjects(), [host]);
  const active = useMemo(() => host.getActiveProject(), [host]);

  const [repoPath, setRepoPath] = useState(active?.path ?? projects[0]?.path ?? '');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [profile, setProfile] = useState('');
  const [agent, setAgent] = useState('');
  const [maxTurns, setMaxTurns] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [permissionMode, setPermissionMode] = useState<CuPermissionMode | ''>('');
  const [allowedTools, setAllowedTools] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !launching) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, launching]);

  const canLaunch = repoPath.trim() && prompt.trim() && !launching;

  const submit = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setError(null);
    const opts: CuRunOptions = {
      repoPath: repoPath.trim(),
      prompt: prompt.trim(),
      model: model.trim() || undefined,
      profile: profile.trim() || undefined,
      agent: agent.trim() || undefined,
      maxTurns: maxTurns.trim() ? Number(maxTurns) : undefined,
      maxBudgetUsd: maxBudget.trim() ? Number(maxBudget) : undefined,
      permissionMode: permissionMode || undefined,
      allowedTools: allowedTools.trim() || undefined
    };
    try {
      const res = await host.call<CuRunResult>('run', opts);
      const label = res?.shortName || res?.sessionId || 'session';
      host.toast(`Launched ${label}.`);
      onLaunched();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      host.toast(`Couldn't launch — ${msg}`, 'error');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => !launching && onClose()}>
      <div
        className="cu-modal cu-launch-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Launch a Claude Unleashed session"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cu-modal-header">
          <div className="cu-modal-title">
            <Rocket size={14} aria-hidden />
            <span>Launch session</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="cu-modal-body cu-form">
          <label className="cu-field">
            <span className="cu-field-label">Repo</span>
            {projects.length > 0 ? (
              <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.path}>
                    {p.name} — {p.path}
                  </option>
                ))}
                {/* Allow a path not in the open-project list. */}
                {!projects.some((p) => p.path === repoPath) && repoPath && (
                  <option value={repoPath}>{repoPath}</option>
                )}
              </select>
            ) : (
              <input
                type="text"
                value={repoPath}
                placeholder="/path/to/repo"
                onChange={(e) => setRepoPath(e.target.value)}
              />
            )}
          </label>

          <label className="cu-field">
            <span className="cu-field-label">Prompt</span>
            <textarea
              rows={4}
              value={prompt}
              placeholder="What should the session do?"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>

          <div className="cu-field-row">
            <label className="cu-field">
              <span className="cu-field-label">Model</span>
              <input
                type="text"
                value={model}
                placeholder="(default)"
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label className="cu-field">
              <span className="cu-field-label">Profile</span>
              <input
                type="text"
                value={profile}
                placeholder="(none)"
                onChange={(e) => setProfile(e.target.value)}
              />
            </label>
          </div>

          <div className="cu-field-row">
            <label className="cu-field">
              <span className="cu-field-label">Agent</span>
              <input
                type="text"
                value={agent}
                placeholder="(none)"
                onChange={(e) => setAgent(e.target.value)}
              />
            </label>
            <label className="cu-field">
              <span className="cu-field-label">Permission mode</span>
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as CuPermissionMode | '')}
              >
                <option value="">(default)</option>
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="cu-field-row">
            <label className="cu-field">
              <span className="cu-field-label">Max turns</span>
              <input
                type="number"
                min={1}
                value={maxTurns}
                placeholder="(unset)"
                onChange={(e) => setMaxTurns(e.target.value)}
              />
            </label>
            <label className="cu-field">
              <span className="cu-field-label">Max budget (USD)</span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={maxBudget}
                placeholder="(unset)"
                onChange={(e) => setMaxBudget(e.target.value)}
              />
            </label>
          </div>

          <label className="cu-field">
            <span className="cu-field-label">Allowed tools</span>
            <input
              type="text"
              value={allowedTools}
              placeholder="e.g. Read,Edit,Grep (comma-separated)"
              onChange={(e) => setAllowedTools(e.target.value)}
            />
          </label>

          {error && <div className="cu-modal-error">{error}</div>}
        </div>

        <footer className="cu-modal-footer">
          <button type="button" className="cu-btn" onClick={onClose} disabled={launching}>
            Cancel
          </button>
          <button type="button" className="cu-btn cu-btn--primary" onClick={submit} disabled={!canLaunch}>
            {launching ? <Loader2 size={13} className="cu-spin" /> : <Rocket size={13} />}
            <span>Launch</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
