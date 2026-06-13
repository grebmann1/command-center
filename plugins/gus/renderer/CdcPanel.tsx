/**
 * CDC Triggers panel — configure and monitor GUS change-data-capture triggers.
 * Lets users create/edit/delete triggers that poll GUS work items and launch
 * persona sessions when watched fields change.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Play, Pause, ExternalLink, AlertCircle, Clock, ArrowLeft } from 'lucide-react';
import type { ModuleHost, PersonaInfo } from '@cctc/extension-sdk/renderer';
import type { CdcTrigger, CdcPendingMatch } from '../shared/types';

const STORAGE_SELECTED_TRIGGER = 'cdcSelectedTriggerId';

interface CdcPanelProps {
  host: ModuleHost;
  /** Return to the main GUS board (My work / Backlog). Rendered as a back
   *  control in the header so CDC mode isn't a dead end. */
  onExit: () => void;
}

export function CdcPanel({ host, onExit }: CdcPanelProps) {
  const [triggers, setTriggers] = useState<CdcTrigger[]>([]);
  const [pending, setPending] = useState<CdcPendingMatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Load triggers and pending matches.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trig, pend] = await Promise.all([
        host.call<CdcTrigger[]>('cdcListTriggers'),
        host.call<CdcPendingMatch[]>('cdcGetPending')
      ]);
      setTriggers(trig);
      setPending(pend);
      // Arm all enabled triggers.
      await host.call('cdcArmAll');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    void load();
    // Poll pending matches every 10s while mounted.
    const interval = setInterval(() => {
      host.call<CdcPendingMatch[]>('cdcGetPending').then(setPending).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [host, load]);

  // Restore last-selected trigger.
  useEffect(() => {
    host.storage.get<string>(STORAGE_SELECTED_TRIGGER).then((id) => {
      if (id && triggers.some((t) => t.id === id)) setSelectedId(id);
    });
  }, [host, triggers]);

  const selectTrigger = (id: string | null) => {
    setSelectedId(id);
    void host.storage.set(STORAGE_SELECTED_TRIGGER, id ?? '');
  };

  const selected = useMemo(() => triggers.find((t) => t.id === selectedId) ?? null, [triggers, selectedId]);

  const createNew = () => {
    const projects = host.listProjects();
    const personas = host.listPersonas();
    if (projects.length === 0) {
      host.toast('No projects available — add a project first.', 'error');
      return;
    }
    if (personas.length === 0) {
      host.toast('No personas available — configure a persona first.', 'error');
      return;
    }
    const newTrigger: CdcTrigger = {
      id: `cdc-${Date.now()}`,
      name: 'New Trigger',
      enabled: false, // default disabled
      projectId: projects[0].id,
      object: 'ADM_Work__c',
      changeType: ['UPDATE'],
      fields: ['Status__c'], // default to Status
      scope: { assignee: 'me', scrumTeam: null },
      pollEvery: '2m',
      launch: { personaId: personas[0].id, promptTemplate: 'Investigate {{Name}}. {{Subject__c}}' },
      requireConfirm: true // default safe
    };
    setTriggers((prev) => [...prev, newTrigger]);
    selectTrigger(newTrigger.id);
    setEditing(true);
  };

  const saveTrigger = async (t: CdcTrigger) => {
    try {
      await host.call('cdcSaveTrigger', t);
      setTriggers((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setEditing(false);
      host.toast('Trigger saved');
    } catch (err) {
      host.toast(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const deleteTrigger = async (id: string) => {
    if (!confirm('Delete this trigger?')) return;
    try {
      await host.call('cdcDeleteTrigger', id);
      setTriggers((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) selectTrigger(null);
      host.toast('Trigger deleted');
    } catch (err) {
      host.toast(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const toggleEnabled = async (t: CdcTrigger) => {
    const updated = { ...t, enabled: !t.enabled };
    await saveTrigger(updated);
  };

  const launchMatch = async (match: CdcPendingMatch) => {
    try {
      const result = await host.launchSession({
        projectId: match.workItem.teamId || triggers.find((t) => t.id === match.triggerId)?.projectId || '',
        personaId: match.personaId,
        extraArgs: [match.resolvedPrompt],
        title: `${match.workItem.name}: ${match.workItem.subject}`
      });
      if (result) {
        await host.call('cdcClearPending', match.matchId);
        setPending((prev) => prev.filter((m) => m.matchId !== match.matchId));
        host.toast('Session launched');
      }
    } catch (err) {
      host.toast(`Failed to launch: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const dismissMatch = async (matchId: string) => {
    await host.call('cdcClearPending', matchId);
    setPending((prev) => prev.filter((m) => m.matchId !== matchId));
  };

  return (
    <section className="gus-panel">
      <header className="gus-header">
        <div className="gus-header-title">
          <button
            type="button"
            className="icon-btn"
            onClick={onExit}
            title="Back to GUS board"
            aria-label="Back to GUS board"
          >
            <ArrowLeft size={14} />
          </button>
          <Clock size={16} className="gus-header-icon" aria-hidden />
          <h2>CDC Triggers</h2>
        </div>
        <div className="gus-header-actions">
          {pending.length > 0 && <span className="gus-count-pill">{pending.length} pending</span>}
          <button type="button" className="icon-btn" onClick={createNew} title="New trigger" aria-label="New trigger">
            <Plus size={14} />
          </button>
        </div>
      </header>

      {error && (
        <div className="gus-error" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>Error loading triggers</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="gus-body">
        <aside className="gus-rail">
          <div className="gus-rail-section">
            <div className="gus-rail-label">Triggers</div>
            {triggers.length === 0 && !loading && (
              <div className="gus-rail-hint">No triggers yet. Create one to start.</div>
            )}
            {triggers.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`gus-rail-item ${selectedId === t.id ? 'active' : ''}`}
                onClick={() => selectTrigger(t.id)}
              >
                <span className="gus-rail-item-name">
                  {t.name}
                  {t.enabled && <span className="gus-now-dot" title="Enabled" />}
                </span>
              </button>
            ))}
          </div>

          {pending.length > 0 && (
            <>
              <div className="gus-rail-divider" />
              <div className="gus-rail-section">
                <div className="gus-rail-label">Pending matches</div>
                {pending.map((m) => (
                  <div key={m.matchId} className="gus-pending-match">
                    <div className="gus-pending-match-title">{m.workItem.name}</div>
                    <div className="gus-pending-match-trigger">{m.triggerName}</div>
                    <div className="gus-pending-match-actions">
                      <button
                        type="button"
                        className="gus-pending-btn gus-pending-btn--launch"
                        onClick={() => launchMatch(m)}
                      >
                        <Play size={12} /> Launch
                      </button>
                      <button
                        type="button"
                        className="gus-pending-btn gus-pending-btn--dismiss"
                        onClick={() => dismissMatch(m.matchId)}
                        title="Dismiss"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <div className="gus-content">
          {loading && <div className="gus-loading">Loading triggers…</div>}
          {!loading && !selected && triggers.length === 0 && (
            <div className="gus-empty">
              <Clock size={32} />
              <h3>No CDC triggers yet</h3>
              <p>
                Create a trigger to launch persona sessions automatically when GUS work items change.
              </p>
              <button type="button" className="gus-btn" onClick={createNew}>
                <Plus size={14} /> New trigger
              </button>
            </div>
          )}
          {!loading && !selected && triggers.length > 0 && (
            <div className="gus-empty">
              <p>Select a trigger from the sidebar to view or edit it.</p>
            </div>
          )}
          {!loading && selected && (
            <CdcTriggerDetail
              trigger={selected}
              editing={editing}
              onEdit={() => setEditing(true)}
              onSave={saveTrigger}
              onCancel={() => setEditing(false)}
              onDelete={() => deleteTrigger(selected.id)}
              onToggle={() => toggleEnabled(selected)}
              host={host}
            />
          )}
        </div>
      </div>
    </section>
  );
}

interface DetailProps {
  trigger: CdcTrigger;
  editing: boolean;
  onEdit: () => void;
  onSave: (t: CdcTrigger) => void;
  onCancel: () => void;
  onDelete: () => void;
  onToggle: () => void;
  host: ModuleHost;
}

function CdcTriggerDetail({ trigger, editing, onEdit, onSave, onCancel, onDelete, onToggle, host }: DetailProps) {
  const [draft, setDraft] = useState(trigger);

  useEffect(() => {
    setDraft(trigger);
  }, [trigger]);

  const projects = host.listProjects();
  const personas = host.listPersonas();

  const validationError = useMemo(() => {
    if (!draft.name.trim()) return 'Name is required';
    if (draft.fields.length === 0) return 'At least one field is required (cost boundary)';
    if (!draft.pollEvery.trim()) return 'Poll interval is required';
    if (!draft.launch.personaId) return 'Persona is required';
    if (!draft.launch.promptTemplate.trim()) return 'Prompt template is required';
    return null;
  }, [draft]);

  const handleSave = () => {
    if (validationError) {
      host.toast(validationError, 'error');
      return;
    }
    onSave(draft);
  };

  if (!editing) {
    return (
      <div className="gus-trigger-detail">
        <div className="gus-trigger-detail-header">
          <h3>{trigger.name}</h3>
          <div className="gus-trigger-detail-actions">
            <button
              type="button"
              className="gus-btn"
              onClick={onToggle}
              title={trigger.enabled ? 'Disable trigger' : 'Enable trigger'}
            >
              {trigger.enabled ? <Pause size={14} /> : <Play size={14} />}
              {trigger.enabled ? 'Disable' : 'Enable'}
            </button>
            <button type="button" className="gus-btn" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="icon-btn" onClick={onDelete} title="Delete trigger">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="gus-trigger-detail-body">
          <div className="gus-trigger-field">
            <label>Status</label>
            <div className="gus-trigger-value">
              {trigger.enabled ? (
                <span className="gus-badge gus-badge--success">Enabled</span>
              ) : (
                <span className="gus-badge gus-badge--muted">Disabled</span>
              )}
            </div>
          </div>

          <div className="gus-trigger-field">
            <label>Project</label>
            <div className="gus-trigger-value">
              {projects.find((p) => p.id === trigger.projectId)?.name ?? trigger.projectId}
            </div>
          </div>

          <div className="gus-trigger-field">
            <label>Object</label>
            <div className="gus-trigger-value">{trigger.object}</div>
          </div>

          <div className="gus-trigger-field">
            <label>Change types</label>
            <div className="gus-trigger-value">{trigger.changeType.join(', ')}</div>
          </div>

          <div className="gus-trigger-field">
            <label>Watched fields</label>
            <div className="gus-trigger-value">{trigger.fields.join(', ')}</div>
          </div>

          <div className="gus-trigger-field">
            <label>Scope</label>
            <div className="gus-trigger-value">
              {trigger.scope.assignee === 'me' ? 'Assigned to me' : 'All'}
              {trigger.scope.scrumTeam && ` • Team ${trigger.scope.scrumTeam}`}
            </div>
          </div>

          <div className="gus-trigger-field">
            <label>Poll interval</label>
            <div className="gus-trigger-value">{trigger.pollEvery}</div>
          </div>

          <div className="gus-trigger-field">
            <label>Persona</label>
            <div className="gus-trigger-value">
              {personas.find((p) => p.id === trigger.launch.personaId)?.name ?? trigger.launch.personaId}
            </div>
          </div>

          <div className="gus-trigger-field">
            <label>Prompt template</label>
            <div className="gus-trigger-value gus-trigger-value--code">{trigger.launch.promptTemplate}</div>
          </div>

          <div className="gus-trigger-field">
            <label>Require confirmation</label>
            <div className="gus-trigger-value">{trigger.requireConfirm ? 'Yes (queue for review)' : 'No (auto-launch)'}</div>
          </div>
        </div>
      </div>
    );
  }

  // Editing mode.
  return (
    <div className="gus-trigger-detail">
      <div className="gus-trigger-detail-header">
        <h3>Edit trigger</h3>
        <div className="gus-trigger-detail-actions">
          <button type="button" className="gus-btn" onClick={handleSave} disabled={!!validationError}>
            Save
          </button>
          <button type="button" className="gus-btn gus-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <div className="gus-trigger-detail-body">
        {validationError && (
          <div className="gus-trigger-error">
            <AlertCircle size={14} /> {validationError}
          </div>
        )}

        <div className="gus-trigger-field">
          <label htmlFor="trigger-name">Name</label>
          <input
            id="trigger-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g., Bug triage watcher"
          />
        </div>

        <div className="gus-trigger-field">
          <label htmlFor="trigger-project">Project</label>
          <select
            id="trigger-project"
            value={draft.projectId}
            onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="gus-trigger-field">
          <label>Change types</label>
          <div className="gus-trigger-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={draft.changeType.includes('CREATE')}
                onChange={(e) => {
                  const types = e.target.checked
                    ? [...draft.changeType, 'CREATE']
                    : draft.changeType.filter((t) => t !== 'CREATE');
                  setDraft({ ...draft, changeType: types as Array<'CREATE' | 'UPDATE'> });
                }}
              />
              CREATE
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.changeType.includes('UPDATE')}
                onChange={(e) => {
                  const types = e.target.checked
                    ? [...draft.changeType, 'UPDATE']
                    : draft.changeType.filter((t) => t !== 'UPDATE');
                  setDraft({ ...draft, changeType: types as Array<'CREATE' | 'UPDATE'> });
                }}
              />
              UPDATE
            </label>
          </div>
        </div>

        <div className="gus-trigger-field">
          <label htmlFor="trigger-fields">Watched fields (comma-separated)</label>
          <input
            id="trigger-fields"
            type="text"
            value={draft.fields.join(', ')}
            onChange={(e) =>
              setDraft({
                ...draft,
                fields: e.target.value
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean)
              })
            }
            placeholder="e.g., Status__c, Priority__c"
          />
          <div className="gus-trigger-hint">
            Cost boundary: only changes to these fields will fire the trigger. At least one required.
          </div>
        </div>

        <div className="gus-trigger-field">
          <label>Scope</label>
          <div className="gus-trigger-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={draft.scope.assignee === 'me'}
                onChange={(e) => setDraft({ ...draft, scope: { ...draft.scope, assignee: e.target.checked ? 'me' : null } })}
              />
              Assigned to me
            </label>
          </div>
        </div>

        <div className="gus-trigger-field">
          <label htmlFor="trigger-poll">Poll interval</label>
          <input
            id="trigger-poll"
            type="text"
            value={draft.pollEvery}
            onChange={(e) => setDraft({ ...draft, pollEvery: e.target.value })}
            placeholder="e.g., 2m, 30s, 1h"
          />
          <div className="gus-trigger-hint">Minimum 1 minute. Examples: 2m, 30s, 1h.</div>
        </div>

        <div className="gus-trigger-field">
          <label htmlFor="trigger-persona">Persona</label>
          <select
            id="trigger-persona"
            value={draft.launch.personaId}
            onChange={(e) => setDraft({ ...draft, launch: { ...draft.launch, personaId: e.target.value } })}
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="gus-trigger-field">
          <label htmlFor="trigger-prompt">Prompt template</label>
          <textarea
            id="trigger-prompt"
            rows={3}
            value={draft.launch.promptTemplate}
            onChange={(e) => setDraft({ ...draft, launch: { ...draft.launch, promptTemplate: e.target.value } })}
            placeholder="e.g., Investigate {{Name}}. {{Subject__c}}"
          />
          <div className="gus-trigger-hint">
            Use {'{{'} and {'}}' } for field substitution, e.g. {'{{Name}}'}, {'{{Status__c}}'}.
          </div>
        </div>

        <div className="gus-trigger-field">
          <label>
            <input
              type="checkbox"
              checked={draft.requireConfirm}
              onChange={(e) => setDraft({ ...draft, requireConfirm: e.target.checked })}
            />
            Require confirmation (queue matches for review before launching)
          </label>
          <div className="gus-trigger-hint">
            Recommended: prevents auto-launching many sessions. Disable with caution.
          </div>
        </div>
      </div>
    </div>
  );
}
