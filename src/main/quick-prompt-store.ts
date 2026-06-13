import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import type { QuickPrompt, LaunchProfileId } from '../shared/types.js';

const userDir = () => join(app.getPath('home'), '.cc-center', 'quick-prompts');

const VALID_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

/**
 * Built-in starter prompts for the Agents-module Quick Agent launcher. Stable
 * IDs are prefixed with `builtin:` so a user can shadow one by dropping a file
 * with the same id in their own quick-prompts dir.
 *
 * The Quick Agent runs in the `~/cc-workspace` scratch project, so prompts are
 * phrased for an agent that has a shell + the cc-center MCP, but is honest about
 * what it can and can't do automatically (e.g. it clones a repo and tells the
 * user how to register it; it does not silently mutate the project list).
 */
const BUILTIN: QuickPrompt[] = [
  {
    id: 'builtin:clone-repo',
    label: 'Clone a GitHub repo',
    icon: 'GitBranch',
    profile: 'claude',
    prompt: [
      'I want to bring a GitHub repository into my workspace.',
      'Ask me for the repo URL if I have not given it, then `git clone` it into the',
      'current working directory. Once the clone succeeds, register it as a project',
      'by calling the `register_project` MCP tool (mcp__cc-inbox__register_project)',
      'with the cloned folder name as `path` — this adds it to my project list and',
      'it will appear in the sidebar immediately. Then confirm the project name and',
      'path back to me. Do not modify anything outside the clone.'
    ].join(' ')
  },
  {
    id: 'builtin:audit-projects',
    label: 'Audit my project list',
    icon: 'ListChecks',
    profile: 'claude',
    prompt: [
      'Review my Claude Code Terminal Center project list (read',
      '~/.cc-center/data/projects.json, or use the `cc projects ls` CLI if',
      'available). For each project, note whether its path still exists on disk',
      'and flag duplicates or stale entries. Output a short triaged list with a',
      'suggested action per row. Do not delete or modify anything.'
    ].join(' ')
  },
  {
    id: 'builtin:summarize-inbox',
    label: "Summarize today's inbox",
    icon: 'Inbox',
    profile: 'claude',
    prompt: [
      'Summarize the most recent entries in my Claude Code Terminal Center inbox',
      '(~/.cc-center/inbox/entries.jsonl). Group them by project and classify each',
      'as action / fyi / noise with a one-line note. Keep it under 15 bullets.'
    ].join(' ')
  },
  {
    id: 'builtin:scratch-experiment',
    label: 'New scratch experiment',
    icon: 'FlaskConical',
    profile: 'claude-yolo',
    prompt: [
      'Set up a fresh scratch experiment in a new subfolder of the current',
      'directory. Ask me what I want to prototype, scaffold a minimal project for',
      'it (language/runtime of my choice), and leave me a note on how to run it.'
    ].join(' ')
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  try {
    writeFileSync(
      readme,
      [
        '# Quick prompts',
        '',
        'Drop one JSON file per prompt in this directory. Each file becomes a',
        'starter chip in the Agents-module Quick Agent launcher. Clicking a chip',
        'seeds the prompt into the launcher textarea — the user can still edit it',
        'before launching.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-prompt",',
        '  "label": "Short chip label",',
        '  "prompt": "The prompt text seeded into the textarea.",',
        '  "profile": "claude",',
        '  "icon": "Sparkles"',
        '}',
        '```',
        '',
        '`profile` is optional and must be one of `shell`, `claude`,',
        '`claude-resume`, `claude-yolo`. Files with invalid JSON or a missing',
        '`id`/`label`/`prompt` are silently skipped. A built-in prompt is shadowed',
        'when you drop a file with the same `id` here.',
        ''
      ].join('\n')
    );
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

function readPromptFile(path: string): QuickPrompt | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<QuickPrompt>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
    if (typeof raw.label !== 'string' || !raw.label.trim()) return null;
    if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) return null;
    const profile =
      raw.profile && VALID_PROFILES.includes(raw.profile) ? raw.profile : undefined;
    return {
      id: raw.id,
      label: raw.label,
      prompt: raw.prompt,
      profile,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined
    };
  } catch {
    return null;
  }
}

function listInDir(dir: string): QuickPrompt[] {
  if (!existsSync(dir)) return [];
  const out: QuickPrompt[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const p = readPromptFile(join(dir, name));
    if (p) {
      p.source = 'user';
      out.push(p);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + the user dir, with fs.watch-based invalidation
 * so dropping a file in the user dir lights up the launcher without a restart.
 * A user prompt with the same id as a builtin shadows the builtin. Mirrors
 * {@link TemplateStore} but with no per-project tier — quick prompts are global.
 */
export class QuickPromptStore extends EventEmitter {
  private cache: QuickPrompt[] = [];
  private userWatcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  start() {
    const dir = userDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  list(): QuickPrompt[] {
    return this.cache;
  }

  /** Re-discover all sources. Cheap; called on watch events. */
  refresh() {
    const merged = new Map<string, QuickPrompt>();
    for (const p of BUILTIN) merged.set(p.id, { ...p, source: 'builtin' });
    for (const p of listInDir(userDir())) merged.set(p.id, p);
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  async revealUserDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userDir();
    try {
      ensureDir(path);
      ensureReadme(path);
      await shell.openPath(path);
      return { ok: true, path };
    } catch (err) {
      return {
        ok: false,
        path,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = userDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      // fs.watch errors propagate to 'uncaughtException' when the watched dir
      // vanishes (e.g. user `rm -rf`'d it). Catch, close the dead watcher, and
      // re-attach with backoff so live updates resume once the dir reappears.
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[quick-prompt-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs — fall back to refresh-on-demand.
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refresh();
    }, 150);
  }
}
