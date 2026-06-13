import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import type { ClaudeSessionSummary, LaunchProfileId, Project, TerminalSession } from '@shared/types';
import { ClaudeSessionsList } from './ClaudeSessionsList';
import { Star } from 'lucide-react';
import { profileIcon, personaIcon } from '../util/profileIcon';
import { usePersonas, useData } from '../store';

/**
 * The "+" launcher. The user types an instruction, picks a profile
 * (claude / claude --yolo / shell), and launches a tab seeded with that first
 * prompt. Also lists resumable prior conversations and any background sessions.
 *
 * Rendered in two variants from one component so the modal and the empty-project
 * state stay identical:
 *   - `modal`  — over a backdrop, opened from the "+" button.
 *   - `inline` — fills the empty workspace when a project has no tabs.
 */

type LauncherProfile = 'claude' | 'claude-yolo';

/**
 * The prompt-seeding Claude profiles shown in the segmented control. Shell is
 * deliberately excluded — it never takes an instruction, so it lives as a
 * standalone side button next to this segment (see `launchShell`).
 */
interface ProfileDescriptor {
  id: LauncherProfile;
  /** The actual pty launch profile to spawn. */
  profile: LaunchProfileId;
  label: string;
}

const PROFILES: ProfileDescriptor[] = [
  { id: 'claude', profile: 'claude', label: 'claude' },
  { id: 'claude-yolo', profile: 'claude-yolo', label: 'claude --yolo' }
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
  /** When set, launch as this persona (its flags are layered in by the main
   *  process); the chosen `profile` becomes the persona's base unless the
   *  persona declares its own `baseProfile`. */
  personaId?: string;
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
  // Optional persona selection. null = launch the bare profile (today's
  // behavior). Picking a persona layers its flags onto the base profile.
  const [personaId, setPersonaId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Personas surfaced for this project: builtin + global + this project's own.
  // The store already merges sources; filter project-scoped ones to this project.
  const allPersonas = usePersonas((s) => s.personas);
  const personas = allPersonas.filter(
    (p) =>
      typeof p.source !== 'object' ||
      p.source === null ||
      p.source.projectId === project.id
  );
  const selectedPersona = personaId ? personas.find((p) => p.id === personaId) ?? null : null;

  // The project's pinned default persona (the one a one-click "+" / ⌘T spawns).
  // Read live from the store so the star reflects updates immediately. Clicking
  // a persona's star pins it; clicking the pinned one again clears the default.
  const updateProject = useData((s) => s.updateProject);
  const defaultPersonaId = useData(
    (s) => s.projects.find((p) => p.id === project.id)?.defaultPersonas?.[0]
  );
  const toggleDefaultPersona = (id: string) => {
    void updateProject(project.id, { defaultPersonas: defaultPersonaId === id ? [] : [id] });
  };

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
    const body = prompt.trim();
    // Seed the prompt as the LAST positional argv element — `claude [options]
    // [prompt]` picks it up as the first user turn (same mechanism the scheduler
    // uses, see scheduler.ts).
    // A prompt that begins with a dash would otherwise be parsed as a flag, so
    // we precede it with `--` (end-of-options) to force it to be treated as the
    // positional prompt.
    if (body) {
      if (body.startsWith('-')) extraArgs.push('--');
      extraArgs.push(body);
    }
    // A persona's base profile (if it declares one) wins over the segmented
    // choice; otherwise the persona layers onto the selected profile. The main
    // process re-resolves this, but we pass the best base so the title/icon match.
    const baseProfile = selectedPersona?.baseProfile ?? descriptor.profile;
    const title = body
      ? titleFromPrompt(body)
      : selectedPersona?.name ?? descriptor.label;
    onLaunch(baseProfile, {
      extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
      title: title || undefined,
      personaId: selectedPersona?.id
    });
    onClose?.();
  };

  // Shell sits outside the prompt flow — it never takes an instruction, so it
  // launches straight into an interactive terminal.
  const launchShell = () => {
    onLaunch('shell', { title: 'shell' });
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
        placeholder="Describe the task… (⌘↵ to launch). Leave empty to open an interactive session."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onTextareaKeyDown}
        rows={3}
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

      {personas.length > 0 && (
        <div className="launch-row">
          <span className="launch-row-label">Persona</span>
          <div className="launch-personas" role="group" aria-label="Persona">
            <button
              type="button"
              className={personaId === null ? 'launch-persona active' : 'launch-persona'}
              onClick={() => setPersonaId(null)}
              aria-pressed={personaId === null}
              title="Launch the bare profile, no persona"
            >
              None
            </button>
            {personas.map((p) => {
              const isDefault = defaultPersonaId === p.id;
              return (
                <span
                  key={p.id}
                  className={`launch-persona-wrap ${personaId === p.id ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="launch-persona"
                    onClick={() => setPersonaId((cur) => (cur === p.id ? null : p.id))}
                    aria-pressed={personaId === p.id}
                    title={p.description ?? p.name}
                  >
                    <span className="tab-profile-icon" aria-hidden="true">
                      {personaIcon(p)}
                    </span>
                    {p.name}
                  </button>
                  <button
                    type="button"
                    className={`launch-persona-star ${isDefault ? 'is-default' : ''}`}
                    onClick={() => toggleDefaultPersona(p.id)}
                    aria-pressed={isDefault}
                    title={
                      isDefault
                        ? 'Default for this project — one-click "+" / ⌘T launches it. Click to clear.'
                        : 'Set as this project’s default (one-click "+" / ⌘T)'
                    }
                  >
                    <Star size={11} fill={isDefault ? 'currentColor' : 'none'} />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="launch-actions">
        <button
          type="button"
          className="btn launch-shell-btn"
          onClick={launchShell}
          title="Open a shell session"
        >
          <span className="tab-profile-icon profile-shell" aria-hidden="true">
            {profileIcon('shell')}
          </span>
          shell
        </button>
        <button className="btn primary" onClick={launch}>
          <TerminalIcon size={14} />
          Send
        </button>
      </div>

      {bg.length > 0 && onResumeBackground && (
        <div className="launch-background">
          <div className="launch-section-label">
            <TerminalIcon size={12} aria-hidden /> Still running ({bg.length})
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
