# Claude Unleashed — CCTC disk extension

A **Fleet** board for [Claude Unleashed](https://git.soma.salesforce.com/cc-oms/claude-unleashed)
packaged as a **runtime disk extension**. It drives the local `claude-unleashed`
daemon entirely through the brokered, permission-gated `ctx.exec` capability —
no daemon socket access, no raw `child_process`. The same pipeline GUS dogfoods:
discovery → consent → per-extension `utilityProcess` isolation → brokered exec.

## What it does

A tabbed panel over the daemon's "vocabulary". A daemon **gate** (not-installed /
relaunch-needed / daemon-down, with a one-click **Start daemon**) wraps all tabs.

- **Fleet** — the live sessions from `cu sessions ls`, grouped by repo or status,
  with per-session turns/cost/profile and status-gated actions: **Pause**,
  **Resume**, **Unstick**, **Kill**, and a **Post-mortem** modal (`cu sessions
  post-mortem` + `cu sessions vitals`). A fleet rollup (`cu dashboard`), a
  **Launch session** form (`cu run`), and an opt-in **Live** 10s poll toggle
  (off by default; single-flight). navBadge = running-session count.
- **Profiles** — saved launch shapes (`cu profiles ls`): model, caps, permission
  mode. Read-only.
- **Agents** — behavior contracts (`cu agents ls`, scoped to the active repo) with
  their `allowedTools` boundary, plus agent-groups (`cu agent-groups ls`).
- **Workflows** — saved DAGs (`cu workflow ls`), each **Run**-able against the
  active project (`cu workflow run --repo …`), plus recent runs (`cu workflow
  runs`).
- **Schedules** — cron launches (`cu schedules ls`) with **enable / disable /
  run-now**, plus GUS-CDC subscriptions (`cu gus-cdc subscriptions ls`) shown as
  event-driven triggers.

All data commands are invoked with `--json`; `cu run` / `cu workflow run` are the
exceptions (they emit JSON by default and *reject* `--json`), so their stdout is
parsed directly.

## Binary

The exec allowlist is **`claude-unleashed` only**, deliberately NOT `cu`:
`/usr/bin/cu` is the unrelated UUCP serial-line tool, a real name collision.
When `claude-unleashed` isn't on PATH the broker's `ctx.exec` rejects and the
panel shows a clean "not installed" empty-state with a docs link.

## Build

```
npm run build      # build:renderer then build:main → dist/{renderer.js,main.js}
npm run package    # copy dist + extension.json into examples/extensions/cu/
                   # (committed artifact) and seed ~/.cc-center/extensions/cu/
npm run typecheck  # typechecks the entries + src
```

`npm run dev` at the repo root then discovers cu from
`~/.cc-center/extensions/cu` and prompts for consent to its one permission
(`exec`, scoped to `claude-unleashed`).

## React + lucide across a blob import

Identical to the gus extension (see its README for the full write-up). The host
reads `renderer.js` off disk as a string, wraps it in a `Blob`, and `import()`s
the `blob:` URL — which has **no import map**. So `react` and `react/jsx-runtime`
are aliased to in-bundle shims (`src/react-shim.ts`, `src/jsx-runtime-shim.ts`)
that delegate to the host's single React (supplied via `activate({ React })`
and `globalThis.__CCTC_HOST_REACT__` for eval-time use by lucide's `forwardRef`).
`lucide-react` is bundled. `renderer-bundle.test.ts` imports the *built* artifact
and renders the panel through `react-dom/server` to prove no second-React hook
crash and that lucide icons render to SVG.

## Graceful degradation

`claude-unleashed` not installed → `not-installed` state. Daemon stopped
(`cu daemon status` → `running:false`) → `daemon-down` state with a **Start
daemon** button. Both are first-class designed states, so the extension is fully
exercisable (and the bundle test passes) even on a machine without the CLI.
