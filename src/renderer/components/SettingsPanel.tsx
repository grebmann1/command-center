import { useEffect, useState, useCallback } from 'react';
import type { AppConfig, McpServer, SkillEntry } from '@shared/types';
import { useData, useUi } from '../store';

type TabId = 'global' | 'project';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>('global');
  const workbenchEnabled = useUi((s) => s.workbenchEnabled);
  const setWorkbenchEnabled = useUi((s) => s.setWorkbenchEnabled);

  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [hooks, setHooks] = useState<unknown>(null);
  const [homedir, setHomedir] = useState<string>('');

  const loadMcpServers = useCallback(async (projectPath: string) => {
    setMcpLoading(true);
    try {
      const servers = await window.cc.mcp.list(projectPath);
      setMcpServers(servers);
    } catch {
      setMcpServers([]);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProject) loadMcpServers(selectedProject.path);
    else setMcpServers([]);
  }, [selectedProject, loadMcpServers]);

  useEffect(() => {
    window.cc.config.get().then(setConfig).catch(() => {});
    window.cc.app.homedir().then(setHomedir).catch(() => {});
    window.cc.skills.list()
      .then((list) => { setSkills(list); setSkillsLoading(false); })
      .catch(() => setSkillsLoading(false));
    window.cc.skills.readHooks().then(setHooks).catch(() => {});
  }, []);

  if (!config) {
    return (
      <main className="settings-panel">
        <div className="settings-empty">Loading…</div>
      </main>
    );
  }

  const toggleSkill = async (name: string, enabled: boolean) => {
    try {
      await window.cc.skills.setEnabled(name, enabled);
      setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    } catch {
      // noop
    }
  };

  const resolve = (p: string) => (homedir ? p.replace(/^~/, homedir) : p);
  const openFile = (path: string) => {
    window.cc.openers.openIn('cursor', resolve(path)).catch(() => {});
  };

  const update = async (patch: Partial<AppConfig>) => {
    try {
      const next = await window.cc.config.set(patch);
      setConfig(next);
      if (typeof patch.fontSize === 'number') useData.getState().setFontSize(patch.fontSize);
      setSavedAt(Date.now());
    } catch {
      // noop
    }
  };

  return (
    <main className="settings-panel">
      <div className="settings-inner">
        <header className="settings-header">
          <h2>Settings</h2>
          <div className="settings-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'global'}
              className={`settings-tab ${tab === 'global' ? 'is-active' : ''}`}
              onClick={() => setTab('global')}
            >
              Global
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'project'}
              className={`settings-tab ${tab === 'project' ? 'is-active' : ''}`}
              onClick={() => setTab('project')}
            >
              Project
              {selectedProject && (
                <span className="settings-tab-hint">{selectedProject.name}</span>
              )}
            </button>
          </div>
        </header>

        {tab === 'global' ? (
          <GlobalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
            workbenchEnabled={workbenchEnabled}
            setWorkbenchEnabled={setWorkbenchEnabled}
            skills={skills}
            skillsLoading={skillsLoading}
            onToggleSkill={toggleSkill}
            hooks={hooks}
            onOpen={openFile}
          />
        ) : (
          <ProjectTab
            project={selectedProject}
            mcpServers={mcpServers}
            mcpLoading={mcpLoading}
            onToggleMcp={async (name, enabled) => {
              if (!selectedProject) return;
              await window.cc.mcp.setEnabled(selectedProject.path, name, enabled);
              await loadMcpServers(selectedProject.path);
            }}
            onOpen={openFile}
          />
        )}

        {savedAt && <div className="settings-saved">Saved · {timeAgo(savedAt)}</div>}
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
  skills: SkillEntry[];
  skillsLoading: boolean;
  onToggleSkill: (name: string, enabled: boolean) => void;
  hooks: unknown;
  onOpen: (path: string) => void;
}

function GlobalTab({
  config,
  onConfigDraft,
  onUpdate,
  workbenchEnabled,
  setWorkbenchEnabled,
  skills,
  skillsLoading,
  onToggleSkill,
  hooks,
  onOpen
}: GlobalTabProps) {
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

      <Section title="Skills" help={<>Toggles <code>disabledSkills</code> in <code>~/.claude/settings.json</code>.</>}>
        {skillsLoading ? (
          <p className="settings-help">Loading…</p>
        ) : skills.length === 0 ? (
          <p className="settings-help">
            No skills found in <code>~/.claude/skills/</code>.
          </p>
        ) : (
          <ul className="settings-list">
            {skills.map((skill) => (
              <li key={skill.name} className="settings-list-row">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(e) => onToggleSkill(skill.name, e.target.checked)}
                />
                <span className="settings-list-name">{skill.name}</span>
              </li>
            ))}
          </ul>
        )}
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
    </>
  );
}

interface ProjectTabProps {
  project: { id: string; name: string; path: string } | null;
  mcpServers: McpServer[];
  mcpLoading: boolean;
  onToggleMcp: (name: string, enabled: boolean) => Promise<void>;
  onOpen: (path: string) => void;
}

function ProjectTab({
  project,
  mcpServers,
  mcpLoading,
  onToggleMcp,
  onOpen
}: ProjectTabProps) {
  if (!project) {
    return (
      <Section title="No project selected">
        <p className="settings-help">
          Select a project in the sidebar to manage its MCP servers and config files.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="MCP servers"
        help="Merged from ~/.claude.json (user) and <project>/.mcp.json (project). Toggling writes the disabled flag to .claude/settings.local.json."
      >
        {mcpLoading ? (
          <p className="settings-help">Loading…</p>
        ) : mcpServers.length === 0 ? (
          <p className="settings-help">No MCP servers configured for this project.</p>
        ) : (
          <ul className="settings-list">
            {mcpServers.map((server) => (
              <McpServerRow
                key={`${server.scope}:${server.name}`}
                server={server}
                onToggle={(enabled) => onToggleMcp(server.name, enabled)}
              />
            ))}
          </ul>
        )}
      </Section>

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

const SCOPE_LABEL: Record<McpServer['scope'], string> = {
  user: 'user',
  project: 'project',
  session: 'session'
};

function McpServerRow({
  server,
  onToggle
}: {
  server: McpServer;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (checked: boolean) => {
    setBusy(true);
    try {
      await onToggle(checked);
    } catch {
      // noop
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`settings-list-row mcp-row ${busy ? 'is-busy' : ''}`}>
      <input
        type="checkbox"
        checked={server.enabled}
        disabled={busy}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <div className="mcp-row-body">
        <div className="mcp-row-head">
          <span className="mcp-row-name">{server.name}</span>
          <span className={`mcp-scope mcp-scope--${server.scope}`}>{SCOPE_LABEL[server.scope]}</span>
        </div>
        {server.command && (
          <div className="mcp-row-cmd">
            {[server.command, ...(server.args ?? [])].join(' ')}
          </div>
        )}
      </div>
    </li>
  );
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
