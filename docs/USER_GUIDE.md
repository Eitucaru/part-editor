# Part Editor — User Guide

> Milestones 1–5 are complete. You can open a part, watch it render live in the
> 3D viewport (with BFC back-face culling), edit it in both the text editor and
> the viewport (select, move, rotate, scale, drag vertices, insert parts),
> punch holes or erase regions with the CSG tools, and place **connectivity**
> (studs, holes, axles, pins…) in the Connectivity tab, exporting it as a
> binary `.conn` file.

## What Part Editor does

Part Editor is a browser-based tool for creating and editing **LDraw parts** —
the geometry and connectivity files used by BrickLink Studio 2.0 and other
LDraw tools, with direct geometry editing and a live-sync text editor.

## The interface

The window is divided into regions:

- **Menu bar** (top) — File, Edit, View menus.
- **Tool palette** (left) — the Shape tools (holes, eraser) and the
  Connectivity tools.
- **Editor** — the LDraw text, with syntax highlighting, folding, and live
  formatting.
- **Viewport** — the interactive 3D preview with orbit, grid, and transform
  gizmos.

## Core workflows

### Open a part

Use **File → Import LDraw…** to load a `.dat`, `.ldr`, or `.mpd` file. The part
appears in the 3D viewport and its source in the editor, kept in sync.

### Edit in the text editor

Type in the editor and the 3D view updates automatically. Incomplete lines are
tolerated — they are simply not rendered until they are valid.

### Edit in the viewport

Use the floating toolbar to pick a tool:

- **Select** — click a part to select it.
- **Move / Rotate / Scale** — drag the gizmo handles; changes are written back
  into the text immediately.
- **Vertex** — click a vertex and drag it to reshape triangles and quads.

**Delete** removes the selected part; **Escape** clears the selection; the
**Fit** button frames the model.

### Insert parts

Add a type-1 reference (for example `1 16 0 0 0 1 0 0 0 1 0 0 0 1 3005.dat`)
in the text editor, or import a file. Shape drawing tools (drag-to-draw
bricks, studs and bottoms) will return with the editor's own primitive
format.

### Punch holes & erase (CSG)

Switch the left toolbar to **Shape** and pick **Hole** (Axle/Pin/Bar) or
**Eraser**. With a hole variant selected, click (or drag) in the viewport to
punch a cylindrical hole straight through the part; with **Eraser**, drag a box
to remove that region. The part is re-triangulated and the result is written
back into the text editor.

### Undo, redo & history

Every action (move/rotate/scale a part, drag a vertex, insert, delete, punch,
erase, format, add a file, …) is recorded as its own entry in an **edit
history**. Open the **History** menu to see the tree:

- **Undo / Redo** (also **Ctrl+Z** / **Ctrl+Y**) step through the current branch.
- Click any entry to **jump** straight to that state.
- After undoing, a new action **diverts** history: the previous future is kept
  as a separate branch you can return to at any time.

Typing in the text editor is grouped intelligently — a burst of keystrokes
becomes a single "Edit text" entry, not one per character.

### Format the file

Formatting normalizes spacing and line breaks. Two operations are provided:

- **Format** — human-readable output with aligned columns and blank lines
  between sections.
- **Compress / Minify** — compact, single-spaced output for export, with
  reduced number precision.

Both are **lossless**: they never change geometry, colors, or comments.

### Save and export

- **Save Project** — save the document (including settings) for later editing.
- **Export LDraw** — write a minified `.dat` file ready for Studio.
- **Export Connectivity (.conn)** — write the binary connectivity file that
  Studio loads alongside the `.dat` part.

## Units reference

| Unit | Value |
|---|---|
| 1 stud | 20 LDU |
| 1 mm | 2.5 LDU |
| 1 inch | 64 LDU |
| 1 stud | 8 mm |

## Editing tools

| Tool | What it does |
|---|---|
| Hole | Punch axle/pin/bar holes (CSG) |
| Eraser | Erase a rectangular region (CSG) |
| Conn | Place connectivity (studs, holes, axles, pins, clips, bars) |

## Connectivity

Connectivity is the metadata that tells Studio how a part attaches to other
parts. Switch the left toolbar to the **Connectivity** tab and pick a tool:

- **Stud** — place a stud on the top of the part (red marker).
- **Bottom** — place an anti-stud / tube on the bottom (cyan marker).
- **Acc** — place an axle, technic pin, clip, or bar (yellow/blue marker).
- **Hole** — place an axle socket, pin socket, or round hole.

With a tool selected, click in the viewport to drop a connector at the snapped
position:

- **Stud / Bottom** — click once for a single stud/tube, or **drag** to tile a
  rectangular grid of studs or anti-studs in one go.
- **Acc / Hole** — click once for the default length, or **drag** to stretch an
  axle / pin / bar to a custom length.

Each connector is recorded as its own history entry (undo/redo works) and
appears in the text editor as a `0 PE_CONN …` line. Connectors render as
colored markers: stud grids show a translucent base plate with a stud per cell,
axles draw a cross, sockets/pins draw cylinders, and balls/hinges draw
spheres/cylinders. Use **File → Export Connectivity (.conn)** to write the
binary `.conn` file (Studio 2.0's versioned V1 format) that Studio 2.0 reads
alongside the part.

See `docs/TECHNICAL/connectivity.md` for the exact `.conn` and `PE_CONN`
formats (both the V0 and Studio 2.0 V1 binary layouts are supported).
