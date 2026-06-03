import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project, ProjectSettings } from '@shared/types';

interface Props {
  project: Project;
  onClose: () => void;
}

interface ChipFieldProps {
  label: string;
  id: string;
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}

function ChipField({ label, id, values, onChange, placeholder }: ChipFieldProps) {
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
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="ps-field">
      <label className="ps-label" htmlFor={id}>{label}</label>
      <div
        id={id}
        className="ps-chip-input"
        role="group"
        aria-label={label}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span key={i} className="ps-chip">
            <span className="ps-chip-text">{v}</span>
            <button
              type="button"
              className="ps-chip-remove"
              aria-label={`Remove ${v}`}
              onClick={(e) => { e.stopPropagation(); remove(i); }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="ps-chip-input-field"
          value={input}
          placeholder={values.length === 0 ? (placeholder ?? 'Type and press Enter or ,') : ''}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          aria-label={`Add ${label}`}
        />
      </div>
    </div>
  );
}

export function ProjectSettingsDrawer({ project, onClose }: Props) {
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.cc.projectSettings.get(project.id)
      .then((s) => { setSettings(s); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [project.id]);

  const save = (patch: Partial<ProjectSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    window.cc.projectSettings.set(project.id, patch).catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!loaded) return null;

  return (
    <>
      <div
        className="modal-overlay"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className="project-settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Project settings for ${project.name}`}
      >
        <div className="ps-header">
          <div>
            <h2 className="ps-title">Project Settings</h2>
            <div className="ps-subtitle">{project.name}</div>
          </div>
          <button
            type="button"
            className="icon-btn ps-close"
            aria-label="Close project settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="ps-body">
          {/* Append system prompt */}
          <div className="ps-field">
            <label className="ps-label" htmlFor="ps-system-prompt">
              Append system prompt
            </label>
            <textarea
              id="ps-system-prompt"
              className="ps-textarea"
              placeholder="Text appended to the system prompt for every session in this project"
              value={settings.appendSystemPrompt ?? ''}
              onChange={(e) =>
                setSettings((s) => ({ ...s, appendSystemPrompt: e.target.value }))
              }
              onBlur={(e) => {
                const val = e.target.value.trim() || undefined;
                save({ appendSystemPrompt: val });
              }}
              rows={4}
            />
          </div>

          {/* Extra args */}
          <ChipField
            label="Extra args"
            id="ps-extra-args"
            values={settings.extraArgs ?? []}
            placeholder="e.g. --verbose"
            onChange={(vals) => save({ extraArgs: vals.length ? vals : undefined })}
          />

          {/* Add dirs */}
          <ChipField
            label="Add dirs (--add-dir)"
            id="ps-add-dirs"
            values={settings.addDirs ?? []}
            placeholder="/path/to/dir"
            onChange={(vals) => save({ addDirs: vals.length ? vals : undefined })}
          />

          {/* Model override */}
          <div className="ps-field">
            <label className="ps-label" htmlFor="ps-model">Model override</label>
            <select
              id="ps-model"
              className="ps-select"
              value={settings.model ?? ''}
              onChange={(e) => {
                const val = e.target.value || undefined;
                save({ model: val });
              }}
            >
              <option value="">use default</option>
              <option value="opus">opus</option>
              <option value="sonnet">sonnet</option>
              <option value="haiku">haiku</option>
            </select>
          </div>

          {/* Permission mode override */}
          <div className="ps-field">
            <label className="ps-label" htmlFor="ps-permission-mode">
              Permission mode override
            </label>
            <select
              id="ps-permission-mode"
              className="ps-select"
              value={settings.permissionMode ?? ''}
              onChange={(e) => {
                const val = (e.target.value as ProjectSettings['permissionMode']) || undefined;
                save({ permissionMode: val });
              }}
            >
              <option value="">use default</option>
              <option value="default">default</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="plan">plan</option>
              <option value="bypassPermissions">bypassPermissions</option>
            </select>
          </div>

          {/* Allowed tools */}
          <ChipField
            label="Allowed tools (--allowedTools)"
            id="ps-allowed-tools"
            values={settings.allowedTools ?? []}
            placeholder="e.g. Bash(git:*)"
            onChange={(vals) => save({ allowedTools: vals.length ? vals : undefined })}
          />
          <div className="ps-hint">
            Examples: Bash, Edit, Write, Read, Task, mcp__&lt;server&gt;__&lt;tool&gt;, Bash(git:*)
          </div>

          {/* Denied tools */}
          <ChipField
            label="Denied tools (--disallowedTools)"
            id="ps-denied-tools"
            values={settings.deniedTools ?? []}
            placeholder="e.g. Bash(rm:*)"
            onChange={(vals) => save({ deniedTools: vals.length ? vals : undefined })}
          />
          <div className="ps-hint">
            Examples: Bash, Edit, Write, Read, Task, mcp__&lt;server&gt;__&lt;tool&gt;, Bash(rm:*)
          </div>
        </div>
      </aside>
    </>
  );
}
