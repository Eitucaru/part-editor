# LDraw File Format

This document describes the LDraw format as implemented by the core. It covers
the syntax that the parser recognizes and the serializer emits.

## Line types

An LDraw file is a sequence of lines. The first character of a line is a digit
`0`–`5` that selects the line type. Anything else is treated as a raw,
unclassifiable line and preserved verbatim.

| Type | Name | Grammar |
|---|---|---|
| 0 | Comment / meta | `0 <text>` |
| 1 | Sub-file reference | `1 <color> x y z a b c d e f g h i <file>` |
| 2 | Edge line | `2 <color> x1 y1 z1 x2 y2 z2` |
| 3 | Triangle | `3 <color> x1 y1 z1 x2 y2 z2 x3 y3 z3 [u1 v1 u2 v2 u3 v3]` |
| 4 | Quad | `4 <color> x1 y1 z1 … x4 y4 z4 [u1 v1 … u4 v4]` |
| 5 | Optional line | `5 <color> x1 y1 z1 x2 y2 z2 x3 y3 z3 x4 y4 z4` |

### Type 0 — comments and meta commands

Everything after the leading `0` is free text. A line whose first token matches
a known keyword is a **meta command**; otherwise it is a plain comment. Meta
commands are round-tripped verbatim, so no information is lost.

### Type 1 — sub-file reference

- `color` — the color code to apply to the referenced file.
- `x y z` — the position of the reference origin.
- `a b c d e f g h i` — a 3×3 rotation/scale matrix in **row-major** order:

  ```
  a b c
  d e f
  g h i
  ```

- `file` — the referenced file name. **The file name may contain spaces**; it is
  everything after the 14th token.

A negative matrix determinant indicates a mirrored (reflected) reference; the
parser flags this as `inverted`.

### Type 2 — edge line

A line segment between two points, drawn in the given color.

### Types 3 / 4 — triangle and quad

Filled polygons. The optional trailing UV pairs (6 for a triangle, 8 for a quad)
are used for texture mapping. The parser captures them when present.

### Type 5 — optional line

A conditional edge used for smooth-curved part outlines. The four points are the
two control points and the two edge endpoints; the renderer decides whether to
draw the edge.

## Colors

| Code | Meaning |
|---|---|
| 0–15 | Standard palette (16 = **inherit / default**) |
| 16 | Inherit from the ancestor (resolves to 19, tan, when no ancestor) |
| 24 | Edge color |
| `0x2RRGGBB` | Custom color (may be written in decimal or `0x…` hex) |

The parser accepts both decimal and `0x`-prefixed hexadecimal color tokens.

## Meta commands

Common official meta commands include `Name`, `Author`, `Description`,
`!LICENSE`, `!LDRAW_ORG`, `!CATEGORY`, `!KEYWORDS`, `!HISTORY`, `!HELP`,
`!CMDLINE`, `!COLOUR`, `BFC …`, `STEP`, `ROTSTEP`, `SAVE`, `CLEAR`, `WRITE`,
`PRINT`, `PAUSE`, and `MPD`.

Unknown meta commands are kept verbatim as comments, so files written by other
tools round-trip unchanged. The editor itself uses `0 PE_CONN` lines to hold
connectivity while a part is edited (see `connectivity.md`).

## MPD (multi-part documents)

An MPD file bundles several models:

```
0 FILE main.ldr
0 Name: main.ldr
1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr
0 NOFILE

0 FILE sub.ldr
0 Name: sub.ldr
2 24 0 0 0 0 1 0
0 NOFILE
```

- `0 FILE <name>` starts a model block.
- `0 NOFILE` ends it.
- Content outside any block belongs to the top-level model (empty name).

## BFC

BFC (Back-Face Culling) meta commands control winding:

- `0 BFC CERTIFY CCW` / `CERTIFY CW` — declare the winding convention.
- `0 BFC INVERTNEXT` — invert the next sub-file reference.
- `0 BFC NOCERTIFY` — disable BFC.
- `0 BFC CLIP` / `NOCLIP` — clipping state.

The parser preserves BFC lines verbatim. Applying BFC state to geometry is the
renderer's job (milestone 2); the core only exposes matrix-mirror detection.

## Whitespace and line endings

- The parser accepts LF, CRLF, and CR, and strips a leading UTF-8 BOM.
- The serializer normalizes line endings (default LF) and regenerates
  whitespace deterministically (see [`serializer.md`](serializer.md)).
