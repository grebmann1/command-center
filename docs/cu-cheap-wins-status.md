# Claude-Unleashed Cheap Wins — Status & Next Steps

> Living status doc for the 4 cheap wins from
> [`cu-cheap-wins-plan.md`](./cu-cheap-wins-plan.md) (the plan) and
> [`claude-unleashed-comparison.md`](./claude-unleashed-comparison.md) (the why).
> Last updated 2026-06-13. Branch: `release/0.5.0`.

## TL;DR

All 4 wins have shipped their core scope. What remains is a set of clearly-scoped,
**optional** follow-ups (live-action CLI, Pub/Sub, live Slack bot, persona escalation).
The architecture rule held throughout: **non-core features live in extensions/SDK; the
only core change was a minimal SDK enabler** (`launchSession({personaId})` + `listPersonas()`).

| Win | Status | Shipped in | Deferred follow-up |
|---|---|---|---|
| 1. Personas | ✅ Done (Phases 1–3) | `bfa047a`, `5b47a08`, glue in `b37c7eb` | Phase 4: `subagents`→`--agents`, Zana-team escalation |
| 2. `cc` CLI | ◑ Read/author tier only | `bfa047a` | Live-action tier (`cc run --persona`, `schedule run-now`, `tail`) |
| 3. GUS-CDC triggers | ✅ Done (Stage A poll) | `51a5753` | Stage B: real Pub/Sub subscription |
| 4. Slack | ✅ Done (Tier A + B) | `51a5753` | Tier C: live socket-mode bot → bridge to CU |

---

## Win 1 — Personas (DONE)

Launch named, reusable `claude` flag bundles (Reviewer, Architect…) as tabs.

**Where it lives:**
- Types/contract: `src/shared/types.ts` (`Persona`, `personaId` on session/request/scheduler), `src/shared/ipc.ts` (`personas:*`).
- Backend: `src/main/persona-store.ts` (builtin ⊕ user ⊕ project, fs-watch), pty persona layer in `src/main/pty.ts` (`personaArgs_build`, inserted after globals/MCP, before projectSettings), `src/main/mcp-config.ts` (persona MCP servers), `src/main/index.ts` (store lifecycle + IPC + `terminals.create` resolution), `src/main/scheduler.ts` (`resolvePersona` at fire time).
- UI: `src/renderer/components/LaunchPanel.tsx` (persona picker in "+"), `src/renderer/components/TabBar.tsx` (persona chip), `src/renderer/util/profileIcon.tsx` (`personaIcon`), `src/renderer/components/PersonasPanel.tsx` (management panel), Sidebar/App nav (`personas`), `src/renderer/store.ts` (`usePersonas` slice + `createTerminal` personaId).
- Builtins: `builtin:reviewer`, `builtin:architect` (in `persona-store.ts`).
- Tests: `src/main/__tests__/persona-store.test.ts`, `pty-persona-args.test.ts`.

**Try it:** drop a JSON in `~/.cc-center/personas/`, open "+", pick the persona. Manage via the Personas sidebar tab.

**Next (Phase 4, optional):** wire `persona.subagents` → `--agents`; add `persona.promoteTo: "zana-team:<template>"` hand-off. See `docs/personas-plan.md` Phase 4.

---

## Win 2 — `cc` CLI (READ/AUTHOR TIER ONLY)

A no-daemon CLI over `~/.cc-center/*.json`. Package: `packages/cli` (`@cctc/cli`).

**Done:** `cc projects ls`, `cc personas ls`, `cc schedule ls`, `cc inbox ls/show`, `--json` on all, `--data-dir`/`CC_CENTER_DIR`. Pure `runCli()` (returns a result object, golden-file tested — `packages/cli/src/__tests__/run-cli.test.ts`, 22 tests).

**Run:** `node packages/cli/dist/bin/cc.js projects ls` (after `cd packages/cli && npm run build`).

**Next (live-action tier — the deferred half):**
- `cc run <project> --persona <id> [--prompt …]` — launch a session *now*.
- `cc schedule run-now <id>`, `cc inbox push`.
- **Blocker/decision:** live actions need a running app + a localhost control endpoint. Plan (in `cu-cheap-wins-plan.md` Win 2): the app writes its control URL to `~/.cc-center/control.json` on boot; the CLI POSTs an intent that maps to `ptys.create()`. Lean: a small `src/main/control-server.ts` separate from `mcp-server.ts`. **This is the one place the CLI brushes the daemon line — keep it cockpit-first (app must be open).**

---

## Win 3 — GUS-CDC triggers (DONE — Stage A poll)

Launch a persona-session when a GUS work item changes. **Entirely in the GUS extension.**

**Where it lives** (`plugins/gus` + `extensions/gus`, NOT core):
- Watcher + capabilities: `plugins/gus/main/gus-main.ts` — `cdcArm`/`poll`, pure `detectCdcMatches`, `parsePollEvery`, `substitutePrompt`. Timers cleaned in `teardown()`.
- Trigger UI: `plugins/gus/renderer/CdcPanel.tsx` (a "CDC" tab in `GusPanel.tsx`), with an `onExit` back-control.
- Types: `plugins/gus/shared/types.ts` (`CdcTrigger`, `CdcLastSeen`, `CdcPendingMatch`).
- Manifest: `extensions/gus/extension.json` gained `session:launch` + `inbox:push`.
- Tests: `plugins/gus/main/gus-cdc.test.ts` (15 tests).

**Key design:** main detects+queues matches; the **renderer** launches via `host.launchSession({personaId})` (launchSession is renderer-only). New triggers default disabled + `requireConfirm` + require ≥1 watched field (cost boundary). Prompt tokens resolve against the **raw SF row** first (`{{Status__c}}`), mapped-item keys as fallback.

**Next (Stage B, optional):** replace the poll with a real Salesforce Pub/Sub subscription (lower latency, no poll cost; needs a long-lived gRPC client + replay-id durability). Defer until poll latency is a problem.

---

## Win 4 — Slack (DONE — Tier A + B)

**A new disk extension** mirroring GUS (`plugins/slack` + `extensions/slack`).

**Where it lives:**
- Main: `plugins/slack/main/slack-main.ts` — `notify`/`testConnection` capabilities via brokered `ctx.fetch`. Tests: `slack-main.test.ts` (6).
- UI: `plugins/slack/renderer/SlackPanel.tsx` — webhook/token config (stored in `ctx.storage`, **not** core), event toggles, debounce, test button.
- Manifest: `extensions/slack/extension.json` — `permissions: ["net","storage","inbox:push"]`, `egressAllowlist: ["slack.com","hooks.slack.com","api.slack.com"]`.

**Tiers:** A = config/guidance surface for the two existing MCP-driven Slack scheduler agents (`slack-mention-triage`, `slack-agent-runner` in `src/main/template-store.ts`). B = automatic outbound lifecycle notifications: renderer subscribes to `session:agentStatus`/`session:exit`, calls main `notify` → `ctx.fetch` POST. Outbound only, no daemon.

**Next (Tier C, deferred):** a live socket-mode bot (`run <prompt>` from Slack launches a session; thread-per-session; approve buttons). This genuinely wants a persistent listener → the recommendation is **bridge to Claude Unleashed** (it already has a Slack bot), not build a daemon here.

---

## Architecture rule (must hold for future work)

Non-core features go in **extensions** (`plugins/<id>` + `extensions/<id>`) using only the
SDK (`@cctc/extension-sdk`): `ctx.exec`/`ctx.fetch`/`ctx.storage`/`teardown` on main,
`host.launchSession`/`listPersonas`/`on`/`pushInbox` on renderer. The ONLY sanctioned core
touch this round was the SDK enabler: `launchSession({personaId})` + `listPersonas()` +
`PersonaInfo` in `packages/extension-sdk/src/renderer.ts`, implemented in
`src/renderer/modules/host.ts`. Persona flag resolution stays single-sourced in `pty.ts`.

## ⚠️ Working note: parallel sessions on this branch

A second Claude session frequently edits this repo's working tree and commits to
`release/0.5.0` at the same time. When committing: identify your own files, stage them
**explicitly by path** (never `git add -A`), and `git diff --cached | grep` for the other
feature's keywords to confirm nothing foreign slipped in. HEAD moves mid-task.

## Commits (this effort)

- `bfa047a` — persona launch glue + `cc` CLI read tier
- `5b47a08` — persona launchable UI (picker, chip, panel)
- `b37c7eb` — (parallel session) swept in persona renderer wiring (store/Workspace/ListPane)
- `51a5753` — GUS-CDC triggers + Slack extension + SDK enabler
