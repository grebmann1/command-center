import { useEffect, useRef, useState } from 'react';
import {
  Terminal as TerminalIcon,
  Bot,
  GitBranch,
  ListChecks,
  Inbox,
  FlaskConical,
  Sparkles,
  Zap,
  Folder,
  type LucideIcon
} from 'lucide-react';
import type { FsEntry, LaunchProfileId, Project, QuickPrompt } from '@shared/types';
import { useData, useUi } from '../store';
import { profileIcon } from '../util/profileIcon';

/**
 * The Agents-module "+" launcher. Spins up a one-off Quick Agent — a single
 * Claude terminal anchored to the built-in `~/cc-workspace` scratch project —
 * without leaving the Agents view. Mirrors {@link LaunchPanel} (prompt textarea
 * + claude/--yolo profile picker) but adds:
 *   - editable pre-made starter prompts (chips) from the quick-prompt store,
 *   - an optional folder override (a subfolder of the workspace anchor).
 *
 * Deliberately a sibling of LaunchPanel rather than a fork: the project
 * launcher's contract (it takes a `project`, has resume/background lists) is
 * different enough that sharing would couple two evolving surfaces.
 */

type LauncherProfile = 'claude' | 'claude-yolo';

interface ProfileDescriptor {
  id: LauncherProfile;
  profile: LaunchProfileId;
  label: string;
}

const PROFILES: ProfileDescriptor[] = [
  { id: 'claude', profile: 'claude', label: 'claude' },
  { id: 'claude-yolo', profile: 'claude-yolo', label: 'claude --yolo' }
];

/** Whitelist of lucide icons honored in quick-prompt metadata. A miss (absent
 *  or unknown name) falls back to a generic Sparkles, so a typo in a hand-edited
 *  prompt file never crashes the renderer. Mirrors the persona/template lists. */
const PROMPT_ICONS: Record<string, LucideIcon> = {
  GitBranch,
  ListChecks,
  Inbox,
  FlaskConical,
  Sparkles,
  Zap,
  Bot
};

function promptIcon(name: string | undefined, size = 13) {
  const Named = name ? PROMPT_ICONS[name] : undefined;
  const Icon = Named ?? Sparkles;
  return <Icon size={size} />;
}

/** Derive a short, meaningful tab title from the instruction. */
function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

/**
 * Build the `{ extraArgs, title }` for a launch from the raw prompt body and the
 * chosen profile's fallback label. Extracted (and exported) so it can be unit
 * tested without mounting the component. Mirrors `LaunchPanel.launch()`:
 *   - the prompt is seeded as the LAST positional argv element so `claude
 *     [options] [prompt]` picks it up as the first user turn,
 *   - a prompt that begins with a dash is preceded by `--` (end-of-options) so
 *     it is treated as the positional prompt rather than a flag.
 */
export function buildLaunchArgs(
  rawPrompt: string,
  fallbackTitle: string
): { extraArgs?: string[]; title?: string } {
  const extraArgs: string[] = [];
  const body = rawPrompt.trim();
  if (body) {
    if (body.startsWith('-')) extraArgs.push('--');
    extraArgs.push(body);
  }
  const title = body ? titleFromPrompt(body) : fallbackTitle;
  return {
    extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
    title: title || undefined
  };
}

interface Props {
  onClose: () => void;
}

export function QuickAgentLauncher({ onClose }: Props) {
  const createTerminal = useData((s) => s.createTerminal);
  const [anchor, setAnchor] = useState<Project | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [presets, setPresets] = useState<QuickPrompt[]>([]);
  const [folders, setFolders] = useState<FsEntry[]>([]);
  const [prompt, setPrompt] = useState('');
  const [profileId, setProfileId] = useState<LauncherProfile>('claude');
  /** Selected cwd. Empty string = the anchor root. */
  const [cwd, setCwd] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const descriptor = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

  // On mount: ensure the scratch project exists (creates ~/cc-workspace on
  // first run), load presets, and list the anchor's immediate subfolders for
  // the folder-override dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, prompts] = await Promise.all([
        window.cc.projects.ensureQuickAgent(),
        window.cc.quickPrompts.list()
      ]);
      if (cancelled) return;
      if (!res.ok) {
        setAnchorError(res.message);
        return;
      }
      setAnchor(res.value);
      setPresets(prompts);
      const entries = await window.cc.fs.listDir(res.value.path);
      if (cancelled) return;
      setFolders(entries.filter((e) => e.kind === 'dir'));
    })().catch((err) => {
      if (!cancelled) setAnchorError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape closes; Tab is trapped within the dialog; focus returns to the
  // opener on unmount. Same affordances as LaunchPanel's modal variant.
  useEffect(() => {
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
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  const spawn = async (profile: LaunchProfileId, opts: { extraArgs?: string[]; title?: string }) => {
    if (!anchor) return;
    const session = await createTerminal(anchor.id, profile, 80, 24, {
      extraArgs: opts.extraArgs,
      title: opts.title,
      // Empty cwd → main process defaults to the anchor's path; a subfolder is
      // validated `isWithin` the anchor on the main side, so this is safe.
      cwd: cwd || undefined
    });
    if (session) useUi.getState().focusAgent(session);
    onClose();
  };

  const launch = () => {
    void spawn(descriptor.profile, buildLaunchArgs(prompt, descriptor.label));
  };

  // Shell never takes an instruction — launches straight into a terminal.
  const launchShell = () => {
    void spawn('shell', { title: 'shell' });
  };

  const applyPreset = (p: QuickPrompt) => {
    setPrompt(p.prompt);
    if (p.profile === 'claude' || p.profile === 'claude-yolo') {
      setProfileId(p.profile);
    }
    textareaRef.current?.focus();
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      launch();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => onClose()}>
      <div
        ref={dialogRef}
        className="palette launch-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New quick agent"
      >
        <div className="launch-panel">
          <div className="launch-header">
            <h3>Quick agent</h3>
            <p>A scratch Claude session in your workspace</p>
          </div>

          {anchorError && (
            <div className="launch-error" role="alert">
              Couldn’t prepare the workspace: {anchorError}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="launch-instruction"
            placeholder="Describe the task… (⌘↵ to launch). Leave empty to open an interactive session."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={3}
          />

          {presets.length > 0 && (
            <div className="quick-prompt-chips" role="group" aria-label="Starter prompts">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="quick-prompt-chip"
                  onClick={() => applyPreset(p)}
                  title={p.prompt}
                >
                  {promptIcon(p.icon)}
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          )}

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

          {folders.length > 0 && (
            <div className="launch-row">
              <span className="launch-row-label">Folder</span>
              <div className="launch-folder">
                <Folder size={13} aria-hidden="true" />
                <select
                  className="launch-folder-select"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  aria-label="Working directory"
                >
                  <option value="">workspace root</option>
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="launch-actions">
            <button
              type="button"
              className="btn launch-shell-btn"
              onClick={launchShell}
              disabled={!anchor}
              title="Open a shell session"
            >
              <span className="tab-profile-icon profile-shell" aria-hidden="true">
                {profileIcon('shell')}
              </span>
              shell
            </button>
            <button className="btn primary" onClick={launch} disabled={!anchor}>
              <TerminalIcon size={14} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
