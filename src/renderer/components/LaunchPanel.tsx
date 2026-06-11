import { useEffect, useRef, useState } from 'react';
import { Moon, Terminal as TerminalIcon } from 'lucide-react';
import type { ClaudeSessionSummary, LaunchProfileId, Project, TerminalSession } from '@shared/types';
import { ClaudeSessionsList } from './ClaudeSessionsList';
import { profileIcon } from '../util/profileIcon';

/**
 * The rich "+" launcher. Replaces the old 4-item dropdown: the user types an
 * instruction, picks a profile (claude / claude --yolo / shell) plus model and
 * permission mode, and launches a tab seeded with that first prompt. Also lists
 * resumable prior conversations and any background sessions.
 *
 * Rendered in two variants from one component so the modal and the empty-project
 * state stay identical:
 *   - `modal`  — over a backdrop, opened from the "+" button.
 *   - `inline` — fills the empty workspace when a project has no tabs.
 */

type LauncherProfile = 'claude' | 'claude-yolo' | 'shell';
type ModelChoice = 'default' | 'opus' | 'sonnet' | 'haiku';
type PermissionChoice = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/**
 * Built-in launch profiles, modelled as descriptors (not hard-coded buttons) so
 * a future source (e.g. Zana/persona profiles) can append entries without
 * restructuring. `buildArgs` turns the form state into CLI args; `seedsPrompt`
 * marks profiles that accept an initial instruction.
 */
interface ProfileDescriptor {
  id: LauncherProfile;
  /** The actual pty launch profile to spawn. */
  profile: LaunchProfileId;
  label: string;
  /** Whether model + permission-mode selectors apply. */
  hasClaudeOptions: boolean;
  /** Whether an initial instruction is passed to the session. */
  seedsPrompt: boolean;
}

const PROFILES: ProfileDescriptor[] = [
  { id: 'claude', profile: 'claude', label: 'claude', hasClaudeOptions: true, seedsPrompt: true },
  {
    id: 'claude-yolo',
    profile: 'claude-yolo',
    label: 'claude --yolo',
    // --dangerously-skip-permissions takes precedence; permission mode is moot.
    hasClaudeOptions: true,
    seedsPrompt: true
  },
  { id: 'shell', profile: 'shell', label: 'shell', hasClaudeOptions: false, seedsPrompt: false }
];

const MODELS: Array<{ id: ModelChoice; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
];

const PERMISSION_MODES: Array<{ id: PermissionChoice; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'bypassPermissions', label: 'Bypass' }
];

/** Derive a short, meaningful tab title from the instruction. */
function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

export interface LaunchOptions {
  extraArgs?: string[];
  title?: string;
}

interface Props {
  project: Project;
  variant: 'modal' | 'inline';
  /** Spawn a session with the assembled profile + args. */
  onLaunch: (profile: LaunchProfileId, opts?: LaunchOptions) => void;
  /** Resume a prior Claude conversation from the list. */
  onResume: (s: ClaudeSessionSummary) => void;
  /** Background (detached) sessions, surfaced so the dropdown's tray isn't lost. */
  backgroundTabs?: TerminalSession[];
  /** Resume a background session back into the strip. */
  onResumeBackground?: (id: string) => void;
  /** Close the modal (omitted for the inline variant). */
  onClose?: () => void;
}

export function LaunchPanel({
  project,
  variant,
  onLaunch,
  onResume,
  backgroundTabs,
  onResumeBackground,
  onClose
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [profileId, setProfileId] = useState<LauncherProfile>('claude');
  const [model, setModel] = useState<ModelChoice>('default');
  const [permissionMode, setPermissionMode] = useState<PermissionChoice>('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const descriptor = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

  useEffect(() => {
    // Autofocus the instruction box so the user can type immediately.
    textareaRef.current?.focus();
  }, []);

  // Modal: Escape closes, and Tab is trapped within the dialog. We also restore
  // focus to whatever opened the modal (the "+" button) when it unmounts, so a
  // keyboard user doesn't lose their place.
  useEffect(() => {
    if (variant !== 'modal' || !onClose) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, textarea, input, select, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus to the opener if it's still in the document.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [variant, onClose]);

  const launch = () => {
    const extraArgs: string[] = [];
    if (descriptor.hasClaudeOptions && model !== 'default') {
      extraArgs.push('--model', model);
    }
    // Permission mode is ignored for --yolo (it already skips permissions).
    if (descriptor.profile === 'claude' && permissionMode !== 'default') {
      extraArgs.push('--permission-mode', permissionMode);
    }
    const body = prompt.trim();
    // Seed the prompt as the LAST positional argv element — `claude [options]
    // [prompt]` picks it up as the first user turn (same mechanism the scheduler
    // uses, see scheduler.ts). Shell ignores it (it would be run as a command).
    // A prompt that begins with a dash would otherwise be parsed as a flag, so
    // we precede it with `--` (end-of-options) to force it to be treated as the
    // positional prompt.
    if (descriptor.seedsPrompt && body) {
      if (body.startsWith('-')) extraArgs.push('--');
      extraArgs.push(body);
    }
    const title = descriptor.seedsPrompt && body ? titleFromPrompt(body) : descriptor.label;
    onLaunch(descriptor.profile, {
      extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
      title: title || undefined
    });
    onClose?.();
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter launches (Enter alone keeps a multi-line instruction).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      launch();
    }
  };

  const bg = backgroundTabs ?? [];

  const body = (
    <div className="launch-panel">
      <div className="launch-header">
        <h3>{project.name}</h3>
        <p>Start a session</p>
      </div>

      <textarea
        ref={textareaRef}
        className="launch-instruction"
        placeholder={
          descriptor.seedsPrompt
            ? 'Describe the task… (⌘↵ to launch). Leave empty to open an interactive session.'
            : 'Shell session — instructions are ignored.'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onTextareaKeyDown}
        rows={3}
        disabled={!descriptor.seedsPrompt}
      />

      <div className="launch-row">
        <span className="launch-row-label">Profile</span>
        <div className="launch-segmented" role="group" aria-label="Launch profile">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={profileId === p.id ? 'active' : ''}
              onClick={() => setProfileId(p.id)}
              aria-pressed={profileId === p.id}
            >
              <span className={`tab-profile-icon profile-${p.profile}`} aria-hidden="true">
                {profileIcon(p.profile)}
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {descriptor.hasClaudeOptions && (
        <div className="launch-row">
          <span className="launch-row-label">Model</span>
          <div className="launch-segmented" role="group" aria-label="Model">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={model === m.id ? 'active' : ''}
                onClick={() => setModel(m.id)}
                aria-pressed={model === m.id}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {descriptor.profile === 'claude' && (
        <div className="launch-row">
          <span className="launch-row-label">Permissions</span>
          <div className="launch-segmented" role="group" aria-label="Permission mode">
            {PERMISSION_MODES.map((pm) => (
              <button
                key={pm.id}
                type="button"
                className={permissionMode === pm.id ? 'active' : ''}
                onClick={() => setPermissionMode(pm.id)}
                aria-pressed={permissionMode === pm.id}
              >
                {pm.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="launch-actions">
        <button className="btn primary" onClick={launch}>
          <TerminalIcon size={14} />
          Launch {descriptor.label}
        </button>
      </div>

      {bg.length > 0 && onResumeBackground && (
        <div className="launch-background">
          <div className="launch-section-label">
            <Moon size={12} aria-hidden /> Background ({bg.length})
          </div>
          <div className="launch-bg-list">
            {bg.map((t) => (
              <button
                key={t.id}
                className="launch-bg-row"
                title={`Resume ${t.title} · ${t.profile}`}
                onClick={() => onResumeBackground(t.id)}
              >
                <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
                  {profileIcon(t.profile)}
                </span>
                <span className="launch-bg-title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ClaudeSessionsList projectId={project.id} onResume={onResume} />
    </div>
  );

  if (variant === 'modal') {
    return (
      <div className="palette-backdrop" onMouseDown={() => onClose?.()}>
        <div
          ref={dialogRef}
          className="palette launch-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="New session"
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="empty-workspace overlay">
      <div className="empty-inner">{body}</div>
    </div>
  );
}
