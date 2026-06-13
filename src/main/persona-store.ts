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
import type { Project, Persona, LaunchProfileId } from '../shared/types.js';

const userPersonasDir = () => join(app.getPath('home'), '.cc-center', 'personas');
const projectPersonasDir = (project: Project) =>
  join(project.path, '.cc-center', 'personas');

const VALID_PROFILES: LaunchProfileId[] = ['shell', 'claude', 'claude-resume', 'claude-yolo'];

/**
 * Built-in catalogue. Stable IDs are prefixed with `builtin:` so a user can
 * disable / shadow them by dropping a file with the same id stem in their
 * own personas dir.
 */
const BUILTIN: Persona[] = [
  {
    id: 'builtin:reviewer',
    name: 'Code Reviewer',
    icon: 'ShieldCheck',
    description:
      'Senior code reviewer focused on correctness, edge cases, and clarity. Reviews diffs with a critical eye for bugs and maintainability.',
    baseProfile: 'claude',
    model: 'opus',
    permissionMode: 'plan',
    allowedTools: ['Read', 'Grep', 'Glob'],
    appendSystemPrompt: [
      'You are a senior code reviewer. Your reviews prioritize correctness and clarity over cleverness.',
      'When reviewing code:',
      '- Look for logical errors, edge cases, and race conditions',
      '- Flag over-engineering and unnecessary complexity',
      '- Suggest simpler alternatives when they exist',
      '- Point out unclear variable names and missing documentation',
      '- Keep feedback terse and actionable — cite line numbers',
      '',
      'Skip style nits unless they harm readability. Assume the author is competent;',
      'frame findings as questions when unsure. Your goal is to catch bugs before they ship.'
    ].join('\n'),
    initialPrompt: 'Review the current diff for correctness and clarity.'
  },
  {
    id: 'builtin:architect',
    name: 'Architect',
    icon: 'Compass',
    description:
      'Systems design planner. Analyzes requirements, proposes architectures, and identifies trade-offs without writing implementation code.',
    baseProfile: 'claude',
    permissionMode: 'plan',
    appendSystemPrompt: [
      'You are a systems architect. You design solutions, not implementations.',
      'When given a problem:',
      '- Clarify requirements and constraints before proposing solutions',
      '- Sketch 2-3 architectural approaches with trade-offs for each',
      '- Consider scalability, maintainability, and operational complexity',
      '- Identify critical decision points and recommend testing strategies',
      '- Call out risks and dependencies the team should address',
      '',
      'Your output is a design doc, not working code. Keep proposals concrete but',
      'high-level — file structure, module boundaries, data flow. Avoid bikeshedding',
      'implementation details. When trade-offs are unclear, present options and let',
      'the team decide.'
    ].join('\n'),
    initialPrompt:
      'I need an architecture proposal for [describe the feature]. Walk me through 2-3 approaches with trade-offs.'
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  const sample = join(dir, 'example.json.disabled');
  try {
    writeFileSync(
      readme,
      [
        '# Personas',
        '',
        'Drop one JSON file per persona in this directory. Each file becomes a',
        'reusable personality in the New Tab picker and Scheduler. Personas are',
        'named `claude` CLI flag bundles — they compose your existing launch',
        'profiles with model/permission/prompt overrides.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-persona",',
        '  "name": "My Persona",',
        '  "icon": "Sparkles",',
        '  "description": "What it does (optional)",',
        '  "baseProfile": "claude",',
        '  "model": "opus",',
        '  "permissionMode": "plan",',
        '  "appendSystemPrompt": "Custom instructions here.",',
        '  "allowedTools": ["Read", "Grep"],',
        '  "deniedTools": ["Write"],',
        '  "addDirs": ["../sibling-repo"],',
        '  "initialPrompt": "Opening question for the agent."',
        '}',
        '```',
        '',
        '`baseProfile` must be one of `shell`, `claude`, `claude-resume`, `claude-yolo`.',
        '`model` can be `opus`, `sonnet`, `haiku`, or `default` (let Claude decide).',
        '`permissionMode` can be `default`, `acceptEdits`, `plan`, or `bypassPermissions`.',
        'Files with invalid JSON or missing required fields are silently skipped.',
        'A built-in persona is shadowed when you drop a file with the same `id` here.',
        ''
      ].join('\n')
    );
    if (!existsSync(sample)) {
      const example = BUILTIN[0];
      writeFileSync(
        sample,
        JSON.stringify(
          {
            id: 'my-reviewer',
            name: example.name,
            icon: example.icon,
            description: example.description,
            baseProfile: example.baseProfile,
            model: example.model,
            permissionMode: example.permissionMode,
            appendSystemPrompt: 'Custom review instructions here.',
            initialPrompt: example.initialPrompt
          },
          null,
          2
        )
      );
    }
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

function readPersonaFile(path: string): Persona | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Persona>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;

    // Validate baseProfile against VALID_PROFILES if present
    if (raw.baseProfile && !VALID_PROFILES.includes(raw.baseProfile)) return null;

    // Validate model if present
    const validModels: Array<'opus' | 'sonnet' | 'haiku' | 'default'> = [
      'opus',
      'sonnet',
      'haiku',
      'default'
    ];
    if (raw.model && !validModels.includes(raw.model)) return null;

    // Validate permissionMode if present
    const validModes: Array<'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'> = [
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions'
    ];
    if (raw.permissionMode && !validModes.includes(raw.permissionMode)) return null;

    return {
      id: raw.id,
      name: raw.name,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      baseProfile: raw.baseProfile,
      model: raw.model,
      permissionMode: raw.permissionMode,
      appendSystemPrompt:
        typeof raw.appendSystemPrompt === 'string' ? raw.appendSystemPrompt : undefined,
      allowedTools: Array.isArray(raw.allowedTools)
        ? raw.allowedTools.filter((s) => typeof s === 'string')
        : undefined,
      deniedTools: Array.isArray(raw.deniedTools)
        ? raw.deniedTools.filter((s) => typeof s === 'string')
        : undefined,
      addDirs: Array.isArray(raw.addDirs)
        ? raw.addDirs.filter((s) => typeof s === 'string')
        : undefined,
      mcpServers: Array.isArray(raw.mcpServers)
        ? raw.mcpServers.filter((s) => typeof s === 'string')
        : undefined,
      initialPrompt:
        typeof raw.initialPrompt === 'string' ? raw.initialPrompt : undefined
    };
  } catch {
    return null;
  }
}

function listInDir(dir: string, source: Persona['source']): Persona[] {
  if (!existsSync(dir)) return [];
  const out: Persona[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const p = readPersonaFile(join(dir, name));
    if (p) {
      p.source = source;
      out.push(p);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + user dir + per-project dirs, with simple
 * fs.watch-based invalidation so dropping a file in the user dir lights up
 * the picker without an app restart.
 *
 * Resolution order: project > user > builtin. A user persona with the
 * same id as a builtin shadows the builtin.
 */
export class PersonaStore extends EventEmitter {
  private cache: Persona[] = [];
  private projectsRef: () => Project[];
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[]) {
    super();
    this.projectsRef = projectsRef;
  }

  start() {
    const dir = userPersonasDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
    this.attachProjectWatchers();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  list(): Persona[] {
    return this.cache;
  }

  /**
   * Subscribe to changes. Returns an unsubscribe function.
   */
  onChanged(cb: () => void): () => void {
    this.on('changed', cb);
    return () => this.off('changed', cb);
  }

  /** Re-discover all sources. Cheap; called on watch events and on project changes. */
  refresh() {
    const merged = new Map<string, Persona>();
    for (const p of BUILTIN) merged.set(p.id, { ...p, source: 'builtin' });
    for (const p of listInDir(userPersonasDir(), 'user')) merged.set(p.id, p);
    for (const project of this.projectsRef()) {
      const projectSource: Persona['source'] = {
        projectId: project.id,
        projectName: project.name
      };
      for (const p of listInDir(projectPersonasDir(project), projectSource)) {
        merged.set(p.id, p);
      }
    }
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  /** Hook for `store.addProject` / `store.removeProject`. */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.refresh();
  }

  /** Path of the user personas dir (for "Open in Finder"). */
  userDir(): string {
    return userPersonasDir();
  }

  async revealDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userPersonasDir();
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
    const dir = userPersonasDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      // fs.watch errors propagate to 'uncaughtException' on Linux/macOS when
      // the watched dir vanishes (e.g. user `rm -rf`'d it). Catch them here,
      // close the dead watcher, and re-attach with backoff so live updates
      // resume once the dir reappears.
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[persona-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userPersonasDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs (e.g. some network mounts) — fall back to
      // refresh-on-demand. The user can still hit "Refresh" from the UI.
    }
  }

  private attachProjectWatchers() {
    for (const project of this.projectsRef()) {
      const dir = projectPersonasDir(project);
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[persona-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
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
