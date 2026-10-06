# Documentation Index

Part Editor v2 — a modern, in-browser editor for creating and editing LDraw
parts, with a standalone downloadable build. This folder is the documentation
for the rewrite.

## Getting oriented

| Document | Audience | Purpose |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Everyone | High-level design, layers, data flow, roadmap |
| [`USER_GUIDE.md`](USER_GUIDE.md) | Users | How to use the application and its features |
| [`TECHNICAL/`](TECHNICAL/) | Developers | Deep dives on each subsystem |

## Technical documents

- [`TECHNICAL/ldraw-format.md`](TECHNICAL/ldraw-format.md) — the LDraw file format
  (line types, meta commands, MPD, BFC, colors) as implemented here.
- [`TECHNICAL/ast.md`](TECHNICAL/ast.md) — the typed abstract syntax tree.
- [`TECHNICAL/parser.md`](TECHNICAL/parser.md) — tokenization, parsing, MPD
  splitting, and error tolerance.
- [`TECHNICAL/serializer.md`](TECHNICAL/serializer.md) — pretty / compact /
  minified formatting, number rules, idempotency.
- [`TECHNICAL/units-and-coordinates.md`](TECHNICAL/units-and-coordinates.md) —
  units, handedness, and coordinate-system conversions.
- [`TECHNICAL/renderer.md`](TECHNICAL/renderer.md) — the Three.js viewport and
  geometry pipeline.
- [`TECHNICAL/live-sync.md`](TECHNICAL/live-sync.md) — editor ↔ viewport sync
  architecture.
- [`TECHNICAL/editing.md`](TECHNICAL/editing.md) — selection, transform gizmo,
  vertex editing, and insert/delete.
- [`TECHNICAL/csg.md`](TECHNICAL/csg.md) — the CSG boolean engine and the
  punch (hole) / erase tools.
- [`TECHNICAL/connectivity.md`](TECHNICAL/connectivity.md) — the `.conn`
  connectivity format, how it was worked out, and connector placement.
- [`TECHNICAL/merge-and-grouping.md`](TECHNICAL/merge-and-grouping.md) —
  merge mode (inlining a reference as baked geometry) and grouping
  (multi-select parts that move together).

## Conventions

- The core (`src/core/`) is **pure TypeScript** with no DOM or Three.js
  dependencies. It is the single source of truth for parsing and formatting.
- Every module in the core has a matching `*.test.ts` file (Vitest).
- Documentation is written alongside the code it describes; update both together.
