# Launchable Personas — Implementation Plan

Spawn named, reusable Claude Code personalities (Reviewer, Architect, Bug-hunter…)
into terminal tabs, per project — riding the two rails that already exist.

## Design

A **Persona** is a manifest that composes native `claude` CLI flags. It is **not** a
new launch mechanism — it slots in as one more layer in the precedence chain
`pty.ts` already runs:

```
resolveLaunch(baseProfile)        base command + args
  → AppConfig globals             --model, --permission-mode
  → PERSONA LAYER  (NEW)          --append-system-prompt, --model, --permission-mode,
                                  --allowedTools, --disallowedTools, --add-dir, --agents,
                                  + extra MCP servers merged into --mcp-config
  → ProjectSettings flags         (unchanged; still wins over persona)
  → extraArgs                     per-tab (still highest)
  + MCP injection                 cc-inbox (unchanged)
```

Decision: **sit-beside.** `LaunchProfileId` stays a 4-value union. `TerminalSession`,
`CreateTerminalRequest`, scheduler, etc. gain an optional `personaId`. A persona
declares a `baseProfile` (which of the 4 it builds on, default `claude`).

Discovery + merge + hot-reload is **forked verbatim** from `template-store.ts`
(`ScheduleTemplate`): builtin ⊕ `~/.cc-center/personas/*.json` ⊕
`<project>/.cc-center/personas/*.json`, precedence-merged, with an
`onChanged` broadcast. The `initialPrompt` write-on-spawn reuses the scheduler's
prompt-delivery pattern.

## Persona schema (`~/.cc-center/personas/<id>.json`)

```jsonc
{
  "id": "reviewer",
  "name": "Code Reviewer",
  "icon": "shield-check",                 // lucide name; fallback if unknown
  "description": "Terse senior reviewer",
  "baseProfile": "claude",                // 'claude' | 'claude-resume' | 'claude-yolo' | 'shell'
  "model": "opus",                        // optional → --model
  "permissionMode": "plan",               // optional → --permission-mode (ignored for yolo)
  "appendSystemPrompt": "You are a senior reviewer…",  // → --append-system-prompt
  "allowedTools": ["Read", "Grep"],       // → --allowedTools (merged/deduped)
  "deniedTools": [],                       // → --disallowedTools
  "addDirs": [],                           // → --add-dir
  "mcpServers": ["gus"],                  // optional; names resolved against a small registry
  "subagents": ["security"],              // optional → --agents (phase 4)
  "initialPrompt": "Review the current diff.",  // written to pty after spawn
  "scope": { "projectTags": ["*"] }       // which projects show this persona
}
```

A persona maps **only** to flags `claude` already accepts. No bespoke runtime.

---

## Phase 1 — Core resolution (no UI)
Goal: launch a persona from a hand-written JSON via scheduler / default chip.

- `src/shared/types.ts`: add `Persona` interface; add `personaId?: string` to
  `TerminalSession`, `CreateTerminalRequest`, `ScheduledTask`/inputs. Extend the
  `cc.personas` API surface block (list/onChanged/revealDir) mirroring scheduler templates.
- `src/main/persona-store.ts` (fork `template-store.ts`): builtin catalogue +
  user dir + project dir, precedence-merge by `id`, `chokidar`/fs-watch →
  `onChanged`. Builtin personas: a couple of starters (Reviewer, Architect).
- `src/main/pty.ts`:
  - `create()` accepts `persona?: Persona`.
  - New `personaArgs(persona, baseProfile)` — same shape as `projectSettingsArgs`,
    inserted **after** AppConfig globals, **before** `projectSettingsArgs`.
  - Resolve `command/baseArgs` from `persona.baseProfile ?? opts.profile`.
  - Extend `buildRemoteCmd` with the persona layer too (remote parity, minus MCP).
  - After spawn, if `persona.initialPrompt`, write `prompt + "\r"` to the pty
    (guard: claude-family only; reuse scheduler's positional-arg path instead
    where the session is non-interactive — see scheduler note below).
  - Extra MCP servers: extend `mcp-config.ts` so the per-project `.mcp.json`
    can include persona-named servers (registry lookup) in addition to cc-inbox.
- `src/main/index.ts` + `preload`: register `personas:*` IPC, pass resolved
  `Persona` into `ptys.create`. Look up persona by id at create time.
- `src/main/scheduler.ts`: when a task carries `personaId`, resolve + pass it
  through (prompt still delivered as positional argv, as today).
- Tests: `persona-store.test.ts` (merge/precedence/scope), and a `pty` arg-assembly
  unit test asserting layer order + `--allowedTools` dedup with a persona present.

## Phase 2 — Spawn UX
Goal: the spawn moment. "+" offers personas; one-click default.

- `src/shared/types.ts`: `Project.defaultPersonas?: string[]` (parallels
  `defaultAgents`; first = one-click default).
- `src/renderer/store.ts`: `createTerminal` gains `personaId` in opts; add a
  `usePersonas` store slice fed by `cc.personas.list` + `onChanged` (clone of
  `useScheduleTemplates`).
- `src/renderer/components/TabBar.tsx` + `Workspace.tsx`: the "+" picker lists
  builtins **and** personas (grouped, with icon + source badge). Plain click on
  "+" spawns the project's default persona/profile; modifier/right-click opens
  the picker (logic already there for `defaultProfile`).
- `src/renderer/util/profileIcon.tsx`: add `personaIcon(persona)` resolving the
  lucide icon by name with the existing fallback.
- `src/renderer/components/TabBar.tsx`: tab chip shows persona icon/label when
  `session.personaId` is set (falls back to profile icon).

## Phase 3 — Management panel + project-shipped personas
- `src/renderer/components/PersonasPanel.tsx` (clone `SchedulerPanel`/`SkillsPanel`):
  list/group by source, "Reveal personas dir", per-project default toggles,
  "New from template". Wire into `Sidebar.tsx` + `CommandPalette.tsx`.
- Project-shipped discovery (`<repo>/.cc-center/personas/`) is already in the
  store from Phase 1; surface the source badge ("project") here so cloned-repo
  personas are obvious.

## Phase 4 — Optional escalation
- `subagents` → `--agents` wiring (once a single persona wants helpers).
- `persona.promoteTo: "zana-team:<template>"` — a menu action that hands the
  persona's context to the existing Zana `team`/`council` skills instead of
  reimplementing orchestration. Pure hand-off; no daemon dependency added.

---

## Risk / scope guards
- **Sit-beside keeps blast radius small**: the 4 builtins and every existing
  `LaunchProfileId` site keep working untouched; persona is purely additive.
- **No new runtime**: personas compile to existing `claude` flags only. If the
  CLI gains richer agent config later, we map to it, not around it.
- **Precedence is explicit and tested**: persona sits below ProjectSettings and
  extraArgs so a project/tab can always override a persona.
- **Remote parity**: `buildRemoteCmd` gets the same persona layer (minus MCP,
  matching today's remote limitation).
- **`initialPrompt` safety**: claude-family only; never written for `shell`
  (would execute as a command). For scheduled/non-interactive runs, reuse the
  scheduler's positional-arg delivery rather than pty-write.

## Touched files
New: `src/main/persona-store.ts`, `src/main/__tests__/persona-store.test.ts`,
`src/renderer/components/PersonasPanel.tsx`, builtin persona JSONs.
Modified: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/main/pty.ts`, `src/main/mcp-config.ts`,
`src/main/scheduler.ts`, `src/renderer/store.ts`,
`src/renderer/components/{TabBar,Workspace,Sidebar,CommandPalette}.tsx`,
`src/renderer/util/profileIcon.tsx`.
