# CCTC Extensions — Overview

Claude Code Terminal Center (CCTC) has an **extension system**: self-contained
features — a sidebar nav entry plus a panel, optionally backed by main-process
capabilities — that plug into the app shell **without editing core**. Extensions
build against a stable, published contract (`@cctc/extension-sdk`) and never
import core internals.

> **Start here, then go to the right doc:**
> - **Building one?** → [`extensions-authoring.md`](./extensions-authoring.md) (the how-to).
> - **Scaffolding?** → [`tools/create-cctc-extension`](../tools/create-cctc-extension), or copy [`examples/extensions/hello`](../examples/extensions/hello).
> - **Understanding the design?** → the architecture docs linked at the bottom.

---

## Two tiers (this is the key mental model)

CCTC tiers extensions on **provenance**, not capability:

| | **Built-in** (trusted) | **Disk extension** (runtime) |
|---|---|---|
| Lives in | `plugins/<id>/`, compiled into the app | `~/.cc-center/extensions/<id>/`, loaded at runtime |
| Registered | `MAIN_MODULES` / `APP_MODULES` arrays | discovered from disk — no core edit |
| Trust | full Node access, in-process | **isolated**: own `utilityProcess`, capabilities brokered |
| Permissions | none (trusted) | **declared + user-consented + enforced** deny-by-default |
| Example | **zana** (uses native `better-sqlite3` — can't be isolated) | **gus** (talks to the `sf` CLI through the brokered `exec`) |

Both consume the **same `@cctc/extension-sdk` contract** and look identical in
the UI. The only differences are where they load from and how much the host
trusts them. A third party ships a **disk extension**; first-party features that
need raw Node (like zana's native SQLite) stay **built-in**.

> gus is deliberately a disk extension even though it's first-party — it's the
> living proof that the full runtime + isolation + consent path works on a real,
> non-toy plugin (it has a real board UI and shells out to `sf`).

---

## Architecture at a glance

```
                        ┌─────────────────────────────────────────────┐
   ~/.cc-center/        │  CCTC (Electron)                            │
   extensions/<id>/     │                                             │
     extension.json ────┼─► discovery ─► consent gate ─► load         │
     renderer.js        │      (manifest)   (declared      │          │
     main.mjs           │                    permissions)  │          │
                        │                                  ▼          │
                        │   RENDERER (sandboxed)      MAIN process     │
                        │   ┌───────────────┐                         │
                        │   │ panel (blob-  │   built-in modules ─────┤ in-process
                        │   │ imported ESM, │   (zana)  trusted        │ (trusted)
                        │   │ host React)   │                         │
                        │   └──────┬────────┘   disk-ext main ────────┤ utilityProcess
                        │          │ host.call    (gus)  ISOLATED      │ (per extension)
                        │          ▼                  │               │
                        │     ModuleHost ──IPC──► router ─┐           │
                        │   (the only surface)            │           │
                        │                                 ▼           │
                        │                    PermissionBroker ───► ctx.exec / fs / fetch
                        │                    (deny-by-default,       (gated, scoped)
                        │                     consent-derived grant)                │
                        └─────────────────────────────────────────────┘
```

- **Renderer panels** are blob-imported ESM bundles that receive the host's
  React via `activate({ React, host })` (no second React → no broken hooks). A
  panel touches the host **only** through `ModuleHost` — never `window.cc`.
- **Disk-extension main code** runs in a per-extension `utilityProcess`, not the
  Electron main process. It gets capabilities (`exec`, `fs`, `fetch`, `storage`)
  only via a brokered `MainModuleContext`, each call **permission-gated** against
  the user-consented grant. Raw `node:child_process`/`fs`/etc. are denied in the
  child (a Node-builtin denylist).
- **Built-in modules** (zana) skip the broker and run trusted in-process.

---

## What an extension can do (the `ModuleHost` surface)

- `call(capability, …)` — invoke its own main-side capabilities
- `storage` (persisted KV) and `cache` (sync, in-memory, survives unmount)
- `on(event, cb)` — subscribe to host events (project/session/inbox/schedule/…)
- `getActiveProject` / `listProjects` / `selectProject`
- `launchSession`, `openExternal`, `pushInbox`, `toast`
- Contribute beyond a panel: **`commands`** (→ command palette) and **`navBadge`** (→ sidebar)

Full signatures + the events table are in
[`extensions-authoring.md`](./extensions-authoring.md).

---

## Permissions & trust (disk extensions)

A disk extension **declares** the capabilities it needs in its manifest; the
user **consents** at install (a plain-language prompt); the host **enforces**
the granted set deny-by-default. The effective grant is `declared ∩ consented`,
so an unconsented extension can do nothing and doesn't even load. A later update
that **widens** permissions re-prompts.

Vocabulary, scoping (`execAllowlist` / `fsRoots` / `egressAllowlist`), and the
**honest residuals** (what is and isn't sealed — this is the curated-trust phase,
"MIN") are documented in
[`extensions-authoring.md` → Permissions](./extensions-authoring.md#permissions-are-enforced-for-disk-extensions-p3-b)
and [`extensions-phase3-design.md`](./extensions-phase3-design.md).

---

## Document map

**Use these to build:**
- [`extensions-authoring.md`](./extensions-authoring.md) — **the authoring guide** (manifest, the `activate` factory + the host-React contract, events, cache, contributions, the main module, build externals, install/dev loop, permissions). The one doc an extension author needs.

**Reference (the contract):**
- [`packages/extension-sdk/src`](../packages/extension-sdk/src) — the SDK source: `index.ts` (manifest types, `checkApiCompat`), `renderer.ts` (`AppModule`, `ModuleHost`, `RendererEntry`), `main.ts` (`MainModule`, `MainModuleContext`).
- [`examples/extensions/hello`](../examples/extensions/hello) — minimal worked sample (built artifact).
- [`plugins/README.md`](../plugins/README.md) — the built-in modules (zana, and gus's source before packaging).

**Architecture & history (how it was designed and built, in order):**
- [`extensions-sdk-findings.md`](./extensions-sdk-findings.md) — the original team analysis + the curated-first decision + phasing.
- [`extensions-phase0-plan.md`](./extensions-phase0-plan.md) — Phase 0: the SDK package boundary.
- [`extensions-phase1-summary.md`](./extensions-phase1-summary.md) — Phase 1: runtime disk loading.
- [`extensions-phase2-summary.md`](./extensions-phase2-summary.md) — Phase 2: events, cache, contributions.
- [`extensions-phase3-design.md`](./extensions-phase3-design.md) — Phase 3: the trust boundary (isolation, broker, consent) — design + the MIN-vs-FULL scope decision.

---

## Status & what's deferred

**Shipped & working** (verified live end-to-end with gus): the SDK, runtime disk
loading, the rich API, contributions, and the **MIN trust boundary** —
untrusted *main/headless* disk extensions are isolated, permission-gated, and
consented.

**Deferred by design** (gated on actually opening to untrusted third parties):
- **P3-C** — renderer iframe isolation, required only to let strangers ship
  *panels* (today panels are a curated tier; a panel can reach the renderer's
  React tree). Large effort — see the phase-3 design doc.
- **OS-level sandbox** (Node `--permission` / seatbelt) — the deeper seal beyond
  the JS-level builtin denylist; the denylist is not a hard boundary against a
  determined native-addon or realm escape.
- A real **first-run installer** for bundled extensions (today: manual copy /
  `npm run package`, mirroring the `hello` sample).
