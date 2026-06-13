# @cctc/cli

Thin, no-daemon CLI for reading Claude Code Terminal Center stores.

## Scope

**READ/AUTHOR TIER ONLY** (v1). This CLI reads the same `~/.cc-center/*.json` files the Electron app uses. Live actions (launching sessions, IPC control) are deferred for future versions.

## Installation

```bash
# From the monorepo root
npm install

# Build the CLI
cd packages/cli
npm run build
```

## Usage

```bash
# Via node (from repo root)
node packages/cli/dist/bin/cc.js projects ls

# Or add to PATH
export PATH="$PWD/packages/cli/dist/bin:$PATH"
cc projects ls
```

## Commands

```bash
# Projects
cc projects ls              # List all projects
cc projects ls --json       # JSON output

# Personas
cc personas ls              # List personas (disk files only)
cc personas ls --json

# Schedules
cc schedule ls              # List scheduled tasks
cc schedule ls --json

# Inbox
cc inbox ls                 # List recent inbox entries
cc inbox ls --project <id>  # Filter by project (accepts id or tag)
cc inbox show <id>          # Show full entry
```

## Configuration

By default, reads from `~/.cc-center/`. Override with:

```bash
CC_CENTER_DIR=/custom/path cc projects ls
```

## Output Modes

- **Human table** (default): Clean tables for terminal reading
- **JSON** (`--json` flag): Machine-readable output for scripts/agents

## Testing

```bash
npm test              # Run vitest tests
npm run test:watch    # Watch mode
```

## Architecture

Follows CU's `runCli()` discipline:
- Pure function returns `{ exitCode, stdout, stderr }` — never calls `process.exit` mid-logic
- Never writes to console directly — returns strings
- Testable with golden files (see `src/__tests__/run-cli.test.ts`)

Store readers are defensive: missing files or malformed JSON return empty lists + warnings on stderr, never throw.

## Store Format

Reads the same stores as the Electron app:
- `~/.cc-center/projects.json` — project list (v0 array or v1 `{version, projects}`)
- `~/.cc-center/personas/<id>.json` — global personas
- `<project>/.cc-center/personas/<id>.json` — per-project personas
- `~/.cc-center/schedules/<id>.json` — global schedules
- `<project>/.cc-center/schedules/<id>.json` — per-project schedules
- `~/.cc-center/inbox/entries.jsonl` — inbox entries (JSONL: one JSON per line)

Note: builtin personas (`builtin:reviewer`, `builtin:architect`) exist in code only and are not listed by the CLI.

## Future (deferred)

Live actions (launching sessions, run-now, IPC control) require the Electron app to be running and will use a localhost control socket. Scope guard: v1 is READ/AUTHOR only.
