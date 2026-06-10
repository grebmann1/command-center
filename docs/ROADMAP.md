# Roadmap

Parked ideas and planned work, newest first. Each entry is self-contained so it
can be picked up cold. `Status` ∈ {parked, planned, in-progress, shipped, dropped}.

---

## Live Agent Status Awareness

**Status:** planned (designed 2026-06-10 via Zana arch council)
**Full plan:** [`docs/live-agent-status-plan.md`](./live-agent-status-plan.md)
**Tickets:** [`docs/live-agent-status-tickets.md`](./live-agent-status-tickets.md)
**Inspiration:** `herdr` (cloned at `~/Documents/claude-workspace/herdr`)

### One-line
Live per-tab agent state (🔴 blocked / 🟡 working / 🔵 done-unseen / 🟢 idle),
rolled up to project/sidebar, with tab-aware notifications.

### Council verdict
APPROVE WITH CONDITIONS (security-reviewer + performance-engineer + researcher).
20 binding conditions; all traced to tickets LAS-00…LAS-14.

### Key insight (don't re-derive)
Detection is **screen-scan-PRIMARY, hooks ADVISORY** — NOT hook-primary. herdr
removed Claude lifecycle-state hooks in v5 (`herdr/src/integration/mod.rs:1374`)
because `SubagentStop` fires after turn-end and revives idle panes; screen-scan
(`herdr/.../claude.toml`) is its Claude authority. `blocked` is screen-only
(`Notification` hook is unreliable for permission prompts). Hooks only accelerate
`idle→working` and stamp `done`.

### Where we beat herdr (the enhancement — LAS-07b + idle-veto)
Because we *launch* Claude (herdr only watches the screen) we have two signals it
gave up on: (1) **OSC-title spinner parsed from the raw PTY byte stream** in
`pty.ts` — near-zero-cost `working`/`done`, and it works for **hidden/unfocused
tabs** (herdr needs the rendered title); (2) **hook idle-veto** — a `PreToolUse`
with no closing `Stop`/`PostToolUse` means a tool is in flight, so we *suppress* a
false `idle` during a quiet-screen moment. herdr can only *delay* a false idle;
we *know* it's false. "idle" = `❯` prompt box + no question + title not a spinner
+ no tool in flight, held ~300 ms.

### Three non-negotiables
1. **Don't re-key `/hook/stop/...`** — scheduler auto-close depends on it
   (`scheduler.ts:664`). Add lifecycle as a new route that *also* drives it.
2. **One composed `--settings`** (`composeSettings()`) — live-status + scheduler +
   parked Personas all want it; Claude takes a single flag (last wins).
3. **Status in a dedicated store, not on `TerminalSession`** — else every tick
   render-storms `terminals` consumers; rollup precomputed, read as a primitive
   (zustand infinite-loop trap, see UI-state memory).

### Entry points
- Hooks/spawn: `src/main/pty.ts` (`buildStopHookSettings` :563, `CC_HOOK_URL` :206).
- Callback route: `src/main/mcp-server.ts` (:126-194).
- Scheduler done path: `src/main/scheduler.ts` (`onAgentFinished` :664).
- Store: `src/renderer/store.ts` (`onUpdated` :750). Detector ref: `herdr/src/detect/`.

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
