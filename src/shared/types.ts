export type LaunchProfileId = 'shell' | 'claude' | 'claude-resume' | 'claude-continue';

export interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  sortIndex?: number;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  title: string;
  profile: LaunchProfileId;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
  extraArgs?: string[];
  pinned?: boolean;
}

export interface AppConfig {
  version: 1;
  theme: 'dark' | 'light';
  shell: string;
  claudeBinary: string;
  fontSize: number;
  lastProjectId: string | null;
  workspaceModes?: Record<string, 'terminals' | 'explorer'>;
  listPaneWidth?: number;
  windowBounds?: { x?: number; y?: number; width: number; height: number };
}

export interface CreateTerminalRequest {
  projectId: string;
  profile: LaunchProfileId;
  cols: number;
  rows: number;
  extraArgs?: string[];
  title?: string;
  cwd?: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
  path: string;
}

export interface FsReadResult {
  ok: boolean;
  content?: string;
  bytes?: number;
  binary?: boolean;
  truncated?: boolean;
  message?: string;
}

export interface FsWriteResult {
  ok: boolean;
  bytes?: number;
  message?: string;
}

export interface WalkedFile {
  rel: string;
  path: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface SearchHit {
  rel: string;
  path: string;
  line: number;
  column: number;
  match: string;
  preview: string;
}

export interface SearchResult {
  hits: SearchHit[];
  scanned: number;
  truncated: boolean;
}

export type OpenTarget = 'cursor' | 'code' | 'finder' | 'terminal';

export interface OpenResult {
  ok: boolean;
  message?: string;
}

// Per-file git status code, matching VSCode's surface:
//   M = modified (staged or unstaged)
//   A = added (staged new file)
//   D = deleted
//   R = renamed
//   ? = untracked
//   ! = ignored (we don't surface these by default)
//   C = conflict (unmerged)
export type GitFileCode = 'M' | 'A' | 'D' | 'R' | '?' | 'C';

export interface GitStatus {
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  dirty: boolean;
  // Repo absolute path (toplevel) + per-file map keyed by absolute path. The
  // tree decoration consumer can look up `files[entry.path]` directly.
  toplevel?: string;
  files?: Record<string, GitFileCode>;
}

export interface ClaudeSessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
  firstUserPrompt: string | null;
}

export interface GitDiscardResult {
  ok: boolean;
  message?: string;
}

export interface GitShowResult {
  ok: boolean;
  /** UTF-8 contents of the file at HEAD; absent for binary or missing. */
  content?: string;
  /** True when HEAD has no entry for this path (e.g. newly added file). */
  notInHead?: boolean;
  /** True when HEAD blob looks binary; we can't render a text diff. */
  binary?: boolean;
  message?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export interface CcApi {
  projects: {
    list(): Promise<Project[]>;
    add(path: string): Promise<Result<Project>>;
    remove(id: string): Promise<void>;
    update(id: string, patch: { name?: string; color?: string }): Promise<Project | null>;
    touch(id: string): Promise<Project | null>;
    reorder(orderedIds: string[]): Promise<Project[]>;
    pickDirectory(): Promise<string | null>;
  };
  terminals: {
    list(projectId: string): Promise<TerminalSession[]>;
    create(req: CreateTerminalRequest): Promise<Result<TerminalSession>>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
    onData(cb: (sessionId: string, data: string) => void): () => void;
    onExit(cb: (sessionId: string, code: number) => void): () => void;
    onTitle(cb: (sessionId: string, title: string) => void): () => void;
  };
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
  };
  claude: {
    listSessions(projectPath: string): Promise<ClaudeSessionSummary[]>;
  };
  fs: {
    listDir(path: string): Promise<FsEntry[]>;
    readFile(path: string): Promise<FsReadResult>;
    writeFile(path: string, content: string): Promise<FsWriteResult>;
    walkFiles(path: string): Promise<WalkedFile[]>;
    searchFiles(path: string, query: string, opts?: SearchOptions): Promise<SearchResult>;
  };
  openers: {
    openIn(target: OpenTarget, path: string): Promise<OpenResult>;
  };
  git: {
    status(path: string): Promise<GitStatus | null>;
    showHead(path: string): Promise<GitShowResult>;
    discard(path: string): Promise<GitDiscardResult>;
  };
  files: {
    pathForFile(file: File): string;
  };
  app: {
    onMenuEvent(cb: (event: string) => void): () => void;
  };
}

declare global {
  interface Window {
    cc: CcApi;
  }
}
