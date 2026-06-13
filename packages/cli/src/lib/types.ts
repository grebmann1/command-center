/**
 * Minimal type definitions for the CLI, mirroring shapes from
 * ../../src/shared/types.ts. These are the read-only subsets the CLI needs.
 * We declare them here instead of importing from src/shared to keep the
 * package self-contained and avoid path-mapping complexity.
 */

export type LaunchProfileId = 'shell' | 'claude' | 'claude-resume' | 'claude-yolo';

export interface Project {
  id: string;
  name: string;
  path: string;
  tag?: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  remote?: ProjectRemote;
}

export interface ProjectRemote {
  host: string;
  user?: string;
  remotePath?: string;
}

export interface Persona {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  baseProfile?: LaunchProfileId;
  model?: 'opus' | 'sonnet' | 'haiku' | 'default';
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  addDirs?: string[];
  mcpServers?: string[];
  initialPrompt?: string;
  source?: 'builtin' | 'user' | { projectId: string; projectName?: string };
}

export type InboxNotifyLevel = 'silent' | 'quiet' | 'loud';

export interface ScheduleStatus {
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped';
  lastRunSessionId?: string;
  nextRunAt?: string;
  runCount: number;
  runs: ScheduleRun[];
}

export interface ScheduleRun {
  id?: string;
  at: string;
  result: 'success' | 'error' | 'skipped';
  sessionId?: string;
  durationMs?: number;
  finishedAt?: string;
  message?: string;
  report?: string;
  reportedAt?: string;
  reportStatus?: 'success' | 'partial' | 'failure';
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  projectId: string;
  profile: LaunchProfileId;
  personaId?: string;
  extraArgs?: string[];
  prompt?: string;
  schedule: {
    every: string;
  };
  overlap: 'skip';
  history: {
    retain: number;
  };
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  source?: 'global' | { projectId: string };
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  group?: string;
}

export interface InboxDoc {
  path: string;
}

export interface InboxEntry {
  id: string;
  ts: number;
  projectId: string;
  projectLabel?: string;
  docs?: InboxDoc[];
  comments?: string;
  sessionId?: string;
  scheduled?: boolean;
  notify?: InboxNotifyLevel;
}
