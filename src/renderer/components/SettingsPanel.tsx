import { useEffect, useState, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import type {
  AppConfig,
  ProjectSettings,
  ClaudeProjectSettings,
  ClaudeSettingsScope,
  ClaudeSettingsResult
} from '@shared/types';
import { applyTheme, useData, useUi, useUpdates } from '../store';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const tab = useUi((s) => s.settingsTab);
  const workbenchEnabled = useUi((s) => s.workbenchEnabled);
  const setWorkbenchEnabled = useUi((s) => s.setWorkbenchEnabled);

  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const [hooks, setHooks] = useState<unknown>(null);
  const [homedir, setHomedir] = useState<string>('');

  useEffect(() => {
    window.cc.config.get().then(setConfig).catch(() => {});
    window.cc.app.homedir().then(setHomedir).catch(() => {});
    window.cc.skills.readHooks().then(setHooks).catch(() => {});
  }, []);

  const markSaved = useCallback(() => {
    setSavedFlash(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => {
      setSavedFlash(false);
      savedTimer.current = null;
    }, 1600);
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    };
  }, []);

  if (!config) {
    return (
      <main className="settings-panel">
        <div className="settings-empty">Loading…</div>
      </main>
    );
  }

  const resolve = (p: string) => (homedir ? p.replace(/^~/, homedir) : p);
  const openFile = (path: string) => {
    window.cc.openers.openIn('cursor', resolve(path)).catch(() => {});
  };

  const update = async (patch: Partial<AppConfig>) => {
    try {
      const next = await window.cc.config.set(patch);
      setConfig(next);
      if (typeof patch.fontSize === 'number') useData.getState().setFontSize(patch.fontSize);
      if (typeof patch.inboxGuidanceEnabled === 'boolean') {
        useData.getState().setInboxGuidanceEnabled(patch.inboxGuidanceEnabled);
      }
      if (patch.theme) applyTheme(patch.theme);
      markSaved();
    } catch {
      // noop
    }
  };

  return (
    <main className="settings-panel">
      <div className="settings-inner">
        <header className="settings-header">
          <h2>
            Settings
            <span className="settings-header-sep">›</span>
            <span className="settings-header-scope">
              {tab === 'global' ? 'Global' : selectedProject?.name ?? 'Project'}
            </span>
          </h2>
        </header>

        {tab === 'global' ? (
          <GlobalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
            workbenchEnabled={workbenchEnabled}
            setWorkbenchEnabled={setWorkbenchEnabled}
            hooks={hooks}
            onOpen={openFile}
          />
        ) : (
          <ProjectTab
            project={selectedProject}
            onOpen={openFile}
            onSaved={markSaved}
          />
        )}

        {savedFlash && <div className="settings-saved">Saved</div>}
      </div>
    </main>
  );
}

interface GlobalTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
  workbenchEnabled: boolean;
  setWorkbenchEnabled: (on: boolean) => void;
  hooks: unknown;
  onOpen: (path: string) => void;
}

function GlobalTab({
  config,
  onConfigDraft,
  onUpdate,
  workbenchEnabled,
  setWorkbenchEnabled,
  hooks,
  onOpen
}: GlobalTabProps) {
  const setNav = useUi((s) => s.setNav);
  return (
    <>
      <Section title="Defaults" help="Applied to every new claude session unless overridden per-project.">
        <Field label="Theme">
          <select
            value={config.theme}
            onChange={(e) => onUpdate({ theme: e.target.value as AppConfig['theme'] })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>
        <Field label="Default model" help="‘Default’ lets claude decide.">
          <select
            value={config.defaultModel ?? 'default'}
            onChange={(e) =>
              onUpdate({ defaultModel: e.target.value as AppConfig['defaultModel'] })
            }
          >
            <option value="default">Default</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </Field>
        <Field label="Default permission mode">
          <select
            value={config.defaultPermissionMode ?? 'default'}
            onChange={(e) =>
              onUpdate({
                defaultPermissionMode: e.target.value as AppConfig['defaultPermissionMode']
              })
            }
          >
            <option value="default">Default</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="plan">Plan</option>
            <option value="bypassPermissions">Bypass Permissions</option>
          </select>
        </Field>
        <CheckboxField
          label="Show inbox guidance"
          help="Hint cards in the inbox view."
          checked={config.inboxGuidanceEnabled ?? true}
          onChange={(v) => onUpdate({ inboxGuidanceEnabled: v })}
        />
      </Section>

      <Section title="Shells">
        <Field label="Default shell" help="Path to the shell launched for shell tabs.">
          <input
            type="text"
            value={config.shell}
            onChange={(e) => onConfigDraft({ ...config, shell: e.target.value })}
            onBlur={(e) => onUpdate({ shell: e.target.value.trim() })}
            spellCheck={false}
          />
        </Field>
        <Field
          label="Claude binary"
          help="Command run for claude tabs. Just ‘claude’ if it’s on your PATH."
        >
          <input
            type="text"
            value={config.claudeBinary}
            onChange={(e) => onConfigDraft({ ...config, claudeBinary: e.target.value })}
            onBlur={(e) => onUpdate({ claudeBinary: e.target.value.trim() })}
            spellCheck={false}
          />
        </Field>
      </Section>

      <Section title="Skills">
        <p className="settings-help">
          Skills moved to the dedicated{' '}
          <button
            type="button"
            className="settings-btn"
            onClick={() => setNav('skills')}
          >
            Skills panel
          </button>{' '}
          — discover, enable/disable, and bundle skills across user, plugin, and
          project sources.
        </p>
      </Section>

      <Section title="Hooks" help={<>Read-only view of <code>hooks</code> in <code>~/.claude/settings.json</code>.</>}>
        {hooks == null ? (
          <p className="settings-help settings-help--muted">No hooks configured.</p>
        ) : (
          <pre className="settings-code-block">{JSON.stringify(hooks, null, 2)}</pre>
        )}
        <button
          type="button"
          className="settings-btn"
          onClick={() => onOpen('~/.claude/settings.json')}
        >
          Edit in Cursor
        </button>
      </Section>

      <Section title="Quick open" help="Opens config files in Cursor.">
        <div className="settings-btn-row">
          <button className="settings-btn" onClick={() => onOpen('~/.claude/settings.json')}>
            ~/.claude/settings.json
          </button>
          <button className="settings-btn" onClick={() => onOpen('~/.claude.json')}>
            ~/.claude.json
          </button>
        </div>
      </Section>

      <Section title="Appearance">
        <Field label="Terminal font size" help="Range 10–20. Affects new tabs.">
          <input
            type="number"
            min={10}
            max={20}
            value={config.fontSize}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) onConfigDraft({ ...config, fontSize: n });
            }}
            onBlur={(e) => {
              const n = Math.max(10, Math.min(20, parseInt(e.target.value, 10) || 13));
              onUpdate({ fontSize: n });
            }}
          />
        </Field>
      </Section>

      <Section title="Experimental">
        <CheckboxField
          label="Enable VSCode workbench in Explorer mode"
          help="Replaces the explorer with the full monaco-vscode-api workbench. Toggle off via DevTools (localStorage.cc.workbenchEnabled='0') if it crashes on boot."
          checked={workbenchEnabled}
          onChange={setWorkbenchEnabled}
        />
      </Section>

      <AboutSection />
    </>
  );
}

/** Human-readable line for the current update status. */
function updateStatusLabel(
  status: import('@shared/types').UpdateStatus,
  progress: import('@shared/types').UpdateProgress | null
): string {
  switch (status.kind) {
    case 'idle':
      return 'Up to date.';
    case 'disabled':
      return 'Auto-update is only available in the packaged app.';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Update${status.version ? ` v${status.version}` : ''} found — downloading…`;
    case 'not-available':
      return 'You’re on the latest version.';
    case 'downloading':
      return progress
        ? `Downloading… ${Math.round(progress.percent)}%`
        : 'Downloading…';
    case 'downloaded':
      return `Update${status.version ? ` v${status.version}` : ''} ready — installs when you quit.`;
    case 'error':
      return `Update check failed: ${status.message ?? 'unknown error'}`;
  }
}

/** App version + "Check for updates" affordance. Wired to the main-process
 *  electron-updater via window.cc.updates / useUpdates. */
function AboutSection() {
  const [version, setVersion] = useState<string>('');
  const status = useUpdates((s) => s.status);
  const progress = useUpdates((s) => s.progress);

  useEffect(() => {
    window.cc.app.version().then(setVersion).catch(() => {});
  }, []);

  const checking = status.kind === 'checking';
  const downloaded = status.kind === 'downloaded';

  return (
    <Section title="About" help="App version and updates.">
      <Field label="Version">
        <input type="text" value={version || '…'} readOnly spellCheck={false} />
      </Field>
      <p className="settings-help">{updateStatusLabel(status, progress)}</p>
      <div className="settings-btn-row">
        <button
          type="button"
          className="settings-btn"
          disabled={checking || status.kind === 'disabled'}
          onClick={() => {
            void window.cc.updates.check();
          }}
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {downloaded && (
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              void window.cc.updates.quitAndInstall();
            }}
          >
            Restart &amp; install now
          </button>
        )}
      </div>
    </Section>
  );
}

interface ProjectTabProps {
  project: { id: string; name: string; path: string; remote?: unknown } | null;
  onOpen: (path: string) => void;
  onSaved: () => void;
}

function ProjectTab({
  project,
  onOpen,
  onSaved
}: ProjectTabProps) {
  if (!project) {
    return (
      <Section title="No project selected">
        <p className="settings-help">
          Select a project in the sidebar to manage its CLI flags, MCP servers, and config files.
        </p>
      </Section>
    );
  }

  return (
    <>
      <ProjectClaudeFlags projectId={project.id} onSaved={onSaved} />

      {!project.remote && (
        <ProjectClaudeSettings projectPath={project.path} onSaved={onSaved} onOpen={onOpen} />
      )}

      <Section title="Quick open" help="Opens project config files in Cursor.">
        <div className="settings-btn-row">
          <button className="settings-btn" onClick={() => onOpen(`${project.path}/CLAUDE.md`)}>
            {project.name}/CLAUDE.md
          </button>
          <button className="settings-btn" onClick={() => onOpen(`${project.path}/.mcp.json`)}>
            {project.name}/.mcp.json
          </button>
          <button
            className="settings-btn"
            onClick={() => onOpen(`${project.path}/.claude/settings.local.json`)}
          >
            {project.name}/.claude/settings.local.json
          </button>
        </div>
      </Section>
    </>
  );
}

function ProjectClaudeFlags({
  projectId,
  onSaved
}: {
  projectId: string;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    window.cc.projectSettings.get(projectId)
      .then((s) => { if (!cancelled) { setSettings(s); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  const save = (patch: Partial<ProjectSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    window.cc.projectSettings.set(projectId, patch)
      .then(() => onSaved())
      .catch(() => {});
  };

  if (!loaded) {
    return (
      <Section title="Claude CLI overrides">
        <p className="settings-help">Loading…</p>
      </Section>
    );
  }

  return (
    <Section
      title="Claude CLI overrides"
      help="Applied when launching claude tabs in this project. Override the global defaults."
    >
      <Field
        label="Append system prompt"
        help="Text appended via --append-system-prompt for every session in this project."
      >
        <textarea
          className="settings-textarea"
          rows={4}
          value={settings.appendSystemPrompt ?? ''}
          onChange={(e) =>
            setSettings((s) => ({ ...s, appendSystemPrompt: e.target.value }))
          }
          onBlur={(e) => {
            const val = e.target.value.trim() || undefined;
            save({ appendSystemPrompt: val });
          }}
          placeholder="Optional"
        />
      </Field>

      <Field label="Model override" help="“Use default” falls back to the global default.">
        <select
          value={settings.model ?? ''}
          onChange={(e) => save({ model: e.target.value || undefined })}
        >
          <option value="">Use default</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
      </Field>

      <Field label="Permission mode override">
        <select
          value={settings.permissionMode ?? ''}
          onChange={(e) =>
            save({ permissionMode: (e.target.value as ProjectSettings['permissionMode']) || undefined })
          }
        >
          <option value="">Use default</option>
          <option value="default">Default</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="plan">Plan</option>
          <option value="bypassPermissions">Bypass Permissions</option>
        </select>
      </Field>

      <ChipField
        label="Extra args"
        help="Forwarded verbatim to claude. Wins over per-tab and global flags."
        values={settings.extraArgs ?? []}
        placeholder="--verbose"
        onChange={(vals) => save({ extraArgs: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Add dirs"
        help="Each value becomes a --add-dir flag."
        values={settings.addDirs ?? []}
        placeholder="/path/to/dir"
        onChange={(vals) => save({ addDirs: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Allowed tools"
        help="Joined with commas into --allowedTools. Examples: Bash, Edit, Write, Read, Task, mcp__<server>__<tool>, Bash(git:*)."
        values={settings.allowedTools ?? []}
        placeholder="Bash(git:*)"
        onChange={(vals) => save({ allowedTools: vals.length ? vals : undefined })}
      />

      <ChipField
        label="Denied tools"
        help="Joined with commas into --disallowedTools. Examples: Bash(rm:*)."
        values={settings.deniedTools ?? []}
        placeholder="Bash(rm:*)"
        onChange={(vals) => save({ deniedTools: vals.length ? vals : undefined })}
      />
    </Section>
  );
}

/**
 * Editor for `<project>/.claude/settings.json` (shared, committed) and
 * `<project>/.claude/settings.local.json` (personal, gitignored). Surfaces
 * `permissions.allow/deny/defaultMode/additionalDirectories` and the
 * top-level `model`. Anything else round-trips untouched via _unknown.
 */
function ProjectClaudeSettings({
  projectPath,
  onSaved,
  onOpen
}: {
  projectPath: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
}) {
  const [shared, setShared] = useState<ClaudeSettingsResult | null>(null);
  const [local, setLocal] = useState<ClaudeSettingsResult | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<ClaudeSettingsScope>('shared');

  const load = useCallback(async () => {
    // Guard against a stale preload (electron-vite HMRs the renderer but
    // not the preload — devs hitting save before a full app restart see
    // window.cc.claudeSettings undefined). Surfacing a clear hint beats
    // a hanging spinner.
    if (!window.cc?.claudeSettings?.read) {
      setBindingError('claudeSettings binding not loaded — quit (⌘Q) and relaunch the app.');
      // Mark both scopes as "not present" so the cards render and the
      // user can still see the path / open in Cursor.
      const placeholder = (scope: 'shared' | 'local'): ClaudeSettingsResult => ({
        exists: false,
        path: `${projectPath}/.claude/${scope === 'shared' ? 'settings.json' : 'settings.local.json'}`,
        settings: {}
      });
      setShared(placeholder('shared'));
      setLocal(placeholder('local'));
      return;
    }
    setBindingError(null);
    try {
      const [s, l] = await Promise.all([
        window.cc.claudeSettings.read(projectPath, 'shared'),
        window.cc.claudeSettings.read(projectPath, 'local')
      ]);
      setShared(s);
      setLocal(l);
    } catch (err) {
      setBindingError(err instanceof Error ? err.message : 'Failed to load .claude/ settings');
    }
  }, [projectPath]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (scope: ClaudeSettingsScope, patch: ClaudeProjectSettings) => {
    try {
      const next = await window.cc.claudeSettings.write(projectPath, scope, patch);
      if (scope === 'shared') setShared(next);
      else setLocal(next);
      onSaved();
    } catch {
      /* ignore */
    }
  };

  return (
    <Section
      title="Project .claude/ settings"
      help={
        <>
          Reads <code>.claude/settings.json</code> (shared, committed) and{' '}
          <code>.claude/settings.local.json</code> (personal, gitignored).
          Edits preserve unknown keys (env, hooks, outputStyle, …) verbatim.
        </>
      }
    >
      {bindingError && <p className="modal-error">{bindingError}</p>}
      <div className="claude-scope-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'shared'}
          className={activeScope === 'shared' ? 'active' : ''}
          onClick={() => setActiveScope('shared')}
        >
          Shared
          {shared?.exists && <span className="claude-scope-dot" aria-hidden />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeScope === 'local'}
          className={activeScope === 'local' ? 'active' : ''}
          onClick={() => setActiveScope('local')}
        >
          Local
          {local?.exists && <span className="claude-scope-dot" aria-hidden />}
        </button>
      </div>
      {activeScope === 'shared' ? (
        <ClaudeScopeCard
          title="Shared (settings.json)"
          subtitle="Committed — for everyone on the project"
          result={shared}
          onSave={(patch) => save('shared', patch)}
          onOpen={onOpen}
        />
      ) : (
        <ClaudeScopeCard
          title="Local (settings.local.json)"
          subtitle="Personal — gitignored by claude-code"
          result={local}
          onSave={(patch) => save('local', patch)}
          onOpen={onOpen}
        />
      )}
    </Section>
  );
}

function ClaudeScopeCard({
  title,
  subtitle,
  result,
  onSave,
  onOpen
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult | null;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  if (!result) {
    return (
      <div className="claude-scope-card">
        <header>
          <h4>{title}</h4>
          <p className="settings-help">{subtitle}</p>
        </header>
        <p className="settings-help">Loading…</p>
      </div>
    );
  }

  const s = result.settings;
  const perm = s.permissions ?? {};
  return (
    <ClaudeScopeCardInner
      title={title}
      subtitle={subtitle}
      result={result}
      view={s}
      perm={perm}
      onSave={onSave}
      onOpen={onOpen}
    />
  );
}

function ClaudeScopeCardInner({
  title,
  subtitle,
  result,
  view: s,
  perm,
  onSave,
  onOpen
}: {
  title: string;
  subtitle: string;
  result: ClaudeSettingsResult;
  view: ClaudeProjectSettings;
  perm: NonNullable<ClaudeProjectSettings['permissions']>;
  onSave: (patch: ClaudeProjectSettings) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  const [modelDraft, setModelDraft] = useState(s.model ?? '');
  // Re-sync the draft when the persisted value changes (e.g. another save lands).
  useEffect(() => {
    setModelDraft(s.model ?? '');
  }, [s.model]);
  // Show "Other keys" when the user has hand-edited fields we don't surface
  // (env, hooks, outputStyle, etc.). Read-only — they edit raw.
  const hasUnknown =
    (s._unknown && Object.keys(s._unknown).length > 0) ||
    (s._unknownPermissions && Object.keys(s._unknownPermissions).length > 0);

  return (
    <div className="claude-scope-card">
      <header>
        <h4>
          {title}
          {!result.exists && <span className="claude-scope-badge">not present</span>}
        </h4>
        <p className="settings-help">{subtitle}</p>
      </header>

      <Field label="Default permission mode">
        <select
          value={perm.defaultMode ?? ''}
          onChange={(e) =>
            onSave({
              permissions: {
                ...perm,
                defaultMode: (e.target.value || undefined) as
                  | 'default'
                  | 'acceptEdits'
                  | 'plan'
                  | 'bypassPermissions'
                  | undefined
              }
            })
          }
        >
          <option value="">Unset</option>
          <option value="default">Default</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="plan">Plan</option>
          <option value="bypassPermissions">Bypass Permissions</option>
        </select>
      </Field>

      <Field label="Model" help="Top-level `model` override (e.g. opus, sonnet, haiku).">
        <input
          type="text"
          value={modelDraft}
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if ((s.model ?? '') === next) return;
            onSave({ model: next || undefined });
          }}
          placeholder="unset"
          spellCheck={false}
        />
      </Field>

      <ChipField
        label="Allow"
        help="permissions.allow — pre-approved tool patterns. Examples: Bash(git:*), Edit, Read."
        values={perm.allow ?? []}
        placeholder="Bash(git:*)"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              allow: vals.length ? vals : undefined
            }
          })
        }
      />

      <ChipField
        label="Deny"
        help="permissions.deny — blocked tool patterns. Examples: Bash(rm:*)."
        values={perm.deny ?? []}
        placeholder="Bash(rm:*)"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              deny: vals.length ? vals : undefined
            }
          })
        }
      />

      <ChipField
        label="Additional directories"
        help="permissions.additionalDirectories — extra paths claude can read/write outside the project root."
        values={perm.additionalDirectories ?? []}
        placeholder="/abs/path"
        onChange={(vals) =>
          onSave({
            permissions: {
              ...perm,
              additionalDirectories: vals.length ? vals : undefined
            }
          })
        }
      />

      {hasUnknown && (
        <div className="settings-field">
          <span className="settings-label">Other keys (read-only)</span>
          <pre className="settings-code-block">
            {JSON.stringify(
              {
                ...(s._unknown ?? {}),
                ...(s._unknownPermissions ? { permissions: s._unknownPermissions } : {})
              },
              null,
              2
            )}
          </pre>
        </div>
      )}

      <div className="settings-btn-row">
        <button className="settings-btn" onClick={() => onOpen(result.path)}>
          Edit raw JSON in Cursor
        </button>
      </div>
    </div>
  );
}

function ChipField({
  label,
  help,
  values,
  placeholder,
  onChange
}: {
  label: string;
  help?: React.ReactNode;
  values: string[];
  placeholder?: string;
  onChange: (vals: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const raw = input.trim();
    if (!raw) return;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      onChange([...values, ...parts]);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="settings-field">
      <span className="settings-label">{label}</span>
      <div
        className="settings-chip-input"
        role="group"
        aria-label={label}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span key={i} className="settings-chip">
            <span className="settings-chip-text">{v}</span>
            <button
              type="button"
              className="settings-chip-remove"
              aria-label={`Remove ${v}`}
              onClick={(e) => { e.stopPropagation(); remove(i); }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="settings-chip-field"
          value={input}
          placeholder={values.length === 0 ? (placeholder ?? 'Type and press Enter or ,') : ''}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          aria-label={`Add ${label}`}
        />
      </div>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

function Section({
  title,
  help,
  children
}: {
  title: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {help && <p className="settings-help settings-section-help">{help}</p>}
      {children}
    </section>
  );
}

function Field({
  label,
  help,
  children
}: {
  label: string;
  help?: React.ReactNode;
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

function CheckboxField({
  label,
  help,
  checked,
  onChange
}: {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-field settings-field--check">
      <label className="settings-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}


