# Roadmap

Parked ideas and planned work, newest first. Each entry is self-contained so it
can be picked up cold. `Status` ∈ {parked, planned, in-progress, shipped, dropped}.

---

## Launchable Personas

**Status:** parked (brainstormed + planned 2026-06-09, deferred for later thought)
**Full plan:** [`docs/personas-plan.md`](./personas-plan.md)

### One-line
Spawn named, reusable Claude Code personalities (Reviewer, Architect, Bug-hunter…)
into terminal tabs, per project — à la Zana personas, but native to this app.

### Why it's worth doing
~90% of the plumbing already exists. The launch path in `src/main/pty.ts` is
already a layered profile system; it's just hardcoded to 4 profiles. A persona is
"one more layer" + a manifest loader we've already written once (the scheduler's
`ScheduleTemplate` discovery). High value (the spawn moment), low blast radius.

### Key insight (don't re-derive this later)
A Persona is **a manifest that composes native `claude` CLI flags** — NOT a new
launch mechanism or runtime. It maps only to flags the CLI already accepts:
`--append-system-prompt`, `--model`, `--permission-mode`, `--allowedTools`,
`--disallowedTools`, `--add-dir`, `--mcp-config`, `--agents`. This keeps us
forward-compatible: if Anthropic ships richer agent config, we map to it, not
around it.

Two existing rails it rides:
1. **Precedence chain in `pty.ts`** — `resolveLaunch(profile)` → AppConfig globals
   → ProjectSettings → extraArgs → MCP injection. Persona = a NEW layer between
   AppConfig globals and ProjectSettings. `ProjectSettings` is already effectively
   an unnamed, one-per-project persona (appendSystemPrompt + model + permissionMode
   + allowedTools + deniedTools + addDirs + extraArgs).
2. **`ScheduleTemplate` loader in `src/main/template-store.ts`** — builtin ⊕
   `~/.cc-center/templates/*.json` ⊕ `<project>/.cc-center/templates/*.json`,
   precedence-merged, hot-reloaded via `onTemplatesChanged`. Fork this verbatim
   for persona discovery (`~/.cc-center/personas/`, `<repo>/.cc-center/personas/`).

### Decision already made (2026-06-09)
**Sit-beside, NOT absorb.** `LaunchProfileId` stays the 4-value union
(`shell | claude | claude-resume | claude-yolo`). `TerminalSession`,
`CreateTerminalRequest`, scheduler etc. gain an optional `personaId`. A persona
declares a `baseProfile` it builds on. Rejected alternative: replacing the union
with a Persona record ("personas all the way down") — cleaner end state but touches
every `LaunchProfileId` site, `profileIcon`, scheduler, command palette, store,
persistence. Not worth the churn.

### Scope guard (v1 is small)
v1 persona = the `ProjectSettings` fields + name/icon/description + optional
`initialPrompt` + optional MCP allowlist. NO new orchestration, NO lifecycle, NO
inheritance graph. Reuse `inbox_push` for "persona finished". Multi-agent stays a
Phase 4 hand-off to the existing Zana `team`/`council` skills — we do NOT
reimplement orchestration or take a daemon dependency.

### Phases (detail in personas-plan.md)
1. **Core, no UI** — `Persona` type; `persona-store.ts` (fork template-store);
   `personaArgs()` layer in `pty.ts` + remote parity; IPC; scheduler pass-through;
   tests. Launchable from hand-written JSON.
2. **Spawn UX** — `+` picker lists personas; `Project.defaultPersonas`; one-click
   default; persona icon on tabs; `initialPrompt` write-on-spawn.
3. **Panel** — `PersonasPanel.tsx` (clone `SchedulerPanel`); project-shipped
   `<repo>/.cc-center/personas/` with source badges.
4. **Optional** — `--agents` subagents; `promoteTo: "zana-team:<template>"`.

### Open questions to revisit
- MCP server registry: how does a persona name an MCP server (`"mcpServers": ["gus"]`)
  and how is that name resolved to a config block in the launcher-owned `.mcp.json`?
  Needs a small registry — design not yet done.
- `initialPrompt` delivery for interactive vs. scheduled (non-interactive) sessions:
  pty-write `prompt + \r` vs. scheduler's positional-argv path. Pick per context.
- Builtin starter personas: which ship in-box? (Reviewer, Architect proposed.)
- Should `defaultPersonas` supersede or coexist with the existing `defaultAgents`
  field on `Project`?

### Entry points when resuming
- Launch assembly + precedence: `src/main/pty.ts` (`resolveLaunch`,
  `projectSettingsArgs`, `mergeAllowedTools`, `buildRemoteCmd`).
- Loader to fork: `src/main/template-store.ts`.
- Types: `src/shared/types.ts` (`LaunchProfileId`, `ProjectSettings`,
  `ScheduleTemplate`, `Project.defaultAgents`).
- MCP injection: `src/main/mcp-config.ts`.
- Spawn UI: `src/renderer/components/{TabBar,Workspace}.tsx`, `util/profileIcon.tsx`.
