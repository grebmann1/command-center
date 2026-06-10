import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react';
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
  Copy,
  Pause,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CircleSlash,
  Folder,
  Square,
  ExternalLink,
  type LucideIcon
} from 'lucide-react';
import type {
  LaunchProfileId,
  Project,
  ScheduledTask,
  ScheduleCreateInput,
  ScheduleRun,
  ScheduleTemplate
} from '@shared/types';
import { parseEvery, formatInterval } from '@shared/parse-every';
import { useData, useScheduler, useScheduleTemplates, useUi } from '../store';

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

/** Seed values handed to ScheduleModal. May come from a template ("Use this")
 *  or a duplicate of an existing schedule ("Duplicate"). */
type Seed =
  | { kind: 'template'; template: ScheduleTemplate }
  | { kind: 'duplicate'; source: ScheduledTask };

export function SchedulerPanel() {
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const projects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | Seed | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTask | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  /** When the user hits "Pause all", we stash the ids that were enabled so
   *  "Resume all" only re-enables those. Session-local — by design. */
  const [pausedSet, setPausedSet] = useState<Set<string> | null>(null);

  // 1Hz tick drives the per-row "fires in 14m 32s" countdown and the Overview's
  // time-relative computations without the main process pushing the same number
  // every second. `tick` is also passed into SchedulerOverview so that component
  // shares this single timer instead of running its own.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const schedulerTab = useUi((s) => s.schedulerTab);
  const selectedProjectId = useUi((s) => s.selectedProjectId);

  useEffect(() => {
    setPausedSet(null);
  }, [schedulerTab, selectedProjectId]);

  const scopedTasks = useMemo(() => {
    if (schedulerTab === 'global') {
      return tasks.filter((t) => !t.source || t.source === 'global');
    }
    if (!selectedProjectId) return [];
    return tasks.filter(
      (t) =>
        t.source &&
        t.source !== 'global' &&
        (t.source as { projectId: string }).projectId === selectedProjectId
    );
  }, [tasks, schedulerTab, selectedProjectId]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scopedTasks;
    return scopedTasks.filter((t) => {
      const project = projects.find((p) => p.id === t.projectId);
      const haystack = [
        t.name,
        t.description ?? '',
        t.profile,
        project?.name ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [scopedTasks, projects, search]);

  const pauseAll = async () => {
    const enabledIds = new Set(scopedTasks.filter((t) => t.enabled).map((t) => t.id));
    setPausedSet(enabledIds);
    await Promise.all(
      scopedTasks
        .filter((t) => t.enabled)
        .map((t) => window.cc.scheduler.setEnabled(t.id, false).catch(() => null))
    );
  };

  const resumeAll = async () => {
    if (!pausedSet) return;
    const ids = [...pausedSet];
    setPausedSet(null);
    await Promise.all(
      ids.map((id) => window.cc.scheduler.setEnabled(id, true).catch(() => null))
    );
  };

  const handleSeedFromTask = (source: ScheduledTask) => {
    setEditing({ kind: 'duplicate', source });
  };

  return (
    <main className="settings-panel scheduler-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Scheduler</h2>
            <p className="settings-help scheduler-subtitle">
              Recurring tasks that spawn a terminal in the chosen project on a
              fixed interval.
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

        <aside className="scheduler-banner-info" role="note">
          <AlertTriangle size={14} />
          <div>
            <strong>Schedules only fire while this app is running.</strong>{' '}
            Closing the app stops all schedules until next launch — there is
            no background daemon. The "app open" pill on each row is a reminder.
          </div>
        </aside>

        {projects.length === 0 ? (
          <div className="scheduler-empty">
            <Clock size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No projects yet</div>
            <div className="scheduler-empty-hint">
              Add a project before creating a schedule.{' '}
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setNav('projects')}
                style={{ marginTop: 8 }}
              >
                Go to Projects
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="scheduler-empty">Loading…</div>
        ) : schedulerTab === 'overview' ? (
          <SchedulerOverview
            tasks={tasks}
            projects={projects}
            tick={tick}
            onJump={(t) => {
              if (t.source && t.source !== 'global') {
                useUi.getState().selectProject((t.source as { projectId: string }).projectId);
                useUi.getState().setSchedulerTab('project');
              } else {
                useUi.getState().setSchedulerTab('global');
              }
            }}
            onOpenTerminal={(t, sessionId) => {
              // Switch to the project's tab strip and select the live session
              // — same path as a Scheduler row's "Open" button.
              useUi.getState().setNav('projects');
              useUi.getState().selectProject(t.projectId);
              useUi.getState().selectTab(t.projectId, sessionId);
            }}
            onEdit={(t) => setEditing(t)}
          />
        ) : scopedTasks.length === 0 ? (
          <EmptyStateWithFeatured
            onPick={(template) => setEditing({ kind: 'template', template })}
            onCreateBlank={() => setEditing('new')}
          />
        ) : (
          <>
            <div className="scheduler-list-toolbar">
              <input
                className="scheduler-list-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, project, profile…"
              />
              {pausedSet ? (
                <button
                  className="settings-btn scheduler-pause-all"
                  onClick={resumeAll}
                  title="Re-enable schedules that were on before Pause all"
                >
                  <PlayCircle size={14} /> Resume all
                </button>
              ) : (
                <button
                  className="settings-btn scheduler-pause-all"
                  onClick={pauseAll}
                  disabled={!scopedTasks.some((t) => t.enabled)}
                  title="Disable every enabled schedule (session-local)"
                >
                  <Pause size={14} /> Pause all
                </button>
              )}
            </div>
            {filteredTasks.length === 0 ? (
              <div className="scheduler-empty">
                <div className="scheduler-empty-title">No schedules match</div>
                <div className="scheduler-empty-hint">
                  Try a different search term or clear the filter.
                </div>
              </div>
            ) : (
              <ul className="scheduler-list">
                {filteredTasks.map((t) => (
                  <ScheduleRow
                    key={t.id}
                    task={t}
                    projectName={
                      projects.find((p) => p.id === t.projectId)?.name ?? '⟨missing⟩'
                    }
                    onEdit={() => setEditing(t)}
                    onDuplicate={() => handleSeedFromTask(t)}
                    onAskDelete={() => setConfirmDelete(t)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editing && (
        <ScheduleModal
          task={
            editing === 'new' || isSeed(editing) ? null : (editing as ScheduledTask)
          }
          seed={isSeed(editing) ? editing : null}
          onClose={() => setEditing(null)}
        />
      )}
      {pickingTemplate && (
        <TemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onPick={(template) => {
            setPickingTemplate(false);
            setEditing({ kind: 'template', template });
          }}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          task={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            const result = await window.cc.scheduler.delete(id);
            if (!result.ok) {
              useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
            }
          }}
        />
      )}
    </main>
  );
}

function isSeed(value: unknown): value is Seed {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ((value as { kind: string }).kind === 'template' ||
      (value as { kind: string }).kind === 'duplicate')
  );
}

function EmptyStateWithFeatured({
  onPick,
  onCreateBlank
}: {
  onPick: (template: ScheduleTemplate) => void;
  onCreateBlank: () => void;
}) {
  const templates = useScheduleTemplates((s) => s.templates);
  const featured = useMemo(
    () => templates.filter((t) => t.source === 'builtin').slice(0, 3),
    [templates]
  );
  return (
    <div className="scheduler-empty">
      <Clock size={28} className="scheduler-empty-icon" />
      <div className="scheduler-empty-title">No schedules yet</div>
      <div className="scheduler-empty-hint">
        Start from a template, or click{' '}
        <button
          className="settings-btn settings-btn--primary"
          onClick={onCreateBlank}
          style={{ marginLeft: 6 }}
        >
          <Plus size={12} /> New schedule
        </button>
      </div>
      {featured.length > 0 && (
        <div className="scheduler-featured">
          <div className="scheduler-featured-title">Featured templates</div>
          <ul className="scheduler-featured-grid scheduler-template-grid">
            {featured.map((t) => {
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
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  task,
  projectName,
  onEdit,
  onDuplicate,
  onAskDelete
}: {
  task: ScheduledTask;
  projectName: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
}) {
  const lastRun = task.status.lastRunAt ? new Date(task.status.lastRunAt) : null;
  const nextRun = task.status.nextRunAt ? new Date(task.status.nextRunAt) : null;
  const [expanded, setExpanded] = useState(false);
  const terminals = useData((s) => s.terminals);
  const setNav = useUi((s) => s.setNav);
  const selectTab = useUi((s) => s.selectTab);
  const selectProject = useUi((s) => s.selectProject);
  const pushToast = useUi((s) => s.pushToast);

  const toggle = async () => {
    const result = await window.cc.scheduler.setEnabled(task.id, !task.enabled);
    if (!result.ok) pushToast(result.message, 'error');
  };
  const runNow = async () => {
    const result = await window.cc.scheduler.runNow(task.id);
    if (!result.ok) {
      pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    // Tab appears in the project automatically (scheduler spawns visibly);
    // the toast confirms the fire so the user knows it took effect.
    pushToast(`Fired "${task.name}"`, 'info');
  };

  const projectTerminals = terminals[task.projectId] ?? [];
  const isSessionAlive = (sessionId: string) =>
    projectTerminals.some(
      (s) => s.id === sessionId && (s.status === 'running' || s.status === 'starting')
    );

  const runs = task.status.runs ?? [];
  const hasHistory = runs.length > 0;

  // Walk runs newest→oldest to find the most-recent sessionId that's still
  // alive. Fixes the case where a fire was skipped (no sessionId on the head
  // record) but the previous run's session is still active and should be
  // surfaced as "running".
  const liveSessionId = (() => {
    for (const run of runs) {
      if (run.sessionId && isSessionAlive(run.sessionId)) return run.sessionId;
    }
    return null;
  })();
  const liveSession = liveSessionId
    ? projectTerminals.find((s) => s.id === liveSessionId) ?? null
    : null;
  const needsAttention = liveSession?.attention === 'waiting';

  const promoteAndOpen = (sessionId: string) => {
    // Scheduled fires now spawn visible tabs directly; this is just a deep-link
    // helper that switches the user's view to the running session.
    setNav('projects');
    selectProject(task.projectId);
    selectTab(task.projectId, sessionId);
  };

  const jumpToRun = (sessionId: string | undefined) => {
    if (!sessionId) return;
    if (!isSessionAlive(sessionId)) return;
    void promoteAndOpen(sessionId);
  };

  const stopLive = async (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    try {
      await window.cc.terminals.close(liveSessionId);
      pushToast(`Stopped "${task.name}"`, 'info');
    } catch {
      pushToast(`Failed to stop "${task.name}"`, 'error');
    }
  };

  const openLive = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    void promoteAndOpen(liveSessionId);
  };

  const statusKind = liveSessionId ? 'running' : task.enabled ? 'idle' : 'off';
  const statusLabel = liveSessionId ? 'running' : task.enabled ? 'idle' : 'off';

  // Stop the row's expand-toggle from firing when the user clicks
  // an inner control. Each handler still runs normally.
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  return (
    <li className={`scheduler-card ${task.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''} ${liveSessionId ? 'is-running' : ''}`}>
      <div
        className="scheduler-card-main scheduler-card-main--compact"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <span
          className={`scheduler-status-dot scheduler-status-dot--${statusKind}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
        <label className="scheduler-toggle" onClick={stop} title={task.enabled ? 'Disable schedule' : 'Enable schedule'}>
          <input type="checkbox" checked={task.enabled} onChange={toggle} />
          <span aria-hidden />
        </label>
        <div className="scheduler-card-compact-body">
          <span className="scheduler-card-title">{task.name}</span>
          <span className="scheduler-card-compact-meta">
            {projectName} · {PROFILE_LABEL[task.profile]} · every {task.schedule.every}
          </span>
        </div>
        <div className="scheduler-card-compact-when">
          {liveSessionId ? (
            needsAttention ? (
              <span
                className="scheduler-pill scheduler-pill--attention"
                title="Claude is waiting on you — click Open"
              >
                needs you
              </span>
            ) : (
              <span className="scheduler-pill scheduler-pill--running" title="Terminal session is live">
                running
              </span>
            )
          ) : task.enabled && nextRun ? (
            <span className="scheduler-card-compact-next" title="Next fire">
              in {formatCountdown(nextRun)}
            </span>
          ) : (
            <span className="scheduler-card-compact-next scheduler-card-compact-next--muted">paused</span>
          )}
        </div>
        <div className="scheduler-card-actions" onClick={stop}>
          {liveSessionId && (
            <>
              <button
                className="scheduler-icon-btn"
                onClick={openLive}
                title="Open running terminal"
                aria-label="Open running terminal"
              >
                <ExternalLink size={14} />
              </button>
              <button
                className="scheduler-icon-btn scheduler-icon-btn--danger"
                onClick={stopLive}
                title="Stop running terminal"
                aria-label="Stop running terminal"
              >
                <Square size={14} />
              </button>
            </>
          )}
          {!liveSessionId && (
            <button className="scheduler-icon-btn" onClick={runNow} title="Run now" aria-label="Run now">
              <Play size={14} />
            </button>
          )}
          <button
            className={`scheduler-icon-btn scheduler-icon-btn--chevron ${expanded ? 'is-open' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            title={expanded ? 'Hide details' : 'Show details'}
            aria-label="Toggle details"
            aria-expanded={expanded}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="scheduler-card-detail">
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
              {task.enabled && (
                <span className="scheduler-pill scheduler-pill--app-open" title="Schedule fires only while this app is running">
                  app open
                </span>
              )}
            </span>
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Runs</span>
              <span className="scheduler-status-value">{task.status.runCount}</span>
            </span>
          </div>
          <div className="scheduler-card-detail-actions">
            <button className="scheduler-icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
              <Pencil size={14} />
            </button>
            <button
              className="scheduler-icon-btn"
              onClick={onDuplicate}
              title="Duplicate"
              aria-label="Duplicate"
            >
              <Copy size={14} />
            </button>
            <button
              className="scheduler-icon-btn scheduler-icon-btn--danger"
              onClick={onAskDelete}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
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
              {runs.map((run, i) => {
                const alive = run.sessionId ? isSessionAlive(run.sessionId) : false;
                const clickable = alive;
                return (
                  <li
                    key={`${run.at}-${run.sessionId ?? i}`}
                    className={`scheduler-run-row scheduler-run-row--${run.result} ${
                      clickable ? 'is-clickable' : run.sessionId ? 'is-closed' : ''
                    }`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => jumpToRun(run.sessionId) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              jumpToRun(run.sessionId);
                            }
                          }
                        : undefined
                    }
                    title={
                      clickable
                        ? 'Jump to terminal'
                        : run.sessionId
                        ? 'Session closed'
                        : undefined
                    }
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
                );
              })}
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
  seed?: Seed | null;
  onClose: () => void;
}) {
  const projects = useData((s) => s.projects);
  const schedulerTab = useUi((s) => s.schedulerTab);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const seededTask = seed?.kind === 'duplicate' ? seed.source : null;
  const seededTemplate = seed?.kind === 'template' ? seed.template : null;

  const [name, setName] = useState(
    task?.name
      ?? (seededTask ? `${seededTask.name} (copy)` : undefined)
      ?? seededTemplate?.defaults.name
      ?? seededTemplate?.name
      ?? ''
  );
  const [description, setDescription] = useState(
    task?.description
      ?? seededTask?.description
      ?? seededTemplate?.defaults.description
      ?? seededTemplate?.description
      ?? ''
  );
  const [projectId, setProjectId] = useState(
    task?.projectId
      ?? seededTask?.projectId
      ?? (schedulerTab === 'project' ? selectedProjectId : null)
      ?? projects[0]?.id
      ?? ''
  );
  const [profile, setProfile] = useState<LaunchProfileId>(
    task?.profile ?? seededTask?.profile ?? seededTemplate?.defaults.profile ?? 'claude'
  );
  const [every, setEvery] = useState(
    task?.schedule.every ?? seededTask?.schedule.every ?? seededTemplate?.defaults.every ?? '1h'
  );
  const [prompt, setPrompt] = useState(
    task?.prompt ?? seededTask?.prompt ?? seededTemplate?.defaults.prompt ?? ''
  );
  const [notifyInbox, setNotifyInbox] = useState<boolean>(
    task?.notifyInbox ?? seededTask?.notifyInbox ?? false
  );
  const [autoCloseOnFinish, setAutoCloseOnFinish] = useState<boolean>(
    task?.autoCloseOnFinish ?? seededTask?.autoCloseOnFinish ?? false
  );
  const [scope, setScope] = useState<'global' | 'project'>(() => {
    if (task?.source && task.source !== 'global') return 'project';
    if (seededTask?.source && seededTask.source !== 'global') return 'project';
    if (task === null && !seededTask && schedulerTab === 'project' && selectedProjectId) {
      return 'project';
    }
    return 'global';
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isNew = task === null;
  const intervalMs = useMemo(() => parseEvery(every), [every]);
  const intervalValid = intervalMs !== null;
  const canSave = useMemo(
    () => name.trim().length > 0 && Boolean(projectId) && intervalValid,
    [name, projectId, intervalValid]
  );

  const banner = (() => {
    if (seededTemplate) {
      return (
        <div className="scheduler-template-banner">
          <Sparkles size={14} />
          <span>
            Pre-filled from template <strong>{seededTemplate.name}</strong>{' '}
            <span className="scheduler-pill scheduler-pill--source">
              {sourceLabel(seededTemplate.source)}
            </span>
          </span>
        </div>
      );
    }
    if (seededTask) {
      return (
        <div className="scheduler-template-banner">
          <Copy size={14} />
          <span>
            Duplicating <strong>{seededTask.name}</strong> — change the name or
            project before saving.
          </span>
        </div>
      );
    }
    return null;
  })();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const input: ScheduleCreateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          enabled: true,
          projectId,
          profile,
          every,
          prompt: prompt.trim() || undefined,
          extraArgs: seededTemplate?.defaults.extraArgs ?? seededTask?.extraArgs,
          scope: scope === 'project' ? { projectId } : 'global',
          notifyInbox,
          autoCloseOnFinish
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
          projectId,
          profile,
          every,
          prompt,
          notifyInbox,
          autoCloseOnFinish
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

  // Esc closes, Cmd/Ctrl+Enter saves (when valid).
  const modalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSave && !saving) void save();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
    // We deliberately omit `save` from deps — it captures `canSave`/`saving`
    // already, and re-binding the listener every keystroke is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, saving]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal scheduler-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'New schedule' : 'Edit schedule'}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>
            {isNew
              ? seededTemplate
                ? `New schedule · ${seededTemplate.name}`
                : seededTask
                ? 'Duplicate schedule'
                : 'New schedule'
              : 'Edit schedule'}
          </h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          {banner}
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
              className={every.trim() && !intervalValid ? 'is-invalid' : ''}
            />
            {every.trim() ? (
              intervalValid ? (
                <p className="scheduler-interval-feedback scheduler-interval-feedback--ok">
                  ≈ every {formatInterval(intervalMs!)}
                </p>
              ) : (
                <p className="scheduler-interval-feedback scheduler-interval-feedback--err">
                  Invalid format. Use units: <code>s</code>, <code>m</code>, <code>h</code>, <code>d</code> (e.g. <code>1h30m</code>).
                </p>
              )
            ) : (
              <p className="modal-hint">Minimum 1 minute. Examples: <code>5m</code>, <code>1h</code>, <code>1h30m</code>, <code>24h</code>.</p>
            )}
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="sched-prompt">Initial prompt <span className="scheduler-form-optional">(optional)</span></label>
            <textarea
              id="sched-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Passed to the spawned terminal as the initial prompt."
            />
          </div>
          <div className="scheduler-form-field">
            <label className="scheduler-checkbox-row">
              <input
                type="checkbox"
                checked={notifyInbox}
                onChange={(e) => setNotifyInbox(e.target.checked)}
              />
              <span>
                Notify on completion
                <span className="scheduler-form-optional">
                  {' '}— append an inbox entry summarising each run.
                </span>
              </span>
            </label>
          </div>
          <div className="scheduler-form-field">
            <label
              className="scheduler-checkbox-row"
              title={
                profile === 'shell'
                  ? 'Only available for claude profiles — a shell has no “finished” signal.'
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={autoCloseOnFinish && profile !== 'shell'}
                disabled={profile === 'shell'}
                onChange={(e) => setAutoCloseOnFinish(e.target.checked)}
              />
              <span>
                Auto-close when finished
                <span className="scheduler-form-optional">
                  {' '}— close the terminal once Claude finishes responding
                  (via a Stop hook). Otherwise the tab stays open.
                </span>
              </span>
            </label>
          </div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={save}
            disabled={!canSave || saving}
            title={canSave ? '⌘+Enter to save' : 'Fix the errors above'}
          >
            {saving ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  task,
  onCancel,
  onConfirm
}: {
  task: ScheduledTask;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={ref}
        className="modal scheduler-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label="Delete schedule"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>Delete schedule?</h3>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body scheduler-confirm-body">
          This will permanently remove <strong>{task.name}</strong>. The
          on-disk JSON file is deleted; runs in progress are not interrupted.
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn danger" onClick={onConfirm} autoFocus>
            Delete
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

function SchedulerOverview({
  tasks,
  projects,
  tick,
  onJump,
  onOpenTerminal,
  onEdit
}: {
  tasks: ScheduledTask[];
  projects: Project[];
  tick: number;
  onJump: (t: ScheduledTask) => void;
  onOpenTerminal: (t: ScheduledTask, sessionId: string) => void;
  onEdit: (t: ScheduledTask) => void;
}) {
  const terminalsByProject = useData((s) => s.terminals);

  const { enabled, disabled, running, runs24, success24, errors24, skipped24 } = useMemo(() => {
    const en = tasks.filter((t) => t.enabled);
    const live = new Set<string>();
    for (const [pid, list] of Object.entries(terminalsByProject)) {
      for (const s of list) {
        if (s.status === 'running' || s.status === 'starting') {
          live.add(`${pid}:${s.id}`);
        }
      }
    }
    // Walk the run history newest→oldest so a task whose latest record is a
    // 'skipped' (no sessionId) but whose previous run is still alive still
    // shows up. Emit one row per live task with its live session id.
    const run: Array<{ task: ScheduledTask; sessionId: string }> = [];
    for (const t of tasks) {
      const runs = t.status?.runs ?? [];
      let sid: string | null = null;
      for (const r of runs) {
        if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
          sid = r.sessionId;
          break;
        }
      }
      if (sid) run.push({ task: t, sessionId: sid });
    }
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    let r24 = 0, ok = 0, err = 0, skip = 0;
    for (const t of tasks) {
      for (const r of t.status?.runs ?? []) {
        const ts = Date.parse(r.at);
        if (Number.isNaN(ts) || ts < dayAgo) continue;
        r24++;
        if (r.result === 'success') ok++;
        else if (r.result === 'error') err++;
        else if (r.result === 'skipped') skip++;
      }
    }
    return {
      enabled: en,
      disabled: tasks.length - en.length,
      running: run,
      runs24: r24,
      success24: ok,
      errors24: err,
      skipped24: skip
    };
    // dayAgo and live-session liveness depend on real time; tick keeps them fresh.
  }, [tasks, terminalsByProject, tick]);

  const upcoming = useMemo(
    () =>
      enabled
        .map((t) => ({ task: t, at: t.status?.nextRunAt ? new Date(t.status.nextRunAt) : null }))
        .filter((x): x is { task: ScheduledTask; at: Date } => x.at !== null && !Number.isNaN(x.at.getTime()))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .slice(0, 10),
    [enabled]
  );

  const recent = useMemo(
    () =>
      tasks
        .flatMap((t) => (t.status?.runs ?? []).map((r) => ({ task: t, run: r, ts: Date.parse(r.at) })))
        .filter((x) => !Number.isNaN(x.ts))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 12),
    [tasks]
  );

  const projectStats = useMemo(
    () =>
      projects
        .map((p) => {
          const own = tasks.filter((t) => t.projectId === p.id);
          const en = own.filter((t) => t.enabled).length;
          const lastTs = own
            .flatMap((t) => (t.status?.lastRunAt ? [Date.parse(t.status.lastRunAt)] : []))
            .filter((n) => !Number.isNaN(n))
            .sort((a, b) => b - a)[0];
          return {
            project: p,
            total: own.length,
            enabled: en,
            disabled: own.length - en,
            lastRun: lastTs ?? null
          };
        })
        .filter((s) => s.total > 0)
        .sort((a, b) => b.total - a.total),
    [tasks, projects]
  );

  const nextFire = upcoming[0]?.at ?? null;

  return (
    <div className="scheduler-overview">
      <section className="overview-kpis">
        <KpiCard label="Schedules" value={tasks.length} sub={`${enabled.length} on · ${disabled} off`} />
        <KpiCard label="Running now" value={running.length} sub={running.length === 0 ? 'No live sessions' : 'Live terminal sessions'} accent={running.length > 0 ? 'live' : undefined} />
        <KpiCard
          label="Next fire"
          value={nextFire ? formatCountdown(nextFire) : '—'}
          sub={nextFire ? upcoming[0].task.name : 'Nothing scheduled'}
        />
        <KpiCard
          label="Last 24h"
          value={runs24}
          sub={`${success24} ok · ${errors24} err · ${skipped24} skip`}
          accent={errors24 > 0 ? 'error' : undefined}
        />
      </section>

      {running.length > 0 && (
        <section className="overview-card">
          <header className="overview-card-header">
            <Activity size={14} />
            <h3>Running now</h3>
            <span className="overview-card-badge">{running.length}</span>
          </header>
          <ul className="overview-list">
            {running.map(({ task, sessionId }) => {
              const project = projects.find((p) => p.id === task.projectId);
              return (
                <li key={task.id} className="overview-item">
                  <span
                    className="scheduler-status-dot scheduler-status-dot--running"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Jump into the running terminal"
                  >
                    <div className="overview-item-name">{task.name}</div>
                    <div className="overview-item-meta">
                      {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[task.profile]} · every {formatInterval(parseEvery(task.schedule.every) ?? 0)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Open running terminal"
                    aria-label="Open running terminal"
                  >
                    <ExternalLink size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="overview-columns">
        <section className="overview-card">
          <header className="overview-card-header">
            <Clock size={14} />
            <h3>Next up</h3>
          </header>
          {upcoming.length === 0 ? (
            <div className="overview-empty">No upcoming fires. Enable a schedule to populate this list.</div>
          ) : (
            <ul className="overview-list">
              {upcoming.map(({ task, at }) => {
                const project = projects.find((p) => p.id === task.projectId);
                return (
                  <li key={task.id} className="overview-item">
                    <button
                      type="button"
                      className="overview-item-main"
                      onClick={() => onEdit(task)}
                      title="Edit schedule"
                    >
                      <div className="overview-item-name">{task.name}</div>
                      <div className="overview-item-meta">
                        {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[task.profile]} · every {formatInterval(parseEvery(task.schedule.every) ?? 0)}
                      </div>
                    </button>
                    <div className="overview-item-when">
                      <div className="overview-item-countdown">{formatCountdown(at)}</div>
                      <div className="overview-item-abs">{at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="overview-card">
          <header className="overview-card-header">
            <History size={14} />
            <h3>Recent activity</h3>
          </header>
          {recent.length === 0 ? (
            <div className="overview-empty">No runs recorded yet.</div>
          ) : (
            <ul className="overview-list">
              {recent.map(({ task, run, ts }, i) => (
                <li key={`${task.id}-${i}`} className="overview-item">
                  <div className={`overview-result overview-result--${run.result}`}>
                    {run.result === 'success' ? (
                      <CheckCircle2 size={14} />
                    ) : run.result === 'error' ? (
                      <XCircle size={14} />
                    ) : (
                      <CircleSlash size={14} />
                    )}
                  </div>
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onJump(task)}
                    title="Open in scope"
                  >
                    <div className="overview-item-name">{task.name}</div>
                    <div className="overview-item-meta">
                      {run.result}
                      {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ''}
                      {run.message ? ` · ${run.message}` : ''}
                    </div>
                  </button>
                  <div className="overview-item-when">
                    <div className="overview-item-abs">{formatRelative(new Date(ts))}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overview-card">
        <header className="overview-card-header">
          <Folder size={14} />
          <h3>By project</h3>
        </header>
        {projectStats.length === 0 ? (
          <div className="overview-empty">No project schedules yet.</div>
        ) : (
          <ul className="overview-projects">
            {projectStats.map((s) => (
              <li key={s.project.id} className="overview-project-row">
                <span
                  className="project-dot"
                  style={s.project.color ? { background: s.project.color } : undefined}
                />
                <button
                  type="button"
                  className="overview-project-name"
                  onClick={() => {
                    useUi.getState().selectProject(s.project.id);
                    useUi.getState().setSchedulerTab('project');
                  }}
                  title="Open project schedules"
                >
                  {s.project.name}
                </button>
                <span className="overview-project-count">{s.total}</span>
                <span className="overview-project-split">
                  {s.enabled} on · {s.disabled} off
                </span>
                <span className="overview-project-last">
                  {s.lastRun ? `last ${formatRelative(new Date(s.lastRun))}` : 'never run'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: 'live' | 'error';
}) {
  return (
    <div className={`overview-kpi${accent ? ` overview-kpi--${accent}` : ''}`}>
      <div className="overview-kpi-label">{label}</div>
      <div className="overview-kpi-value">{value}</div>
      {sub && <div className="overview-kpi-sub">{sub}</div>}
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Math.max(0, Date.now() - d.getTime());
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
