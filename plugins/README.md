# Built-in modules (`plugins/`)

The extensions that ship **compiled into the app** as the trusted, in-process
tier. They consume the same `@cctc/extension-sdk` contract as disk extensions,
but run with full Node access and no permission gate — reserved for first-party
features that genuinely need it.

> **The big picture is in [`docs/extensions.md`](../docs/extensions.md)** — read
> that first for the two-tier model (built-in vs disk), the architecture, and
> the doc map. **Authoring any extension:** [`docs/extensions-authoring.md`](../docs/extensions-authoring.md).
>
> **Naming note:** the sidebar's **"Plugins"** entry means *Claude Code CLI
> plugins* (`~/.claude/plugins`) — unrelated. These are *app* extensions.

## What lives here

| Module | Tier | Why |
|---|---|---|
| `zana/` | **built-in** (here, compiled in) | uses the native `better-sqlite3` module — can't cross the disk-extension `utilityProcess` isolation boundary, so it stays trusted in-process |
| `gus/` | **source only** — ships as a *disk* extension | packaged by `extensions/gus/` into `~/.cc-center/extensions/gus/`; it shells out to the `sf` CLI through the brokered, permission-gated `ctx.exec` (allowlist `['sf']`) and proves the full runtime path on a real plugin |

So `plugins/zana` is registered as a built-in; `plugins/gus` is the *source* for
a packaged disk extension (its build lives in [`extensions/gus`](../extensions/gus)).

## The contract (the only core surface a module imports)

Built-in and disk extensions both import **only** from the published SDK:

- `@cctc/extension-sdk/renderer` — `AppModule` (id/title/icon, optional `panel`,
  `commands`, `navBadge`) and `ModuleHost` (the capability bridge).
- `@cctc/extension-sdk/main` — `MainModule` (`setup(ctx)` → capability map,
  optional `teardown`) and `MainModuleContext` (`storage`, `log`, and — for
  isolated disk extensions — the brokered `exec`/`fs`/`fetch`).

No core stores, no IPC channel names, no other module. That boundary is what
makes a module portable to the disk-extension tier without code changes (gus
moved from built-in → disk with zero changes to its capability code — only its
build/packaging changed).

## How a module reaches the host

Everything goes through one generic IPC multiplexer (`modules:call` /
`modules:storage*`), so a module adds **zero** entries to `ipc.ts`, the preload
bridge, or `registerIpc()`. For a built-in the call lands in-process; for a disk
extension the same call routes to its `utilityProcess` via the module router:

```
panel ──host.call('listWork', opts)──► window.cc.modules.call('gus','listWork',[opts])
      ──► modules:call IPC ──► ModuleRouter.dispatch
            built-in?  ──► MainModuleHost (in-process, trusted)
            disk ext?  ──► ExtensionProcessHost ──► utilityProcess child
                            └─ ctx.exec({bin:'sf'}) ─► PermissionBroker (gated) ─► sf
```

`host.storage` is a per-module JSON KV store under
`~/.cc-center/modules/<id>.json`. `host.openExternal` / `host.toast` reuse
existing core surfaces.

## Anatomy (see `zana/` for a built-in, `gus/` for a disk-ext source)

```
plugins/<id>/
  module.ts             # AppModule manifest (renderer): id, title, icon, panel, commands?, navBadge?
  main/<id>-main.ts     # MainModule: setup(ctx) → capabilities (use ctx.exec/fs, not raw node)
  renderer/<Id>Panel.tsx# the panel, consumes ModuleHost only
  shared/types.ts       # domain types + pure helpers shared by both sides
```

## Registering a built-in module

Add it to the two arrays (this is the **built-in** path — disk extensions need
no core edit, they're discovered from disk):

1. `src/renderer/modules/index.ts` → add to `APP_MODULES`
2. `src/main/modules/index.ts` → add to `MAIN_MODULES`

Core derives the nav entry, window title, panel mount, IPC routing, and storage
from there. Icons resolve by name against `lucide-react`. Built-in ids are the
trusted set — the permission broker bypasses them.

**To ship a module as a disk extension instead** (the third-party path), don't
register it here — package it under `~/.cc-center/extensions/<id>/` with an
`extension.json` manifest. See [`extensions/gus`](../extensions/gus) for a worked
conversion and [`docs/extensions-authoring.md`](../docs/extensions-authoring.md).

## GUS specifics

`gus` talks to the Salesforce CLI against the `gus` target-org through the
brokered `ctx.exec` (it no longer imports `node:child_process`) — it reuses your
existing CLI auth, no OAuth or secrets in-app:

```
sf org login web --alias gus --instance-url https://gus.my.salesforce.com
```

Work items come from `ADM_Work__c` (assigned to the authed user), grouped into
kanban lanes by `Status__c`. As a disk extension it declares `permissions:
["exec"]` with `permissionScopes.execAllowlist: ["sf"]`, so the user consents to
it running `sf` (and only `sf`) before it loads.
