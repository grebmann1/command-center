# Launchable Personas — Implementation Plan & Status

Spawn named, reusable Claude Code personalities (Reviewer, Architect, Bug-hunter…)
into terminal tabs, per project — riding the two rails that already exist.

> **Status (2026-06-13):** Phases 1–2 are built and tested (26 persona tests
> pass). The PersonasPanel renders (a grid-layout bug that hid it was fixed in
> `f3a7de4`). Phase 3 is partial, Phase 4 unstarted, and a few plan items were
> silently dropped. See the **Status legend** and per-item checkboxes below.

**Status legend:** ✅ done · 🟡 partial · ❌ not started · ⏸️ deferred (optional)

---

## Design

A **Persona** is a manifest that composes native `claude` CLI flags. It is **not** a
new launch mechanism — it slots in as one more layer in the precedence chain
`pty.ts` already runs:

```
resolveLaunch(baseProfile)        base command + args
  → AppConfig globals             --model, --permission-mode
  → PERSONA LAYER  (NEW)          --append-system-prompt, --model, --permission-mode,
                                  --allowedTools, --disallowedTools, --add-dir,
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

Reflects the **actual** `Persona` interface in `src/shared/types.ts` (the
original plan listed `subagents` and `scope.projectTags`, which were never
added — see *Dropped from the plan* below).

```jsonc
{
  "id": "reviewer",
  "name": "Code Reviewer",
  "icon": "ShieldCheck",                  // lucide name; fallback if unknown
  "description": "Terse senior reviewer",
  "baseProfile": "claude",                // 'claude' | 'claude-resume' | 'claude-yolo' | 'shell'
  "model": "opus",                        // optional → --model
  "permissionMode": "plan",               // optional → --permission-mode (ignored for yolo)
  "appendSystemPrompt": "You are a senior reviewer…",  // → --append-system-prompt
  "allowedTools": ["Read", "Grep"],       // → --allowedTools (merged/deduped)
  "deniedTools": [],                       // → --disallowedTools
  "addDirs": [],                           // → --add-dir
  "mcpServers": ["gus"],                  // optional; names resolved against MCP_SERVER_REGISTRY
  "initialPrompt": "Review the current diff."  // written to pty after spawn
}
```

A persona maps **only** to flags `claude` already accepts. No bespoke runtime.

---

## Phase 1 — Core resolution (no UI) — ✅ COMPLETE
Goal: launch a persona from a hand-written JSON via scheduler / default chip.

- ✅ `src/shared/types.ts`: `Persona` interface; `personaId?` on `TerminalSession`,
  `CreateTerminalRequest`, `ScheduledTask`/inputs. `cc.personas` API surface
  (list/onChanged/revealDir).
- ✅ `src/main/persona-store.ts` (forked `template-store.ts`): builtin catalogue +
  user dir + project dir, precedence-merge by `id`, fs-watch → `onChanged`.
  Builtins shipped: **Code Reviewer**, **Architect**.
- ✅ `src/main/pty.ts`:
  - ✅ `create()` accepts `persona?: Persona`.
  - ✅ `personaArgs(persona, baseProfile)`, inserted after AppConfig globals,
    before `projectSettingsArgs`.
  - ✅ `effectiveProfile = persona.baseProfile ?? opts.profile`.
  - ✅ `buildRemoteCmd` extended with the persona layer (remote parity, minus MCP).
  - ✅ After spawn, `persona.initialPrompt` written to the pty (claude-family only).
  - ✅ Extra MCP servers: `mcp-config.ts` merges persona-named servers.
    🟡 **Caveat: `MCP_SERVER_REGISTRY` is empty** — the mechanism works but no
    server names resolve yet, so `mcpServers: [...]` is currently a no-op.
- ✅ `src/main/index.ts` + `preload`: `personas:*` IPC; resolves persona by id at
  create time and passes the resolved `Persona` into `ptys.create`.
- ✅ `src/main/scheduler.ts`: `resolvePersona` resolver; a task's `personaId` is
  resolved + passed through, prompt delivered as positional argv.
- ✅ Tests: `persona-store.test.ts` (merge/precedence) + `pty-persona-args.test.ts`
  (layer order + `--allowedTools` dedup). **26 tests pass.**

## Phase 2 — Spawn UX — ✅ MOSTLY COMPLETE
Goal: the spawn moment. "+" offers personas; one-click default.

- ✅ `src/shared/types.ts`: `Project.defaultPersonas?: string[]`.
- ✅ `src/renderer/store.ts`: `createTerminal` opts gain `personaId`; `usePersonas`
  store slice fed by `cc.personas.list` + `onChanged`.
- 🟡 **The "+" picker lists personas — but only in the `LaunchPanel` modal.**
  - ✅ `LaunchPanel.tsx` lists builtins **and** personas (project-filtered) with a
    selectable persona, and launches with `personaId`.
  - ❌ **The quick "+" one-click default is NOT wired.** Plan §86–97: a plain
    click on "+" should spawn the project's `defaultPersonas[0]`; modifier/
    right-click opens the picker. The focus-view new-tab menu
    (`FOCUS_NEW_PROFILES` in `ListPane.tsx`) still offers only claude/yolo/shell
    — no personas. `Project.defaultPersonas` is read by nothing.
- ✅ `src/renderer/util/profileIcon.tsx`: `personaIcon(persona)` with lucide
  fallback.
- ✅ `src/renderer/components/TabBar.tsx`: tab chip shows the persona icon/label
  when `session.personaId` is set (falls back to profile icon; falls back again
  if the persona was deleted since launch).

## Phase 3 — Management panel + project-shipped personas — 🟡 PARTIAL
- 🟡 `src/renderer/components/PersonasPanel.tsx` (cloned `SkillsPanel`):
  - ✅ Lists / groups by source (All / Builtin / User / Project), search,
    "Reveal personas dir", source badge per row.
  - ✅ Renders in the full content area (grid-column span fixed in `f3a7de4`).
  - ❌ **Per-project "default persona" toggles** — not built. (`defaultPersonas`
    exists in the type but no UI sets it.)
  - ❌ **"New from template"** button — not built; the panel is read-only
    (authoring is hand-editing JSON via "Reveal").
- ✅ `Sidebar.tsx`: Personas nav entry (icon `Drama`).
- ❌ **`CommandPalette` wiring** — plan calls for it; there are **zero** persona
  references under `src/renderer/components/palette/`. No "launch as persona" or
  "open Personas" palette entries.
- ✅ Project-shipped discovery (`<repo>/.cc-center/personas/`) works (Phase 1
  store) and the "project" source badge is shown.

## Phase 4 — Optional escalation — ⏸️ NOT STARTED (optional)
- ❌ `subagents` → `--agents` wiring. **Note:** `subagents` is not even a field on
  the `Persona` type — would need a schema add first.
- ❌ `persona.promoteTo: "zana-team:<template>"` hand-off to the Zana
  `team`/`council` skills.

---

## Dropped from the plan (in the original spec, never implemented)
- ❌ **`scope.projectTags`** — the original schema had
  `"scope": { "projectTags": ["*"] }`. Not on the `Persona` type. Project
  filtering today is by `source.projectId` only (a project-scoped persona shows
  for its own project; builtin/user personas show everywhere). Tag-based scoping
  doesn't exist.
- ❌ **`subagents`** — see Phase 4; spec'd but never added to the type.
- 🟡 **`mcpServers` registry** — wired end-to-end but `MCP_SERVER_REGISTRY` ships
  empty, so no server name resolves yet.

## Remaining work — suggested order
1. **Quick "+" default** (Phase 2 gap): read `Project.defaultPersonas[0]` for the
   one-click launch; add personas to the focus-view new-tab menu. *This is what
   makes personas usable without opening the modal every time.*
2. **CommandPalette entries** (Phase 3): "Open Personas" + "Launch <persona>".
3. **Per-project default toggle** in PersonasPanel (Phase 3): the UI to set
   `defaultPersonas`, which (1) then consumes.
4. **Populate `MCP_SERVER_REGISTRY`** with at least one real server (e.g. gus) so
   `mcpServers` is more than a no-op.
5. ⏸️ Phase 4 (subagents, Zana promote) — defer until a concrete need.

## Risk / scope guards
- **Sit-beside keeps blast radius small**: the 4 builtins and every existing
  `LaunchProfileId` site keep working untouched; persona is purely additive.
- **No new runtime**: personas compile to existing `claude` flags only.
- **Precedence is explicit and tested**: persona sits below ProjectSettings and
  extraArgs so a project/tab can always override a persona.
- **Remote parity**: `buildRemoteCmd` gets the same persona layer (minus MCP).
- **`initialPrompt` safety**: claude-family only; never written for `shell`.
  Scheduled/non-interactive runs use positional-arg delivery.

## Touched files (as built)
New: `src/main/persona-store.ts`, `src/main/__tests__/persona-store.test.ts`,
`src/main/__tests__/pty-persona-args.test.ts`,
`src/renderer/components/PersonasPanel.tsx`, builtin personas (in `persona-store.ts`).
Modified: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/main/pty.ts`, `src/main/mcp-config.ts`,
`src/main/scheduler.ts`, `src/renderer/store.ts`,
`src/renderer/components/{TabBar,LaunchPanel,Sidebar}.tsx`,
`src/renderer/util/profileIcon.tsx`, `src/renderer/styles/global.css`.
Not yet touched (plan expected): `src/renderer/components/Workspace.tsx` quick-"+"
default, `src/renderer/components/CommandPalette.tsx` / `palette/*`.
