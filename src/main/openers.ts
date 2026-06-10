import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { shell } from 'electron';
import type { OpenResult, OpenTarget } from '../shared/types.js';

// macOS terminal preference order: iTerm2, WezTerm, Alacritty, Terminal.app.
// Picked the first time it's needed and cached for the session.
let macTerminalApp: string | null = null;
function pickMacTerminalApp(): string {
  if (macTerminalApp) return macTerminalApp;
  const candidates = [
    ['/Applications/iTerm.app', 'iTerm'],
    ['/Applications/WezTerm.app', 'WezTerm'],
    ['/Applications/Alacritty.app', 'Alacritty']
  ] as const;
  for (const [path, name] of candidates) {
    if (existsSync(path)) {
      macTerminalApp = name;
      return name;
    }
  }
  macTerminalApp = 'Terminal';
  return 'Terminal';
}

function spawnDetached(cmd: string, args: string[]): Promise<OpenResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.once('error', (err) => {
        resolve({ ok: false, message: err.message });
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function openIn(target: OpenTarget, path: string): Promise<OpenResult> {
  switch (target) {
    case 'cursor': {
      const r = await spawnDetached('cursor', [path]);
      if (!r.ok) return { ok: false, message: 'Cursor CLI not found in PATH. Install via Cursor → Cmd+Shift+P → "Shell Command: Install \'cursor\' command".' };
      return r;
    }
    case 'code': {
      const r = await spawnDetached('code', [path]);
      if (!r.ok) return { ok: false, message: 'VS Code CLI not found in PATH. Install via Code → Cmd+Shift+P → "Shell Command: Install \'code\' command".' };
      return r;
    }
    case 'finder': {
      const err = await shell.openPath(path);
      if (err) return { ok: false, message: err };
      return { ok: true };
    }
    case 'terminal': {
      if (process.platform !== 'darwin') {
        return { ok: false, message: 'External terminal launch is not yet supported on this platform.' };
      }
      return spawnDetached('open', ['-a', pickMacTerminalApp(), path]);
    }
    case 'browser': {
      // `path` is a URL here. Only allow http(s) so a module can't coerce
      // the shell into opening file:// or app-scheme links.
      if (!/^https?:\/\//i.test(path)) {
        return { ok: false, message: 'Only http(s) URLs can be opened in the browser.' };
      }
      await shell.openExternal(path);
      return { ok: true };
    }
  }
}
