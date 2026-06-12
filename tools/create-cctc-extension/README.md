# create-cctc-extension

Scaffold for building a Claude Code Terminal Center (CCTC) extension against the
stable `@cctc/extension-sdk` contract — no dependency on core source.

## Quick start

```sh
node tools/create-cctc-extension ./my-ext --id my-ext --title "My Ext"
cd my-ext
npm install
npm run build
cp extension.json dist/renderer.js dist/main.js ~/.cc-center/extensions/my-ext/
```

Then enable the extension in CCTC (Settings → Extensions).

## What you get

The generator copies [`template/`](./template) and rewrites the id/title. The
template produces:

- **`extension.json`** — the manifest the host loader reads (`id`, `title`,
  `icon` = a lucide-react icon name, `entry`, `engines.cctcApi`, declared
  `permissions`).
- **`src/renderer/panel.tsx`** — default-exports a `RendererEntry`: an
  `activate({ React, host })` factory that returns the panel component. It uses
  the **host-injected React** and does NOT import react.
- **`src/main/index.ts`** — optional `MainModule` exposing named capabilities
  reached from the panel via `host.call()`. Delete it (and `entry.main`) for a
  renderer-only extension.
- **`vite.config.ts`** — library mode, one entry → one ESM. Renderer build
  externalizes `react`, `react-dom`, `react/jsx-runtime`, `lucide-react`; main
  build externalizes `electron` + Node built-ins. Output filenames match the
  manifest `entry` (`renderer.js`, `main.js`).
- **`tsconfig.json`** — references `@cctc/extension-sdk`.
- **`package.json`** — build scripts; `@cctc/extension-sdk` devDependency,
  `react` peerDependency.
- **`README.md`** — scaffold → build → install → dev loop.

## Copy-the-folder alternative

You don't have to run the generator. The template is a real, complete project:
copy [`template/`](./template) anywhere, edit `extension.json` (`id`/`title`)
and the `id` in `src/main/index.ts`, then `npm install && npm run build`.

## A worked example

A complete, already-built sample lives at
[`examples/extensions/hello/`](../../examples/extensions/hello) — the exact
on-disk shape the loader loads (copy it straight into
`~/.cc-center/extensions/hello/`). Its maintainable source (`.tsx`) is kept here
at [`sample-hello/`](./sample-hello).

## Authoring guide

See [`docs/extensions-authoring.md`](../../docs/extensions-authoring.md) for the
full contract: manifest fields, why React is injected, build externals, the
install path, and the enable/relaunch caveat.
