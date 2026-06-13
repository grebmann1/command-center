import { describe, it, expect, beforeEach, vi } from 'vitest';

// PtyManager imports node-pty (real subprocesses). Mock it with a fake IPty
// that RECORDS the argv it was spawned with, so we can assert exactly what
// reaches the command line — in particular, the persona layer's position in
// the precedence stack and that allowedTools is merged+deduped.
interface FakeProc {
  pid: number;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
      args,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

// Keep claude-profile spawns from writing a real ~/.cc-center/mcp file.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string, extra?: string[]) =>
    `/tmp/${id}/.mcp.json${extra?.length ? `?extra=${extra.join(',')}` : ''}`
}));

import { PtyManager, personaArgs_build } from '../pty.js';
import type { AppConfig, Persona, ProjectSettings } from '../../shared/types.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('personaArgs_build', () => {
  it('emits append-system-prompt before add-dir', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      appendSystemPrompt: 'You are a helpful assistant.',
      addDirs: ['/foo', '/bar']
    };
    const args = personaArgs_build(p, 'claude');
    const promptIdx = args.indexOf('--append-system-prompt');
    const dir1Idx = args.indexOf('--add-dir');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(dir1Idx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeLessThan(dir1Idx);
  });

  it('emits allowedTools as a single comma-separated flag', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      allowedTools: ['Read', 'Write', 'Bash']
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toContain('--allowedTools');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toBe('Read,Write,Bash');
  });

  it('emits deniedTools as --disallowedTools', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      deniedTools: ['Agent', 'TaskCreate']
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toContain('--disallowedTools');
    const idx = args.indexOf('--disallowedTools');
    expect(args[idx + 1]).toBe('Agent,TaskCreate');
  });

  it('emits model and permissionMode last so they override globals', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      appendSystemPrompt: 'foo',
      model: 'opus',
      permissionMode: 'acceptEdits'
    };
    const args = personaArgs_build(p, 'claude');
    const promptIdx = args.indexOf('--append-system-prompt');
    const modelIdx = args.indexOf('--model');
    const permIdx = args.indexOf('--permission-mode');
    expect(promptIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(permIdx).toBeGreaterThanOrEqual(0);
    expect(modelIdx).toBeLessThan(args.length - 1);
    expect(permIdx).toBeLessThan(args.length - 1);
  });

  it('omits permissionMode when base profile is claude-yolo', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      permissionMode: 'acceptEdits'
    };
    const args = personaArgs_build(p, 'claude-yolo');
    expect(args).not.toContain('--permission-mode');
  });

  it('returns empty array when no persona flags are set', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test'
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toEqual([]);
  });
});

describe('PtyManager.create — persona layer integration', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('inserts persona args AFTER MCP args and BEFORE projectSettings', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test Persona',
      appendSystemPrompt: 'persona prompt'
    };
    const projectSettings: ProjectSettings = {
      appendSystemPrompt: 'project prompt'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona,
      projectSettings
    });
    const argv = spawned[0].args;
    // Find the indices of the three append-system-prompt flags:
    //  1. MCP inbox guidance (first)
    //  2. persona prompt (second)
    //  3. project prompt (third)
    const indices: number[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--append-system-prompt') {
        indices.push(i);
      }
    }
    expect(indices.length).toBe(3);
    expect(argv[indices[0] + 1]).toContain('inbox_push'); // MCP guidance
    expect(argv[indices[1] + 1]).toBe('persona prompt');
    expect(argv[indices[2] + 1]).toBe('project prompt');
    // Precedence check: persona < project
    expect(indices[1]).toBeLessThan(indices[2]);
  });

  it('merges persona allowedTools with inbox tools into a single flag', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test Persona',
      allowedTools: ['Read', 'Write']
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    // Count --allowedTools flags; should be exactly one (merged)
    const count = argv.filter((a) => a === '--allowedTools').length;
    expect(count).toBe(1);
    const idx = argv.indexOf('--allowedTools');
    const merged = argv[idx + 1].split(',');
    // Should include both inbox pre-approvals and persona tools
    expect(merged).toContain('mcp__cc-inbox__inbox_push');
    expect(merged).toContain('Read');
    expect(merged).toContain('Write');
    // No duplicates
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('uses persona.baseProfile to override opts.profile for command resolution', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'p1',
      name: 'Yolo Persona',
      baseProfile: 'claude-yolo'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude', // caller asks for plain claude
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona // but persona overrides to yolo
    });
    const argv = spawned[0].args;
    // Should see --dangerously-skip-permissions (the yolo marker)
    expect(argv).toContain('--dangerously-skip-permissions');
  });

  it('skips persona permissionMode when effective profile is claude-yolo', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'p1',
      name: 'Yolo Persona',
      baseProfile: 'claude-yolo',
      permissionMode: 'acceptEdits'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('--permission-mode');
  });

  it('stamps personaId onto the session object', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'persona-abc',
      name: 'Test'
    };
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    expect(session.personaId).toBe('persona-abc');
  });

  it('passes persona mcpServers to mcp-config via the file path', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test',
      mcpServers: ['filesystem', 'git']
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    const mcpIdx = argv.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    // The mock ensureMcpConfigForProjectSync bakes extra names into the path
    const path = argv[mcpIdx + 1];
    expect(path).toContain('?extra=filesystem,git');
  });

  it('does nothing when persona is absent', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
      // no persona
    });
    const argv = spawned[0].args;
    // Should NOT contain persona-specific flags beyond the baseline MCP/inbox
    expect(argv.filter((a) => a === '--append-system-prompt').length).toBe(1);
  });
});
