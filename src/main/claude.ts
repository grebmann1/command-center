import { app } from 'electron';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeSessionSummary } from '../shared/types.js';

// Claude Code stores per-project session logs at:
//   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
// where <encoded-cwd> replaces every '/' in the absolute project path with '-'.
function encodeCwd(absPath: string): string {
  return absPath.replace(/\//g, '-');
}

function projectsDir(): string {
  return join(app.getPath('home'), '.claude', 'projects');
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

function extractFirstUserPrompt(lines: string[]): string | null {
  for (const raw of lines) {
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as JsonlLine;
      if (obj?.message?.role === 'user') {
        const c = obj.message.content;
        if (typeof c === 'string') return truncate(c);
        if (Array.isArray(c)) {
          const text = c
            .map((b) => (b && typeof b === 'object' && 'text' in b ? (b as { text: string }).text : ''))
            .filter(Boolean)
            .join(' ');
          if (text) return truncate(text);
        }
      }
    } catch {
      /* ignore malformed lines */
    }
  }
  return null;
}

function truncate(s: string, n = 120): string {
  const single = s.replace(/\s+/g, ' ').trim();
  return single.length > n ? single.slice(0, n - 1) + '…' : single;
}

export function listClaudeSessions(projectPath: string): ClaudeSessionSummary[] {
  const dir = join(projectsDir(), encodeCwd(projectPath));
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const summaries: ClaudeSessionSummary[] = [];

  for (const file of entries) {
    const full = join(dir, file);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    let raw = '';
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n');
    const messageCount = lines.filter((l) => l.trim().length > 0).length;
    summaries.push({
      id: file.replace(/\.jsonl$/, ''),
      projectPath,
      startedAt: stat.birthtimeMs || stat.mtimeMs,
      lastActiveAt: stat.mtimeMs,
      messageCount,
      firstUserPrompt: extractFirstUserPrompt(lines)
    });
  }

  summaries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return summaries;
}
