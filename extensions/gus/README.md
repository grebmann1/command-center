# GUS — first-party CCTC disk extension

This is the GUS work board packaged as a **runtime disk extension** rather than a
compiled-in built-in. It is the dogfood of the full extension pipeline:
discovery → consent → per-extension `utilityProcess` isolation → brokered `sf`
exec.

The feature source still lives in `plugins/gus/*` (shared with nothing else now
that gus is de-registered from `APP_MODULES` / `MAIN_MODULES`). This package only
adds the thin entry wrappers + build that turn that source into two
self-contained ESM artifacts.

## Build

```
npm run build      # build:renderer then build:main → dist/{renderer.js,main.js}
npm run package    # copy dist + extension.json into examples/extensions/gus/
                   # (committed artifact) and seed ~/.cc-center/extensions/gus/
npm run typecheck  # typechecks these entries AND the plugins/gus source
```

`npm run dev` at the repo root then discovers gus from `~/.cc-center/extensions/gus`
and prompts for consent to its one permission (`exec`, scoped to the `sf` CLI).

## The headline finding: React + lucide across a blob import

The host loads a renderer bundle by reading it off disk as a string, wrapping it
in a `Blob`, and `import()`ing the `blob:` URL. **A blob import has no import
map**, so any bare `import 'react'` / `import 'react/jsx-runtime'` left in the
bundle is unresolvable at load. But bundling our *own* React would put two Reacts
in one tree → "Invalid hook call".

The `hello` sample sidesteps this by importing nothing and using
`React.createElement`. GusPanel can't: it uses JSX (→ `react/jsx-runtime`),
`react` hooks, and ~20 `lucide-react` icons.

Resolution (see `vite.config.ts`, `src/react-shim.ts`, `src/jsx-runtime-shim.ts`,
`src/host-react.ts`):

- **`react` and `react/jsx-runtime` are ALIASED to in-bundle shims** that
  delegate to the host's single React instance. Nothing bare survives; one
  React. (NOT externalized — externalizing would leave unresolvable bare imports
  in the blob.)
- **`lucide-react` is BUNDLED** (the host does not inject it). Its icons ship in
  `renderer.js`.
- **The host React is supplied two ways**, because React is needed at two times:
  - `activate({ React })` → `setHostReact(React)` covers render-time
    (hooks/JSX/createElement run only at render, after activate).
  - **`globalThis.__CCTC_HOST_REACT__`**, set by the host loader immediately
    before the blob import, covers **module-eval time**. This was the real gap:
    `lucide-react`'s icon factory calls `forwardRef(...)` at IMPORT, before
    `activate` runs. A render-time-only injection point is insufficient for any
    library that touches React at import. The host now primes the global up
    front (one line in `src/renderer/modules/loader.ts`); bundles that import
    nothing (like `hello`) ignore it.

`renderer-bundle.test.ts` imports the *built* artifact, activates it with the
test's React, and renders the panel through `react-dom/server` — proving no
second-React hook crash and that lucide icons render to SVG.
