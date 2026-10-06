# Part Editor

An in-browser editor for creating and editing LDraw parts, including the
`.conn` connectivity files BrickLink Studio needs to use a custom part.

## Status

Work in progress on the `dev` branch; `main` gets the first release.

- A pure-TypeScript LDraw core: typed AST, lossless parser, and a pretty /
  compact / minified serializer.
- A Three.js viewport with sub-file resolution and BFC culling, kept in live
  sync with a Monaco text editor.
- Viewport editing: select, move/rotate/scale, vertex dragging, insert/delete,
  merge and grouping, and CSG punch (holes) / erase with a BSP boolean engine.
- Connectivity: `.conn` read/write (both versions Studio uses), connector
  placement, stud/hole grids and markers.

Shape drawing tools (drag-to-draw bricks, studs, bottoms) are not in this
version. They will come back with the editor's own parametric primitive format,
which will have its own published specification.

## Quick start

```bash
npm install
npm run dev       # start the dev server
npm test          # run the unit tests
npm run build     # type-check + production build
```

## Where the parts come from

The editor draws parts from an [LDraw](https://www.ldraw.org/) parts library.
The library is not included in this repository.

- **Dev server:** Vite reads the library from disk (`LDRAW_LIBRARY_PATH`) and
  serves it on `/ldraw`.
- **Static build:** **File → LDraw Library…** reads a folder you pick. **Select
  folder…** (Chrome, Edge) remembers it; **Read folder once…** works in every
  browser and in protected locations such as `C:\Program Files`. Nothing is
  uploaded.

High-resolution primitives (`p/48`) are preferred when a library has them.

## Connectivity and BrickLink Studio

A custom part only snaps and connects in BrickLink Studio with a `.conn` file
next to it. The format is binary and undocumented, and the only official way
to create one is BrickLink's Part Designer. To make it possible from an open
editor, the format was **reverse engineered for interoperability**, including
by reading decompiled code of BrickLink's tools. The codec in `src/lib/conn.ts`
is an independent implementation written from those findings, and
[`docs/TECHNICAL/connectivity.md`](docs/TECHNICAL/connectivity.md) documents
the format in our own words. No BrickLink code, data files or `.conn` files are
included in this repository.

BrickLink and Studio are trademarks of their respective owners. This project is
not affiliated with or endorsed by BrickLink or the LEGO Group.

## Deploying to GitHub Pages

```bash
npm run build:pages        # -> dist-pages/part-editor/
npm run serve:pages        # check it at http://localhost:4173/part-editor/
```

Copy `dist-pages/part-editor` into a `username.github.io` repository and push.
The build uses a relative base (`--base=./`), so the folder can be renamed
freely. `public/.nojekyll` keeps Jekyll from processing the output. To
hard-code an absolute base instead, build with `VITE_BASE=/<path>/ npm run build`.

## Documentation

See [`docs/README.md`](docs/README.md) for the full index:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design and roadmap.
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — user-facing guide.
- [`docs/TECHNICAL/`](docs/TECHNICAL/) — technical deep dives.

## Core API

```ts
import { parseLDraw, formatLDraw, minifyLDraw } from './src/core'

const { document, errors } = parseLDraw(sourceText)   // text → typed AST
const formatted = formatLDraw(sourceText, { mode: 'pretty' })
const compressed = minifyLDraw(sourceText)            // mode: 'minified'
```

## Tech stack

React 18 · TypeScript · Vite · Three.js · Monaco · Zustand · Vitest.

## Directory layout

```
src/
  core/          # pure TS: parser, serializer, math, units, meta (+ tests)
  lib/           # geometry, CSG, connectivity, library access
  render/        # Three.js scene
  store/         # editor state
  components/    # React UI
  styles/        # design tokens
docs/            # documentation
```

## License

[MIT](LICENSE). LDraw library files used with the editor are licensed
separately by their authors (CC BY 4.0 for the official library).
