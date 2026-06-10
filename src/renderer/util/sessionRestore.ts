import type { LaunchProfileId, TerminalSession, Project } from '../../shared/types.js';

/**
 * Silent session restore across app launches.
 *
 * The app kills every pty on quit (no background daemon), so we can't keep a
 * live process across a restart. What we *can* do is remember which visible
 * tabs were open in each project and re-spawn them on next launch — and, for
 * Claude tabs, relaunch with `--continue` so the agent picks up its most recent
 * conversation in that directory (Claude CLI persists transcripts to disk;
 * `--continue` is non-interactive and silently starts fresh when there's no
 * prior conversation, so restore never errors).
 *
 * This module is pure: snapshot shape + the planning logic. The store owns the
 * localStorage I/O and the actual createTerminal calls, so this stays unit-
 * testable without a DOM or IPC.
 */

const STORAGE_KEY = 'cc.openSessions';

/** One remembered tab. Mirrors ClosedTab — enough to reopen faithfully. */
export interface SessionSnapshot {
  profile: LaunchProfileId;
  title: string;
  extraArgs?: string[];
  cwd?: string;
  pinned?: boolean;
}

/** Per-project map of remembered tabs, in tab order. */
export type SessionSnapshotMap = Record<string, SessionSnapshot[]>;

/** Claude-family profiles that own a resumable conversation. */
function isClaudeProfile(profile: LaunchProfileId): boolean {
  return profile === 'claude' || profile === 'claude-resume' || profile === 'claude-yolo';
}

/**
 * Build the snapshot for one project's tab strip. Only *visible, local* tabs
 * are remembered: headless/background sessions and remote (ssh) projects are
 * skipped (their silent re-spawn is surprising — a stale tunnel could hang).
 * The caller passes already-visible tabs; we just project them to the snapshot
 * shape. Pure.
 */
export function snapshotTabs(tabs: TerminalSession[]): SessionSnapshot[] {
  return tabs
    .filter((t) => !t.headless && t.status !== 'exited')
    .map((t) => ({
      profile: t.profile,
      title: t.title,
      extraArgs: t.extraArgs,
      cwd: t.cwd,
      pinned: t.pinned
    }));
}

/**
 * Whether `--continue` should be appended for this profile. Exposed for tests
 * and so the planner and any future caller agree on the rule.
 */
export function shouldResumeConversation(profile: LaunchProfileId): boolean {
  return isClaudeProfile(profile);
}

/**
 * Append `--continue` to a claude tab's args so it resumes its prior
 * conversation. Idempotent: never adds a second `--continue`, and leaves a tab
 * that already carries `--resume <id>` (resume-picker tabs) untouched so we
 * don't fight an explicit session pin. Returns a new array; pure.
 */
export function withResumeArgs(
  profile: LaunchProfileId,
  extraArgs: string[] | undefined
): string[] | undefined {
  if (!shouldResumeConversation(profile)) return extraArgs;
  const args = extraArgs ?? [];
  // Already resuming/continuing (space- or `=`-joined, short or long form) —
  // don't add a conflicting flag, and don't override an explicit --resume <id>.
  const alreadyResumes = args.some(
    (a) =>
      a === '--continue' ||
      a === '-c' ||
      a === '--resume' ||
      a === '-r' ||
      a.startsWith('--continue=') ||
      a.startsWith('--resume=')
  );
  if (alreadyResumes) return extraArgs;
  return [...args, '--continue'];
}

/** One tab to spawn during restore: the project + the args to launch with. */
export interface RestorePlanItem {
  projectId: string;
  profile: LaunchProfileId;
  title: string;
  cwd?: string;
  pinned?: boolean;
  /** extraArgs with `--continue` already folded in for claude profiles. */
  extraArgs?: string[];
}

/**
 * Decide what to spawn on launch. For each remembered tab we emit a plan item,
 * EXCEPT:
 *   - projects that no longer exist (deleted while the app was closed),
 *   - remote projects (ssh) — excluded in v1,
 *   - projects that already have live sessions — a renderer reload (not a fresh
 *     launch) re-hydrates live ptys from main, and we must not double-spawn on
 *     top of them.
 *
 * Pure: takes the snapshot + current world, returns the spawn list.
 */
export function planRestore(
  snapshot: SessionSnapshotMap,
  projects: Project[],
  liveTerminals: Record<string, TerminalSession[]>,
  skipProjectIds?: Set<string>
): RestorePlanItem[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const plan: RestorePlanItem[] = [];
  for (const [projectId, tabs] of Object.entries(snapshot)) {
    const project = byId.get(projectId);
    if (!project) continue; // project deleted while closed
    if (project.remote) continue; // remote tabs not restored in v1
    if (skipProjectIds?.has(projectId)) continue; // hydration failed — can't tell if live
    const live = liveTerminals[projectId] ?? [];
    if (live.length > 0) continue; // already alive (renderer reload) — don't dupe
    for (const tab of tabs) {
      plan.push({
        projectId,
        profile: tab.profile,
        title: tab.title,
        cwd: tab.cwd,
        pinned: tab.pinned,
        extraArgs: withResumeArgs(tab.profile, tab.extraArgs)
      });
    }
  }
  return plan;
}

/** Read the snapshot from localStorage. Returns {} on any error. */
export function readSnapshot(): SessionSnapshotMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SessionSnapshotMap) : {};
  } catch {
    return {};
  }
}

/** Write the snapshot to localStorage. Swallows quota/serialization errors. */
export function writeSnapshot(snapshot: SessionSnapshotMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota or serialization failure — losing restore state is non-fatal */
  }
}
