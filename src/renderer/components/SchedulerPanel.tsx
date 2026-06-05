import { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Plus,
  Play,
  Pencil,
  Trash2,
  X,
  Sparkles,
  FolderOpen,
  ShieldCheck,
  Sun,
  Package,
  Activity,
  Inbox as InboxIcon,
  ChevronDown,
  History,
  type LucideIcon
} from 'lucide-react';
import type {
  LaunchProfileId,
  Project,
  ScheduledTask,
  ScheduleCreateInput,
  ScheduleTemplate
} from '@shared/types';
import { useData, useScheduler, useScheduleTemplates } from '../store';

const PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];
const PROFILE_LABEL: Record<LaunchProfileId, string> = {
  shell: 'Shell',
  claude: 'claude',
  'claude-resume': 'claude --resume',
  'claude-yolo': 'claude --yolo'
};

/** Whitelist of lucide icon names we honor in template metadata. Anything
 *  else falls back to the generic Sparkles icon so a typo in a hand-edited
 *  template doesn't crash the renderer. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  Sun,
  Package,
  Activity,
  Inbox: InboxIcon,
  Clock,
  Sparkles
};

function templateIcon(name: string | undefined): LucideIcon {
  return (name && TEMPLATE_ICONS[name]) || Sparkles;
}

function sourceLabel(source: ScheduleTemplate['source']): string {
  if (!source || source === 'builtin') return 'Built-in';
  if (source === 'user') return 'User';
  return source.projectName ? `Project · ${source.projectName}` : 'Project';
}

/** Label for a schedule's scope, used in the read-only Edit field. */
function scopeLabel(task: ScheduledTask | null, projects: Project[]): string {
  if (!task || !task.source || task.source === 'global') return 'Global';
  const project = projects.find((p) => p.id === (task.source as { projectId: string }).projectId);
  return project ? `Project · ${project.name}` : 'Project';
}

/** Seed values handed to ScheduleModal when "Use template" is clicked. */
interface TemplateSeed {
  template: ScheduleTemplate;
}

export function SchedulerPanel() {
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const projects = useData((s) => s.projects);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | TemplateSeed | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [tick, setTick] = useState(0);

  // 1Hz tick drives the per-row "fires in 14m 32s" countdown without
  // requiring the main process to push the same number every second.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  return (
    <main className="settings-panel scheduler-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Scheduler</h2>
            <p className="settings-help scheduler-subtitle">
              Recurring tasks that spawn a terminal in the chosen project on a
              fixed interval. Fires only while this app is running — closing
              the app stops all schedules until next launch.
            </p>
          </div>
          <div className="scheduler-header-actions">
            <button
              className="settings-btn"
              onClick={() => setPickingTemplate(true)}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'Browse templates'}
            >
              <Sparkles size={14} /> From template
            </button>
            <button
              className="settings-btn settings-btn--primary"
              onClick={() => setEditing('new')}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'New schedule'}
            >
              <Plus size={14} /> New schedule
            </button>
          </div>
        </div>

        {loading ? (
          <div className="scheduler-empty">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="scheduler-empty">
            <Clock size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No schedules yet</div>
            <div className="scheduler-empty-hint">
              Click <strong>New schedule</strong> above to create your first
              recurring task.
            </div>
          </div>
        ) : (
          <ul className="scheduler-list">
            {tasks.map((t) => (
              <ScheduleRow
                key={t.id}
                task={t}
                projectName={projects.find((p) => p.id === t.projectId)?.name ?? '⟨missing⟩'}
                onEdit={() => setEditing(t)}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ScheduleModal
          task={
            editing === 'new' || isTemplateSeed(editing)
              ? null
              : (editing as ScheduledTask)
          }
          seed={isTemplateSeed(editing) ? editing.template : null}
          onClose={() => setEditing(null)}
        />
      )}
      {pickingTemplate && (
        <TemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onPick={(template) => {
            setPickingTemplate(false);
            setEditing({ template });
          }}
        />
      )}
    </main>
  );
}

function isTemplateSeed(value: unknown): value is TemplateSeed {
  return typeof value === 'object' && value !== null && 'template' in value;
}

function ScheduleRow({
  task,
  projectName,
  onEdit
}: {
  task: ScheduledTask;
  projectName: string;
  onEdit: () => void;
}) {
  const lastRun = task.status.lastRunAt ? new Date(task.status.lastRunAt) : null;
  const nextRun = task.status.nextRunAt ? new Date(task.status.nextRunAt) : null;
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    window.cc.scheduler.setEnabled(task.id, !task.enabled).catch(() => {});
  };
  const runNow = () => {
    window.cc.scheduler.runNow(task.id).catch(() => {});
  };
  const remove = () => {
    if (!confirm(`Delete schedule "${task.name}"?`)) return;
    window.cc.scheduler.delete(task.id).catch(() => {});
  };

  const runs = task.status.runs ?? [];
  const hasHistory = runs.length > 0;

  return (
    <li className={`scheduler-card ${task.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''}`}>
      <div className="scheduler-card-main">
        <label className="scheduler-toggle" title={task.enabled ? 'Disable' : 'Enable'}>
          <input type="checkbox" checked={task.enabled} onChange={toggle} />
          <span aria-hidden />
        </label>
        <div className="scheduler-card-body">
          <div className="scheduler-card-title">{task.name}</div>
          <div className="scheduler-card-meta">
            <span className="scheduler-pill scheduler-pill--interval">every {task.schedule.every}</span>
            <span className="scheduler-pill">{projectName}</span>
            <span className="scheduler-pill">{PROFILE_LABEL[task.profile]}</span>
          </div>
          {task.description && (
            <div className="scheduler-card-desc">{task.description}</div>
          )}
          <div className="scheduler-card-status">
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Last</span>
              {lastRun ? (
                <span className={`scheduler-status-value scheduler-status-value--${task.status.lastRunResult ?? 'none'}`}>
                  {formatRelative(lastRun)}
                  {task.status.lastRunResult ? ` · ${task.status.lastRunResult}` : ''}
                </span>
              ) : (
                <span className="scheduler-status-value scheduler-status-value--none">never</span>
              )}
            </span>
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Next</span>
              <span className="scheduler-status-value">
                {task.enabled && nextRun ? `in ${formatCountdown(nextRun)}` : 'paused'}
              </span>
            </span>
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Runs</span>
              <span className="scheduler-status-value">{task.status.runCount}</span>
            </span>
          </div>
        </div>
        <div className="scheduler-card-actions">
          <button className="scheduler-icon-btn" onClick={runNow} title="Run now" aria-label="Run now">
            <Play size={14} />
          </button>
          <button className="scheduler-icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
            <Pencil size={14} />
          </button>
          <button
            className="scheduler-icon-btn scheduler-icon-btn--danger"
            onClick={remove}
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </button>
          <button
            className={`scheduler-icon-btn scheduler-icon-btn--chevron ${expanded ? 'is-open' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Hide history' : 'Show history'}
            aria-label="Toggle history"
            aria-expanded={expanded}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="scheduler-card-history">
          <div className="scheduler-card-history-header">
            <History size={12} />
            <span>Recent runs</span>
            <span className="scheduler-card-history-count">
              {hasHistory ? `${runs.length} of ${task.history?.retain ?? 10}` : 'none yet'}
            </span>
          </div>
          {hasHistory ? (
            <ul className="scheduler-run-list">
              {runs.map((run, i) => (
                <li
                  key={`${run.at}-${run.sessionId ?? i}`}
                  className={`scheduler-run-row scheduler-run-row--${run.result}`}
                >
                  <span className={`scheduler-run-dot scheduler-run-dot--${run.result}`} />
                  <span className="scheduler-run-when" title={new Date(run.at).toLocaleString()}>
                    {formatRelative(new Date(run.at))}
                  </span>
                  <span className="scheduler-run-result">{run.result}</span>
                  <span className="scheduler-run-duration">
                    {run.durationMs !== undefined ? formatDuration(run.durationMs) : '—'}
                  </span>
                  {run.message && (
                    <span className="scheduler-run-message" title={run.message}>
                      {run.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="scheduler-run-empty">
              No runs recorded yet. The first fire will appear here.
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ScheduleModal({
  task,
  seed,
  onClose
}: {
  task: ScheduledTask | null;
  seed?: ScheduleTemplate | null;
  onClose: () => void;
}) {
  const projects = useData((s) => s.projects);
  const [name, setName] = useState(
    task?.name ?? seed?.defaults.name ?? seed?.name ?? ''
  );
  const [description, setDescription] = useState(
    task?.description ?? seed?.defaults.description ?? seed?.description ?? ''
  );
  const [projectId, setProjectId] = useState(task?.projectId ?? projects[0]?.id ?? '');
  const [profile, setProfile] = useState<LaunchProfileId>(
    task?.profile ?? seed?.defaults.profile ?? 'claude'
  );
  const [every, setEvery] = useState(
    task?.schedule.every ?? seed?.defaults.every ?? '1h'
  );
  const [prompt, setPrompt] = useState(task?.prompt ?? seed?.defaults.prompt ?? '');
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isNew = task === null;
  const canSave = useMemo(
    () => name.trim().length > 0 && projectId && every.trim().length > 0,
    [name, projectId, every]
  );

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const input: ScheduleCreateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          enabled,
          projectId,
          profile,
          every,
          prompt: prompt.trim() || undefined,
          extraArgs: seed?.defaults.extraArgs,
          scope: scope === 'project' ? { projectId } : 'global'
        };
        const result = await window.cc.scheduler.create(input);
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      } else {
        const result = await window.cc.scheduler.update(task!.id, {
          name: name.trim(),
          description: description.trim(),
          enabled,
          projectId,
          profile,
          every,
          prompt
        });
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal scheduler-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'New schedule' : 'Edit schedule'}
      >
        <header className="modal-header">
          <h3>{isNew ? (seed ? `New schedule · ${seed.name}` : 'New schedule') : 'Edit schedule'}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          {seed && (
            <div className="scheduler-template-banner">
              <Sparkles size={14} />
              <span>
                Pre-filled from template <strong>{seed.name}</strong>{' '}
                <span className="scheduler-pill scheduler-pill--source">
                  {sourceLabel(seed.source)}
                </span>
              </span>
            </div>
          )}
          <div className="scheduler-form-field">
            <label htmlFor="sched-name">Name</label>
            <input
              id="sched-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Morning standup digest"
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="sched-desc">Description <span className="scheduler-form-optional">(optional)</span></label>
            <input
              id="sched-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="scheduler-form-row">
            <div className="scheduler-form-field">
              <label htmlFor="sched-project">Project</label>
              <select
                id="sched-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="scheduler-form-field">
              <label htmlFor="sched-profile">Launch profile</label>
              <select
                id="sched-profile"
                value={profile}
                onChange={(e) => setProfile(e.target.value as LaunchProfileId)}
              >
                {PROFILES.map((p) => (
                  <option key={p} value={p}>{PROFILE_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>
          {isNew ? (
            <div className="scheduler-form-field">
              <label>Scope</label>
              <div className="scheduler-scope-picker" role="radiogroup">
                <label className={`scheduler-scope-option ${scope === 'global' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="sched-scope"
                    checked={scope === 'global'}
                    onChange={() => setScope('global')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Global</span>
                    <span className="scheduler-scope-hint">~/.cc-center/schedules — visible across the app</span>
                  </div>
                </label>
                <label className={`scheduler-scope-option ${scope === 'project' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="sched-scope"
                    checked={scope === 'project'}
                    onChange={() => setScope('project')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Project</span>
                    <span className="scheduler-scope-hint">
                      &lt;project&gt;/.cc-center/schedules — checked in with the repo
                    </span>
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div className="scheduler-form-field">
              <label>Scope</label>
              <div className="scheduler-scope-readonly">
                <span className="scheduler-pill scheduler-pill--source">
                  {scopeLabel(task, projects)}
                </span>
                <span className="scheduler-form-optional">
                  Move the JSON file by hand to change scope.
                </span>
              </div>
            </div>
          )}
          <div className="scheduler-form-field">
            <label htmlFor="sched-every">Interval</label>
            <input
              id="sched-every"
              type="text"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              placeholder="5m, 1h, 24h"
            />
            <p className="modal-hint">Minimum 1 minute. Examples: <code>5m</code>, <code>1h</code>, <code>1h30m</code>, <code>24h</code>.</p>
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="sched-prompt">Initial prompt <span className="scheduler-form-optional">(optional)</span></label>
            <textarea
              id="sched-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Typed into the new terminal on launch (followed by Enter)."
            />
          </div>
          <label className="scheduler-form-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enabled</span>
          </label>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={save}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TemplatePickerModal({
  onClose,
  onPick
}: {
  onClose: () => void;
  onPick: (template: ScheduleTemplate) => void;
}) {
  const templates = useScheduleTemplates((s) => s.templates);
  const loading = useScheduleTemplates((s) => s.loading);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const haystack = `${t.name} ${t.description ?? ''} ${t.category ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [templates, query]);

  const grouped = useMemo(() => {
    const out = new Map<string, ScheduleTemplate[]>();
    for (const t of filtered) {
      const key = t.category ?? 'Uncategorized';
      const list = out.get(key) ?? [];
      list.push(t);
      out.set(key, list);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const reveal = () => {
    window.cc.scheduler.revealTemplatesDir().catch(() => {});
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal scheduler-template-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Schedule templates"
      >
        <header className="modal-header">
          <h3>Schedule templates</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="scheduler-template-toolbar">
          <input
            className="scheduler-template-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            autoFocus
          />
          <button
            className="settings-btn scheduler-template-folder-btn"
            onClick={reveal}
            title="Drop your own JSON templates in this folder"
          >
            <FolderOpen size={14} /> Open templates folder
          </button>
        </div>
        <div className="modal-body scheduler-template-body">
          {loading ? (
            <div className="scheduler-empty">Loading templates…</div>
          ) : filtered.length === 0 ? (
            <div className="scheduler-empty">
              <Sparkles size={28} className="scheduler-empty-icon" />
              <div className="scheduler-empty-title">No matching templates</div>
              <div className="scheduler-empty-hint">
                Drop a JSON file in <code>~/.cc-center/templates/</code> to add your own.
              </div>
            </div>
          ) : (
            grouped.map(([category, items]) => (
              <section key={category} className="scheduler-template-group">
                <h4 className="scheduler-template-group-title">{category}</h4>
                <ul className="scheduler-template-grid">
                  {items.map((t) => {
                    const Icon = templateIcon(t.icon);
                    return (
                      <li key={t.id}>
                        <button
                          className="scheduler-template-card"
                          onClick={() => onPick(t)}
                        >
                          <div className="scheduler-template-card-head">
                            <span className="scheduler-template-icon">
                              <Icon size={16} />
                            </span>
                            <span className="scheduler-template-name">{t.name}</span>
                            <span className="scheduler-pill scheduler-pill--source">
                              {sourceLabel(t.source)}
                            </span>
                          </div>
                          {t.description && (
                            <p className="scheduler-template-desc">{t.description}</p>
                          )}
                          <div className="scheduler-template-meta">
                            <span className="scheduler-pill scheduler-pill--interval">
                              every {t.defaults.every}
                            </span>
                            <span className="scheduler-pill">
                              {PROFILE_LABEL[t.defaults.profile]}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function formatCountdown(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}
