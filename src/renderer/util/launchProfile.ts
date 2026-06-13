// Resolving a project's one-click default launch profile from `defaultAgents`.
// Extracted so ListPane, Workspace, and the command palette share one source of
// truth instead of each keeping a near-identical local copy.
import type { LaunchProfileId, Project } from '@shared/types';

/** The launch profiles the UI knows how to spawn directly. A `defaultAgents`
 *  entry that isn't one of these is a persona/agent id, not a profile. */
export const KNOWN_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

/** Narrow an arbitrary string to a LaunchProfileId, or undefined if unknown. */
export function knownProfile(value: string | undefined): LaunchProfileId | undefined {
  return value && (KNOWN_PROFILES as string[]).includes(value) ? (value as LaunchProfileId) : undefined;
}

/** First entry in `defaultAgents` wins for one-click "+" semantics, but only if
 *  it's a known profile id; otherwise fall back to plain 'claude'. */
export function projectDefaultProfile(project: Project): LaunchProfileId {
  return knownProfile(project.defaultAgents?.[0]) ?? 'claude';
}
