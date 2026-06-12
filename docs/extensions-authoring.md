# Authoring a CCTC Extension

A Claude Code Terminal Center (CCTC) extension is a self-contained feature — a
nav entry plus a panel, optionally backed by main-process capabilities — that
plugs into the app shell without editing core. Extensions build against the
stable `@cctc/extension-sdk` contract and load at runtime from disk.

Fastest start: scaffold with [`tools/create-cctc-extension`](../tools/create-cctc-extension),
or copy the worked sample at [`examples/extensions/hello`](../examples/extensions/hello).

## On-disk shape

The host discovers extensions under `~/.cc-center/extensions/<id>/`:

```
~/.cc-center/extensions/hello/
  extension.json        manifest
  renderer.js           the panel bundle (ESM, default-exports a RendererEntry)
  main.js               optional main module (ESM, default-exports a MainModule)
```

## Manifest (`extension.json`)

```json
{
  "id": "hello",
  "title": "Hello",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js", "main": "main.js" },
  "engines": { "cctcApi": "^1.0.0" },
  "permissions": ["projects:read"]
}
```

| Field | Meaning |
|---|---|
| `id` | Stable, URL-safe id. Doubles as the nav id and the storage namespace. Must match `MainModule.id`. |
| `title` | Sidebar label. |
| `icon` | A **lucide-react icon name** (e.g. `Sparkles`, `Ticket`), resolved host-side. Unknown names fall back to `HelpCircle`. |
| `titleLabel` | Optional window-title suffix when active; defaults to `title`. |
| `entry.renderer` | Filename of the renderer bundle, relative to the extension dir. Optional (a headless extension omits it). |
| `entry.main` | Filename of the main bundle. Optional (a renderer-only extension omits it). |
| `engines.cctcApi` | Contract-version range; the host gates against `SDK_API_VERSION` at load and refuses to mount on mismatch. |
| `permissions` | Capabilities the extension intends to use. **Declared, not enforced today** — see below. |

## The renderer entry — why React is injected

The renderer bundle default-exports a `RendererEntry`: an `activate({ React, host })`
factory that returns the panel component.

```ts
import type { RendererEntry } from '@cctc/extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    return function Panel() {
      const [n, setN] = React.useState(0);
      return React.createElement('button', { onClick: () => setN(n + 1) }, `${host.moduleId}: ${n}`);
    };
  },
};
export default entry;
```

The host blob-imports the bundle and calls `entry.activate({ React, host })`,
passing **its own React instance**. The bundle must NOT `import 'react'`: a
second React copy in one tree breaks hooks ("Invalid hook call" / mismatched
dispatcher), because hook state lives in module-level singletons. Building with
`React.createElement` (rather than JSX) keeps the bundle from referencing the
externalized jsx-runtime. The returned component is mounted with a `{ host }`
prop.

`host` (`ModuleHost`) is the only surface an extension touches — there is no
escape hatch to `window.cc`. It exposes: `moduleId`, `call`, `storage`,
`openExternal`, `pushInbox`, `toast`, `getActiveProject`, `listProjects`,
`selectProject`, `launchSession`, and (Phase 2) `on` and `cache`.

## Events — `host.on(event, cb)`

`host.on` subscribes to a **read-only notification** the host already emits and
returns an **unsubscribe function** (mirroring core's `on*` convention). The
handler fires with the event's typed, JSON-serialisable payload on every
occurrence. These notify the panel that something changed; they never mutate
anything. **Always unsubscribe in your effect cleanup** — a panel that
subscribes on mount and never unsubscribes leaks handlers across remounts.

```ts
React.useEffect(() => {
  const off = host.on('project:changed', ({ project }) => setProject(project));
  return off; // unsubscribe on unmount
}, []);
```

| Event | Payload |
|---|---|
| `project:changed` | `{ project: { id, name, path } \| null }` — the shell's selected project changed/cleared. |
| `nav:changed` | `{ nav: string }` — the active nav (sidebar selection) changed. |
| `session:updated` | `{ session: SessionInfo }` where `SessionInfo = { id, projectId, title, status }`. |
| `session:agentStatus` | `{ sessionId, state: 'working' \| 'blocked' \| 'done' \| 'idle' \| 'unknown' }`. |
| `session:exit` | `{ sessionId, code }`. |
| `inbox:appended` | `{ id }` — new inbox entry id. |
| `inbox:removed` | `{ id }` — removed inbox entry id. |
| `schedule:changed` | `{}` (empty — re-read scheduled tasks as needed). |
| `mcp:changed` | `{}` (empty — re-read MCP config as needed). |
| `skills:changed` | `{}` (empty — re-read installed skills as needed). |

Treat payloads as immutable, and don't assume any delivery ordering between
distinct event types. `SessionInfo` is a deliberately minimal SDK-owned
projection of core's richer session — stable across versions.

## Cache — `host.cache`

`host.cache` is a **synchronous, in-memory** scratch store private to the
extension: `get(key)`, `set(key, value)`, `delete(key)` — no Promises. Its
contents **survive panel unmount** (unlike React state, which is torn down when
the nav switches away), so it's the right home for ephemeral working data you
don't want to recompute on every remount (a fetched list, a counter). It does
**not** persist to disk and is gone on app/extension restart, and it is dropped
when the extension is disabled/removed.

`cache` vs `storage`:

| | `host.cache` | `host.storage` |
|---|---|---|
| Sync/async | synchronous (no `await`) | async (`Promise`) |
| Lifetime | in-memory; survives unmount; gone on restart/disable | persisted to disk; survives restart |
| Use for | ephemeral, cheap-to-lose working data | durable view preferences (selected sprint, …) |

## Contributions — `commands` and `navBadge` (panel now optional)

A module contributes through any subset of three extension points on the
`AppModule`: `panel`, `commands`, and `navBadge`. **`panel` is now optional** —
a module may contribute only `commands` and/or a `navBadge`. A panel-less module
still gets a sidebar nav entry; selecting it renders a small placeholder
(`.module-no-panel`) rather than a view.

```ts
// On the AppModule (the module manifest object), NOT the RendererEntry:
commands: (host) => [
  { id: 'say-hi', label: 'Hello: say hi', keywords: ['greet'], run: () => host.toast('hi') }
],
navBadge: (host) => host.listProjects().length, // number | string | null (null/0/'' → no badge)
```

- **`commands(host)`** returns `ExtensionCommand[]` (`{ id, label, run, keywords? }`).
  Core merges them into the command palette (⌘K), namespaced `ext:<moduleId>:<id>`,
  grouped under the module title, each throw-isolated.
- **`navBadge(host)`** returns a `number | string | null` rendered in the
  sidebar's `.nav-badge` slot. Keep it **cheap and synchronous** — it may be
  invoked on every render. For a precisely-live badge, recompute off
  `host.cache` / state updated from a `host.on` subscription.

> **Runtime bundles cannot contribute `commands`/`navBadge` today.** These live
> on the `AppModule`, but a runtime-loaded extension's `RendererEntry.activate()`
> returns only the panel component, and the loader builds the `AppModule` from
> the manifest + that panel — it carries no `commands`/`navBadge`. So today these
> two contributions are exercised by **built-in** modules (e.g. `gus`). The
> runtime `host.on` / `host.cache` surfaces, by contrast, work in a runtime
> bundle — see the `hello` sample. Extending `RendererEntry` + the loader to
> carry command/badge factories from a bundle is a follow-up.

## The main module (optional)

`main.js` default-exports a `MainModule`. `setup(ctx)` runs once at boot and
returns a map of named capabilities; the panel reaches each via
`host.call('<name>', ...args)`. Capabilities run in the main process with Node
access; return values are structured-cloned over IPC, so they must be
JSON-serialisable. Add `teardown()` to release timers/watchers/child processes
on disable.

```ts
import { defineMainModule } from '@cctc/extension-sdk';
export default defineMainModule({
  id: 'hello',
  setup(ctx) {
    return { async ping(name: string) { ctx.log(`ping ${name}`); return { ok: true }; } };
  },
});
```

## Build (externals)

Use Vite **library mode** — one entry in, one ESM out — and externalize what the
host owns:

- **Renderer build:** externalize `react`, `react-dom`, `react/jsx-runtime`,
  `lucide-react`. The host provides React (via `activate`) and the icon library.
- **Main build:** externalize `electron` and Node built-ins; bundle everything
  else the extension imports (the host's `node_modules` is asar-locked and not
  available to an on-disk extension).

Output filenames must match the manifest `entry`. The scaffold's
[`vite.config.ts`](../tools/create-cctc-extension/template/vite.config.ts) does
both builds (selected by a `BUILD_TARGET` env var).

## Install & dev loop

```sh
npm run build
ID=hello
mkdir -p ~/.cc-center/extensions/$ID
cp extension.json dist/renderer.js ~/.cc-center/extensions/$ID/
cp dist/main.js ~/.cc-center/extensions/$ID/   # only if you ship a main module
```

Dev loop: edit `src/` → `npm run build` → re-copy into the extensions dir →
re-enable in CCTC.

## Enable / disable — when changes take effect

Extensions are enabled/disabled in CCTC (Settings → Extensions) via an
enabled-map (modeled on the CLI-plugins loader). What "takes effect" means
depends on whether the extension ships a main module:

- **Renderer-only extension** (no `entry.main`): enable/disable takes effect
  **immediately** — the panel mounts (or unmounts) on the next render, no
  relaunch needed.
- **Main-bearing extension** (`entry.main`): its main side — the capabilities
  reached via `host.call` — is loaded **once at app boot**. So:
  - **Enabling** flips the map immediately, but the main module activates only
    on the **next relaunch**. Until then the entry reports `mainActive:false`
    and the UI surfaces a relaunch hint; the panel's `host.call(...)` would
    otherwise reject with "Unknown module". (The main process can't hot-swap
    the module: an ESM `import()` is cached by URL, so a re-import after a
    teardown returns the same stale instance — relaunch is the clean reset.)
  - **Disabling** tears the live main module down **immediately** (its
    `teardown()` runs and its capabilities are dropped).

Dev loop: edit `src/` → `npm run build` → re-copy into the extensions dir →
**relaunch CCTC** (a renderer-only extension can skip the relaunch, but a
main-bearing one needs it to pick up both the new main bundle and the new
renderer bundle).

## Permissions are declared, not enforced (today)

The `permissions` field ships now but nothing checks it yet — this is the
**curated-trust** phase: extensions are as trusted as the built-in modules.
Declare what you intend to use anyway; enforcement (a capability broker at the
dispatch boundary, isolation, consent) lands in a later phase, and declaring now
makes opening up additive rather than a breaking retrofit.

## Reference

- Contract source: [`packages/extension-sdk/src`](../packages/extension-sdk/src)
  (`index.ts`, `renderer.ts`, `main.ts`).
- Worked sample (built artifact): [`examples/extensions/hello`](../examples/extensions/hello).
- Sample source: [`tools/create-cctc-extension/sample-hello`](../tools/create-cctc-extension/sample-hello).
- Architecture & phasing: [`extensions-sdk-findings.md`](./extensions-sdk-findings.md).
