---
name: cc-center
description: Author schedules and schedule templates for Claude Code Terminal Center by writing JSON files into .cc-center. Use when the user asks to create, schedule, or automate a recurring agent/terminal task, or to make a reusable schedule template.
---

# cc-center — author schedules & templates

Claude Code Terminal Center (the desktop app this session is likely running
inside) runs **scheduled terminal sessions** on a recurring interval and offers
**reusable templates** that pre-fill the "new schedule" form. Both are plain
JSON files on disk. This skill teaches you their exact formats so you can
author valid files the app will pick up — schedules go live automatically (the
app watches the directories), templates appear in the picker.

You are **writing JSON files**, not calling an API. Write them with the normal
file tools.

> Pushing a message to the user's inbox is a *different* feature — that's the
> `cc-inbox` MCP tool (`inbox_push`), not this skill. Use this skill only for
> creating/editing **schedules** and **templates**.

---

## Where files go

| Kind | Scope | Directory | One file per |
| --- | --- | --- | --- |
| Schedule | Global (any project) | `~/.cc-center/schedules/` | schedule, named `<id>.json` |
| Schedule | Per-project | `<project-root>/.cc-center/schedules/` | schedule, named `<id>.json` |
| Template | Global | `~/.cc-center/templates/` | template, named `<anything>.json` |
| Template | Per-project | `<project-root>/.cc-center/templates/` | template |

- **`<id>` is the `id` field**, and the filename must match it for schedules
  (e.g. a schedule with `"id": "abc123"` lives at `…/schedules/abc123.json`).
- **Per-project** files live inside the repo, so they're git-trackable and
  travel with a clone. **Global** files are user-level in `$HOME`.
- The app **watches** these directories: a newly written schedule arms itself
  without an app restart; a new template appears in the picker live.
- Create the directory if it doesn't exist (`mkdir -p`).

### Picking scope

- If the task is specific to one repo → write to that repo's
  `.cc-center/schedules/`. Prefer this; it keeps automation with the code.
- If it's cross-cutting / user-level → write to `~/.cc-center/schedules/`.
- A schedule **must** name a real `projectId` regardless of where the file
  lives (see below) — scope only decides which directory holds the file.

---

## You need a real `projectId`

Every schedule spawns a terminal **inside a project**. `projectId` is a foreign
key into the app's project registry at `~/.cc-center/projects.json`. A schedule
pointing at an unknown project is loaded but **skips every fire** (logged as
`skipped: project … not found`).

**Before writing a schedule, resolve the projectId:**

1. Read `~/.cc-center/projects.json`. It's an array of
   `{ id, name, path, … }`. Match the project the user means by `name` or
   `path` and use its `id`.
2. If you're writing a *per-project* schedule, the enclosing repo's project is
   the one whose `path` is (or contains) the current working directory — match
   on `path`.
3. If no project matches, **stop and tell the user** they must add the project
   to the app first (the app's sidebar "+", or it's auto-added when they open
   a folder). Don't invent an id.

---

## Schedule JSON format

A complete, valid schedule. Fields marked **required** must be present and
well-formed or the file is silently skipped at load.

```json
{
  "id": "qa-hourly",
  "name": "Hourly QA sweep",
  "description": "Runs the test suite and type-checker every hour.",
  "enabled": true,
  "projectId": "PASTE-A-REAL-PROJECT-ID-FROM-projects.json",
  "profile": "claude-yolo",
  "extraArgs": [],
  "prompt": "Run the test suite and the type-checker. If anything fails, summarize the failure and the suspected root cause. If everything passes, reply 'all green'.",
  "schedule": { "every": "1h" },
  "overlap": "skip",
  "history": { "retain": 10 },
  "status": { "runCount": 0, "runs": [] },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "inboxLevel": "quiet",
  "autoCloseOnFinish": false
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string, unique across **all** schedules. Filename must equal `<id>.json`. Use a short kebab-case slug or a UUID. |
| `name` | ✅ | Non-empty display string. |
| `description` | — | Free text. |
| `enabled` | ✅ | Boolean. `false` = present but won't fire. |
| `projectId` | ✅ | Must match an `id` in `projects.json` (see above). |
| `profile` | ✅ | One of `"shell"`, `"claude"`, `"claude-resume"`, `"claude-yolo"`. |
| `extraArgs` | — | Array of strings, passed verbatim to the launched CLI. `[]` if none. |
| `prompt` | — | Initial prompt typed into the session. **Ignored for `shell`.** For claude profiles it's passed as the positional prompt arg. Multi-line is fine. |
| `schedule.every` | ✅ | Interval string — see syntax below. |
| `overlap` | ✅ | Must be `"skip"` (only mode supported; a fire is skipped if the previous run's session is still alive). |
| `history.retain` | ✅ | Number; how many past runs to keep in `status.runs`. Use `10`. |
| `status` | ✅ | For a brand-new schedule use exactly `{ "runCount": 0, "runs": [] }`. The app fills in `lastRunAt`, `nextRunAt`, etc. — **don't fabricate run history.** |
| `createdAt` | ✅ | ISO-8601 string. |
| `updatedAt` | ✅ | ISO-8601 string. |
| `inboxLevel` | — | One of `"silent"`, `"quiet"`, `"loud"`. Governs **all** inbox entries from a run — the run-completion summary AND any `inbox_push` the agent makes. `silent` = nothing recorded; `quiet` (default) = recorded in the collapsed "Scheduled" group, no unread badge; `loud` = surfaced inline and counted in the unread badge. Replaces the legacy boolean `notifyInbox` (`true`→`loud`, `false`→`quiet`), which is still read for backward compatibility. |
| `autoCloseOnFinish` | — | Boolean, **claude profiles only.** When `true`, a Stop hook closes the session once Claude finishes responding. Leave `false` if the agent should stay alive to receive a reply (these two are mutually exclusive in intent). |

### Profiles

- `shell` — plain shell session (`prompt` ignored). No "finished" signal, so
  `autoCloseOnFinish` does nothing.
- `claude` — interactive Claude Code with normal permission prompts.
- `claude-resume` — resumes the project's most recent Claude session.
- `claude-yolo` — Claude Code with `--dangerously-skip-permissions`. Use for
  unattended jobs that must not block on a permission prompt (QA, audits).
  **Only suggest this when the task is genuinely safe to run unattended.**

### Interval syntax (`schedule.every`)

`<number><unit>` segments, concatenated. Units: `ms`, `s`, `m`, `h`, `d`.

- Examples: `"30m"`, `"1h"`, `"6h"`, `"24h"`, `"1h30m"`, `"300000ms"`.
- **Minimum 60 seconds** — anything shorter is clamped up to 60s.
- **Maximum 24 days** — anything longer is clamped down.
- Garbage (e.g. `"hourly"`, `"1 hour"`, `"weekly"`) is rejected and the whole
  file is skipped. Always emit a valid segment string.

---

## Template JSON format

Templates **don't run.** They pre-fill the "new schedule" form so the user can
create a schedule with one click. A template needs no `projectId` (the user
picks the project when they instantiate it) — which makes templates the right
tool for **shareable starters**.

```json
{
  "id": "dependency-audit",
  "name": "Dependency audit",
  "description": "Weekly check for vulnerable or drifted dependencies.",
  "category": "Maintenance",
  "icon": "Package",
  "defaults": {
    "profile": "claude-yolo",
    "every": "24h",
    "name": "Dependency audit",
    "prompt": "Audit dependencies for known vulnerabilities and major version drift. Summarize findings and propose safe upgrades.",
    "extraArgs": []
  }
}
```

### Field reference

| Field | Required | Rules |
| --- | --- | --- |
| `id` | ✅ | Non-empty string. A template whose `id` matches a built-in **shadows** that built-in. |
| `name` | ✅ | Non-empty display string. |
| `description` | — | Free text shown in the picker. |
| `category` | — | Free-form grouping label (e.g. `"QA"`, `"Maintenance"`, `"Reports"`, `"Triage"`, `"Slack"`). |
| `icon` | — | A [lucide](https://lucide.dev) icon name (e.g. `"ShieldCheck"`, `"Package"`, `"Sun"`, `"Activity"`, `"Inbox"`, `"Clock"`, `"Sparkles"`). Unknown names fall back to a generic icon. |
| `defaults` | ✅ | Object. Must include a valid `profile` and a valid `every` (same rules as schedules). |
| `defaults.profile` | ✅ | Same profile enum as schedules. |
| `defaults.every` | ✅ | Same interval syntax as schedules. |
| `defaults.prompt` | — | Default prompt. |
| `defaults.extraArgs` | — | Default extra args. |
| `defaults.name` | — | Default schedule name when instantiated. |
| `defaults.description` | — | Default schedule description. |

Template filenames are free-form (`my-template.json`); only schedules require
the filename to match the `id`.

---

## Workflow

When the user asks to schedule/automate something:

1. **Decide schedule vs. template.** "Run X every hour in this repo" → a
   **schedule**. "Make a reusable preset for X" / "add a template" → a
   **template**.
2. **For a schedule, resolve `projectId`** from `~/.cc-center/projects.json`
   (see above). Bail out and ask if no project matches — never guess an id.
3. **Choose scope** (per-project repo dir vs. global) and ensure the directory
   exists.
4. **Write the JSON.** For schedules: filename = `<id>.json`,
   `status` = `{ "runCount": 0, "runs": [] }`, timestamps = now (ISO-8601),
   no fabricated run history.
5. **Pick a sensible interval and profile.** Default to `claude` unless the
   job is safe to run fully unattended (then `claude-yolo`). Default `every`
   to something conservative (`1h`+) unless the user specifies.
6. **Confirm what you wrote** — path, interval, profile, project — so the user
   can verify in the app. The schedule arms itself automatically; a template
   appears in the "From template" picker.

### Editing / disabling

- To **disable** a schedule without deleting it: set `"enabled": false` and
  bump `updatedAt`.
- To **delete**: remove the `<id>.json` file.
- To **change cadence**: edit `schedule.every` and bump `updatedAt`. Leave
  `status` untouched — the app recomputes the next fire on reload.

---

## Reporting what a run did (`schedule_report`)

When **you** are the agent running *inside* a scheduled session (not authoring
the schedule — actually executing one), leave a summary of what the run did so
the user can see the outcome in the scheduler's run history without re-reading
your terminal output.

Call the MCP tool **`schedule_report`** (server: `cc-inbox`) at the **end** of
the run:

```
schedule_report({
  summary: "Ran the test suite (142 passed). Bumped lodash 4.17.20 → 4.17.21 to clear a prototype-pollution advisory; lockfile updated. No other drift.",
  status: "success"   // optional: 'success' | 'partial' | 'failure'
})
```

- `summary` is short **markdown** — what you checked, what you found or changed,
  and whether anything needs the user. It is a **report, not a log**: summarize,
  don't paste raw output.
- `status` is your own assessment, independent of the process exit code.
- The summary is attached to **this run** in the scheduler history (the app
  routes it by the session identity baked into the MCP URL — you can't report
  against another run). A 📄 affordance appears on the run row; clicking it
  shows your markdown.

**`schedule_report` vs `inbox_push`:**

| | `schedule_report` | `inbox_push` |
| --- | --- | --- |
| Purpose | Per-run record of what happened | Proactively flag something the user should act on |
| Cadence | **Every** scheduled run | Only when you need attention |
| Surfaces in | Scheduler run history | The inbox |

File a report on every scheduled run; push to the inbox only when warranted.

**Timing — important.** If the schedule has `autoCloseOnFinish: true`, the
session is **killed the moment you stop responding**. You MUST call
`schedule_report` **before** ending your turn — a report you intend to send
"after" will never go out. (You'll know this guidance applies because it's
injected into your system prompt for scheduled runs.)

---

## Gotchas

- **Filename must match `id` for schedules.** A mismatch means the app's
  delete/locate-by-id can't find the file.
- **Don't fabricate `status`.** A new schedule starts with
  `{ "runCount": 0, "runs": [] }`. Inventing `lastRunAt`/`runs` desyncs the UI.
- **`projectId` is mandatory and must exist.** This is the #1 reason a
  schedule looks present but never fires.
- **Intervals are strict.** `"every": "1 hour"` is invalid; use `"1h"`.
- **`shell` ignores `prompt`** and has no auto-close.
- Files with invalid JSON or a bad `profile`/`every` are **silently skipped**
  at load — if a schedule doesn't appear, re-check those first.
