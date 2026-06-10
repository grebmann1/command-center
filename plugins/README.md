# App modules (`plugins/`)

Self-contained features that plug a **nav entry + panel** into the app shell
without editing core wiring. GUS is the first one.

> **Naming:** the sidebar's existing **"Plugins"** entry means *Claude Code
> CLI plugins* (`~/.claude/plugins`). These app modules are a different thing —
> they extend *this Electron app*.

## The contract (the only core surface a module may import)

- `src/shared/module-api.ts` — `AppModule` (renderer: id, title, icon, panel)
  and `ModuleHost` (the capability bridge handed to a panel).
- `src/shared/module-main.ts` — `MainModule` (main: `setup()` → capability map)
  and `MainModuleContext` (per-module storage + logger).

A module imports **only** these two files from core, plus its own files. No
core stores, no IPC channel names, no other module. That boundary is what keeps
modules drop-in.

## How a module reaches the host

Everything goes through one generic IPC multiplexer (`modules:call` /
`modules:storage*`), so a module adds **zero** entries to `ipc.ts`, the preload
bridge, or `registerIpc()`:

```
panel ──host.call('listWork', opts)──► window.cc.modules.call('gus','listWork',[opts])
      ──► modules:call IPC ──► MainModuleHost.dispatch('gus','listWork',[opts])
      ──► gus capability (sf data query) ──► JSON back to the panel
```

`host.storage` is a per-module JSON KV store under
`~/.cc-center/modules/<id>.json`. `host.openExternal` / `host.toast` reuse
existing core surfaces.

## Anatomy (see `gus/`)

```
plugins/gus/
  module.ts             # AppModule manifest (renderer): id, title, icon, panel
  main/gus-main.ts      # MainModule: capabilities (whoami/listWork/listSprints)
  renderer/GusPanel.tsx # the panel, consumes ModuleHost only
  shared/types.ts       # domain types + pure helpers shared by both sides
```

## Registering a new module

Two one-line edits, nothing else:

1. `src/renderer/modules/index.ts` → add to `APP_MODULES`
2. `src/main/modules/index.ts` → add to `MAIN_MODULES`

Core derives the nav entry, window title, panel mount, IPC routing, and
storage from there. Icons are resolved by name against `lucide-react`.

## GUS specifics

`gus/main/gus-main.ts` shells out to the Salesforce CLI against the `gus`
target-org — it reuses your existing CLI auth, no OAuth or secrets in-app:

```
sf org login web --alias gus --instance-url https://gus.my.salesforce.com
```

Work items come from `ADM_Work__c` (assigned to the authed user), grouped into
kanban lanes by `Status__c` (see `statusToLane`). Sprints come from an
aggregate query over the same object.
