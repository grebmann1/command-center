import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock electron before importing the store
const testHome = join(tmpdir(), `persona-store-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: {
    openPath: vi.fn()
  }
}));

import { PersonaStore } from '../persona-store.js';
import type { Project, Persona } from '../../shared/types.js';

describe('PersonaStore', () => {
  let store: PersonaStore;
  let projects: Project[];
  const userDir = join(testHome, '.cc-center', 'personas');

  beforeEach(() => {
    // Clean slate
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });

    projects = [];
    store = new PersonaStore(() => projects);
    store.start();
  });

  afterEach(() => {
    store.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('lists built-in personas on boot', () => {
    const personas = store.list();
    expect(personas.length).toBeGreaterThanOrEqual(2);

    const reviewer = personas.find((p) => p.id === 'builtin:reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer?.name).toBe('Code Reviewer');
    expect(reviewer?.icon).toBe('ShieldCheck');
    expect(reviewer?.source).toBe('builtin');
    expect(reviewer?.baseProfile).toBe('claude');
    expect(reviewer?.model).toBe('opus');
    expect(reviewer?.permissionMode).toBe('plan');
    expect(reviewer?.allowedTools).toContain('Read');
    expect(reviewer?.appendSystemPrompt).toContain('senior code reviewer');
    expect(reviewer?.initialPrompt).toContain('diff');

    const architect = personas.find((p) => p.id === 'builtin:architect');
    expect(architect).toBeDefined();
    expect(architect?.name).toBe('Architect');
    expect(architect?.icon).toBe('Compass');
    expect(architect?.source).toBe('builtin');
    expect(architect?.baseProfile).toBe('claude');
    expect(architect?.permissionMode).toBe('plan');
    expect(architect?.appendSystemPrompt).toContain('systems architect');
  });

  it('shadows a builtin persona with a user file of same id', () => {
    // Write a user persona with the same id as builtin:reviewer
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'builtin:reviewer.json'),
      JSON.stringify({
        id: 'builtin:reviewer',
        name: 'My Custom Reviewer',
        icon: 'Star',
        baseProfile: 'claude',
        appendSystemPrompt: 'Custom review instructions.'
      })
    );

    store.refresh();
    const personas = store.list();
    const reviewer = personas.find((p) => p.id === 'builtin:reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer?.name).toBe('My Custom Reviewer');
    expect(reviewer?.icon).toBe('Star');
    expect(reviewer?.source).toBe('user');
    expect(reviewer?.appendSystemPrompt).toBe('Custom review instructions.');
  });

  it('project persona wins over user and builtin', () => {
    const projectPath = join(testHome, 'my-project');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.cc-center', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'My Project',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    // User file
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'test-persona.json'),
      JSON.stringify({
        id: 'test-persona',
        name: 'User Persona',
        baseProfile: 'claude'
      })
    );

    // Project file with same id
    writeFileSync(
      join(projectPersonasDir, 'test-persona.json'),
      JSON.stringify({
        id: 'test-persona',
        name: 'Project Persona',
        baseProfile: 'claude',
        description: 'Project-specific'
      })
    );

    store.refresh();
    const personas = store.list();
    const persona = personas.find((p) => p.id === 'test-persona');
    expect(persona).toBeDefined();
    expect(persona?.name).toBe('Project Persona');
    expect(persona?.source).toEqual({ projectId: 'proj-1', projectName: 'My Project' });
    expect(persona?.description).toBe('Project-specific');
  });

  it('skips malformed JSON files without throwing', () => {
    mkdirSync(userDir, { recursive: true });
    // Malformed JSON
    writeFileSync(join(userDir, 'bad.json'), '{ invalid json }');
    // Missing required field (name)
    writeFileSync(join(userDir, 'no-name.json'), JSON.stringify({ id: 'test' }));
    // Invalid baseProfile
    writeFileSync(
      join(userDir, 'bad-profile.json'),
      JSON.stringify({ id: 'bad', name: 'Bad', baseProfile: 'invalid' })
    );

    // Should not throw
    expect(() => store.refresh()).not.toThrow();
    const personas = store.list();
    // Only built-ins should be present
    expect(personas.every((p) => p.source === 'builtin')).toBe(true);
  });

  it('validates baseProfile against VALID_PROFILES', () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'invalid-profile.json'),
      JSON.stringify({
        id: 'test',
        name: 'Test',
        baseProfile: 'invalid-profile-name'
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'test')).toBeUndefined();
  });

  it('validates model field', () => {
    mkdirSync(userDir, { recursive: true });
    // Valid model
    writeFileSync(
      join(userDir, 'valid-model.json'),
      JSON.stringify({
        id: 'valid',
        name: 'Valid',
        model: 'opus'
      })
    );
    // Invalid model
    writeFileSync(
      join(userDir, 'invalid-model.json'),
      JSON.stringify({
        id: 'invalid',
        name: 'Invalid',
        model: 'gpt-4'
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'valid')).toBeDefined();
    expect(personas.find((p) => p.id === 'invalid')).toBeUndefined();
  });

  it('validates permissionMode field', () => {
    mkdirSync(userDir, { recursive: true });
    // Valid permissionMode
    writeFileSync(
      join(userDir, 'valid-perm.json'),
      JSON.stringify({
        id: 'valid',
        name: 'Valid',
        permissionMode: 'plan'
      })
    );
    // Invalid permissionMode
    writeFileSync(
      join(userDir, 'invalid-perm.json'),
      JSON.stringify({
        id: 'invalid',
        name: 'Invalid',
        permissionMode: 'super-yolo'
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'valid')).toBeDefined();
    expect(personas.find((p) => p.id === 'invalid')).toBeUndefined();
  });

  it('correctly stamps source on merged personas', () => {
    const projectPath = join(testHome, 'proj');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.cc-center', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'Test Project',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    mkdirSync(userDir, { recursive: true });

    // User persona
    writeFileSync(
      join(userDir, 'user-persona.json'),
      JSON.stringify({ id: 'user-persona', name: 'User' })
    );

    // Project persona
    writeFileSync(
      join(projectPersonasDir, 'project-persona.json'),
      JSON.stringify({ id: 'project-persona', name: 'Project' })
    );

    store.refresh();
    const personas = store.list();

    const userPersona = personas.find((p) => p.id === 'user-persona');
    expect(userPersona?.source).toBe('user');

    const projectPersona = personas.find((p) => p.id === 'project-persona');
    expect(projectPersona?.source).toEqual({ projectId: 'proj-1', projectName: 'Test Project' });

    const builtinPersona = personas.find((p) => p.id === 'builtin:reviewer');
    expect(builtinPersona?.source).toBe('builtin');
  });

  it('dedups by id (later source wins)', () => {
    const projectPath = join(testHome, 'proj');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.cc-center', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'Proj',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    mkdirSync(userDir, { recursive: true });

    const sharedId = 'shared-id';
    // User
    writeFileSync(
      join(userDir, 'shared.json'),
      JSON.stringify({ id: sharedId, name: 'User Version' })
    );
    // Project (should win)
    writeFileSync(
      join(projectPersonasDir, 'shared.json'),
      JSON.stringify({ id: sharedId, name: 'Project Version' })
    );

    store.refresh();
    const personas = store.list();
    const matches = personas.filter((p) => p.id === sharedId);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Project Version');
  });

  it('filters array fields to strings only', () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'arrays.json'),
      JSON.stringify({
        id: 'arrays',
        name: 'Arrays',
        allowedTools: ['Read', 123, 'Write', null],
        deniedTools: ['Bash', false],
        addDirs: ['../other', 42],
        mcpServers: ['slack', true, 'gmail']
      })
    );

    store.refresh();
    const persona = store.list().find((p) => p.id === 'arrays');
    expect(persona?.allowedTools).toEqual(['Read', 'Write']);
    expect(persona?.deniedTools).toEqual(['Bash']);
    expect(persona?.addDirs).toEqual(['../other']);
    expect(persona?.mcpServers).toEqual(['slack', 'gmail']);
  });

  it('revealDir creates the dir and returns the path', async () => {
    const result = await store.revealDir();
    expect(result.ok).toBe(true);
    expect(result.path).toBe(userDir);
    expect(existsSync(userDir)).toBe(true);
  });

  it('onChanged fires when refresh is called', () => {
    return new Promise<void>((resolve) => {
      const unsubscribe = store.onChanged(() => {
        unsubscribe();
        resolve();
      });
      store.refresh();
    });
  });

  it('onChanged returns an unsubscribe function', () => {
    let fired = false;
    const unsubscribe = store.onChanged(() => {
      fired = true;
    });
    unsubscribe();
    store.refresh();
    expect(fired).toBe(false);
  });
});
