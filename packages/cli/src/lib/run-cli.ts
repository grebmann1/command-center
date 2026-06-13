/**
 * Pure CLI runner — returns a result object, never calls process.exit or
 * writes to console directly. Makes it testable with golden files.
 */

import { homedir } from 'node:os';
import type { Project, Persona, ScheduledTask, InboxEntry } from './types.js';
import {
  readProjects,
  readPersonas,
  readSchedules,
  readInbox
} from './store-readers.js';

export interface CliDeps {
  dataDir: string;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

const VERSION = '0.1.0';

/**
 * Pull `--data-dir <path>` (or `--data-dir=<path>`) out of the arg list,
 * returning the resolved value (if any) and the remaining args with the flag
 * and its value removed. Pure — no env / fs access. Last occurrence wins.
 */
function extractDataDir(args: string[]): { dataDir?: string; rest: string[] } {
  const rest: string[] = [];
  let dataDir: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--data-dir') {
      // value is the next token (if present and not another flag)
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        dataDir = next;
        i += 1;
      }
      continue;
    }
    if (a.startsWith('--data-dir=')) {
      dataDir = a.slice('--data-dir='.length);
      continue;
    }
    rest.push(a);
  }
  return { dataDir, rest };
}

export async function runCli(argv: string[], deps?: Partial<CliDeps>): Promise<CliResult> {
  const args = argv.slice(2); // Strip 'node' and script path

  // Resolve the `--data-dir <path>` flag (and its `--data-dir=<path>` form)
  // out of argv first so it doesn't get parsed as a positional. Precedence:
  // injected deps.dataDir → --data-dir flag → CC_CENTER_DIR env → default.
  const { dataDir: flagDataDir, rest: argsNoData } = extractDataDir(args);
  const dataDir = deps?.dataDir ||
                  flagDataDir ||
                  process.env.CC_CENTER_DIR ||
                  `${homedir()}/.cc-center`;

  if (argsNoData.length === 0 || argsNoData.includes('--help') || argsNoData.includes('-h')) {
    return help();
  }

  if (argsNoData.includes('--version') || argsNoData.includes('-v')) {
    return { exitCode: 0, stdout: `cc version ${VERSION}\n` };
  }

  const jsonOutput = argsNoData.includes('--json');
  const filteredArgs = argsNoData.filter(a => a !== '--json');

  const [command, subcommand, ...rest] = filteredArgs;

  try {
    if (command === 'projects' && subcommand === 'ls') {
      return await projectsList(dataDir, jsonOutput);
    } else if (command === 'personas' && subcommand === 'ls') {
      return await personasList(dataDir, jsonOutput);
    } else if (command === 'schedule' && subcommand === 'ls') {
      return await scheduleList(dataDir, jsonOutput);
    } else if (command === 'inbox' && subcommand === 'ls') {
      return await inboxList(dataDir, rest, jsonOutput);
    } else if (command === 'inbox' && subcommand === 'show') {
      const id = rest[0];
      if (!id) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Error: inbox show requires an entry id\n'
        };
      }
      return await inboxShow(dataDir, id, jsonOutput);
    } else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: unknown command '${command} ${subcommand}'\nRun 'cc --help' for usage.\n`
      };
    }
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: ${(err as Error).message}\n`
    };
  }
}

function help(): CliResult {
  const text = `cc - Claude Code Terminal Center CLI

USAGE:
  cc <command> [options]

COMMANDS:
  projects ls              List projects
  personas ls              List personas
  schedule ls              List scheduled tasks
  inbox ls [--project ID]  List inbox entries
  inbox show <id>          Show full inbox entry

OPTIONS:
  --json                   Output as JSON (machine-readable)
  --data-dir <path>        Override data directory (takes precedence over CC_CENTER_DIR)
  --help, -h               Show this help
  --version, -v            Show version

ENVIRONMENT:
  CC_CENTER_DIR            Override data directory (default: ~/.cc-center)

EXAMPLES:
  cc projects ls
  cc personas ls --json
  cc inbox ls --project my-proj
  cc inbox show abc123
`;
  return { exitCode: 0, stdout: text };
}

async function projectsList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects, warnings } = readProjects(dataDir);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(projects, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (projects.length === 0) {
    output = 'No projects found.\n';
  } else {
    // Human table: id, name, tag, path
    const rows = projects.map(p => ({
      id: p.id.slice(0, 8),
      name: p.name,
      tag: p.tag || '-',
      path: p.path
    }));

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      tag: Math.max(3, ...rows.map(r => r.tag.length)),
      path: Math.max(4, ...rows.map(r => r.path.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'TAG'.padEnd(colWidths.tag)}  PATH\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.tag)}  ----\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.tag.padEnd(colWidths.tag)}  ${r.path}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function personasList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects } = readProjects(dataDir);
  const { data: personas, warnings } = readPersonas(dataDir, projects);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(personas, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (personas.length === 0) {
    output = 'No personas found. Note: builtin personas (builtin:reviewer, builtin:architect) are not file-backed.\n';
  } else {
    const rows = personas.map(p => ({
      id: p.id,
      name: p.name,
      baseProfile: p.baseProfile || 'claude',
      source: formatPersonaSource(p.source)
    }));

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      baseProfile: Math.max(7, ...rows.map(r => r.baseProfile.length)),
      source: Math.max(6, ...rows.map(r => r.source.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'PROFILE'.padEnd(colWidths.baseProfile)}  SOURCE\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.baseProfile)}  ------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.baseProfile.padEnd(colWidths.baseProfile)}  ${r.source}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

function formatPersonaSource(source: Persona['source']): string {
  if (!source) return 'unknown';
  if (source === 'user') return 'global';
  if (source === 'builtin') return 'builtin';
  return source.projectName || source.projectId.slice(0, 8);
}

async function scheduleList(dataDir: string, json: boolean): Promise<CliResult> {
  const { data: projects } = readProjects(dataDir);
  const { data: schedules, warnings } = readSchedules(dataDir, projects);

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(schedules, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (schedules.length === 0) {
    output = 'No scheduled tasks found.\n';
  } else {
    const rows = schedules.map(s => {
      const project = projects.find(p => p.id === s.projectId);
      return {
        id: s.id.slice(0, 8),
        name: s.name,
        enabled: s.enabled ? 'yes' : 'no',
        every: s.schedule.every,
        project: project?.name || s.projectId.slice(0, 8),
        lastResult: s.status.lastRunResult || '-'
      };
    });

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      name: Math.max(4, ...rows.map(r => r.name.length)),
      enabled: 7,
      every: Math.max(5, ...rows.map(r => r.every.length)),
      project: Math.max(7, ...rows.map(r => r.project.length)),
      lastResult: Math.max(6, ...rows.map(r => r.lastResult.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'NAME'.padEnd(colWidths.name)}  ${'ENABLED'.padEnd(colWidths.enabled)}  ${'EVERY'.padEnd(colWidths.every)}  ${'PROJECT'.padEnd(colWidths.project)}  LAST-RUN\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.name)}  ${'-'.repeat(colWidths.enabled)}  ${'-'.repeat(colWidths.every)}  ${'-'.repeat(colWidths.project)}  --------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.name.padEnd(colWidths.name)}  ${r.enabled.padEnd(colWidths.enabled)}  ${r.every.padEnd(colWidths.every)}  ${r.project.padEnd(colWidths.project)}  ${r.lastResult}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function inboxList(dataDir: string, rest: string[], json: boolean): Promise<CliResult> {
  let projectId: string | undefined;

  // Parse --project <id|tag>
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--project' && rest[i + 1]) {
      projectId = rest[i + 1];
      break;
    }
  }

  // If projectId looks like a tag (lowercase alphanumeric), resolve it
  const { data: projects } = readProjects(dataDir);
  if (projectId) {
    const byTag = projects.find(p => p.tag === projectId);
    if (byTag) {
      projectId = byTag.id;
    }
  }

  const { data: entries, warnings } = readInbox(dataDir, { limit: 20, projectId });

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(entries, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  let output = '';
  if (entries.length === 0) {
    output = 'No inbox entries found.\n';
  } else {
    const rows = entries.map(e => {
      const project = projects.find(p => p.id === e.projectId);
      const firstLine = e.comments?.split('\n')[0] || '';
      return {
        id: e.id.slice(0, 8),
        ts: new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19),
        project: e.projectLabel || project?.name || e.projectId.slice(0, 8),
        preview: firstLine.slice(0, 50) + (firstLine.length > 50 ? '...' : '')
      };
    });

    const colWidths = {
      id: Math.max(2, ...rows.map(r => r.id.length)),
      ts: 19,
      project: Math.max(7, ...rows.map(r => r.project.length)),
      preview: Math.max(7, ...rows.map(r => r.preview.length))
    };

    const header = `${'ID'.padEnd(colWidths.id)}  ${'TIMESTAMP'.padEnd(colWidths.ts)}  ${'PROJECT'.padEnd(colWidths.project)}  PREVIEW\n`;
    const separator = `${'-'.repeat(colWidths.id)}  ${'-'.repeat(colWidths.ts)}  ${'-'.repeat(colWidths.project)}  -------\n`;
    const body = rows.map(r =>
      `${r.id.padEnd(colWidths.id)}  ${r.ts.padEnd(colWidths.ts)}  ${r.project.padEnd(colWidths.project)}  ${r.preview}`
    ).join('\n') + '\n';

    output = header + separator + body;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}

async function inboxShow(dataDir: string, id: string, json: boolean): Promise<CliResult> {
  const { data: entries, warnings } = readInbox(dataDir);
  // Prefer an exact id match; otherwise accept a unique prefix. entries are
  // ts-descending, so an ambiguous prefix would silently pick the newest —
  // warn instead so the user knows to disambiguate.
  const exact = entries.find(e => e.id === id);
  const prefixMatches = exact ? [exact] : entries.filter(e => e.id.startsWith(id));
  const entry = exact ?? prefixMatches[0];

  if (!entry) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: inbox entry '${id}' not found\n`
    };
  }
  if (!exact && prefixMatches.length > 1) {
    warnings.push(
      `Warning: '${id}' matches ${prefixMatches.length} entries; showing the most recent. ` +
        `Use a longer id prefix to disambiguate.`
    );
  }

  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(entry, null, 2) + '\n',
      stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
    };
  }

  const { data: projects } = readProjects(dataDir);
  const project = projects.find(p => p.id === entry.projectId);

  let output = `Inbox Entry: ${entry.id}\n`;
  output += `Project: ${entry.projectLabel || project?.name || entry.projectId}\n`;
  output += `Timestamp: ${new Date(entry.ts).toISOString()}\n`;

  if (entry.docs && entry.docs.length > 0) {
    output += `\nDocuments:\n`;
    for (const doc of entry.docs) {
      output += `  - ${doc.path}\n`;
    }
  }

  if (entry.comments) {
    output += `\nComments:\n${entry.comments}\n`;
  }

  return {
    exitCode: 0,
    stdout: output,
    stderr: warnings.length > 0 ? warnings.join('\n') + '\n' : undefined
  };
}
