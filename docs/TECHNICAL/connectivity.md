# Connectivity (`.conn` + `PE_CONN`)

## Why `.conn`, and how the format was worked out

A custom part only snaps and connects in BrickLink Studio when a `.conn` file
sits next to its `.dat`. The format is binary and undocumented, and the only
official way to create one is BrickLink's Part Designer: load the part,
configure its connectivity by hand, and export it to Studio. Unlike Studio's
other files, which are plain text that the community routinely edits, `.conn`
cannot be written any other way, so it cannot be replaced or skipped.

To make custom parts usable in Studio from an open editor, the format was
reverse engineered for interoperability. That included reading decompiled
code of BrickLink Part Designer and Studio 2.0, and comparing binary output
byte for byte. `src/lib/conn.ts` is an independent TypeScript implementation
written from those findings. No BrickLink code, data files or `.conn` files
are included in this repository. This page describes the format in our own
words so others can build compatible tools too.

## Forms

Part Editor stores connectivity in two interchangeable forms:

- **Text** — `0 PE_CONN` comment lines inside the LDraw model (what the editor
  displays while a part is being edited). Uses the V0 type numbers.
- **Binary** — the `.conn` file BrickLink Studio loads alongside a `.dat` part,
  in either of two serialization versions (see below).

All codec code lives in `src/lib/conn.ts`. Both versions round-trip
byte-identically against `.conn` files produced by BrickLink's own tools.

## Connector types (`PhysicalT`)

| Value | Name | Notes |
|---|---|---|
| 0 | Axle | Technic axle, pin, clip, bar, socket… (subtype = `AxleT`) |
| 1 | Ball | No extra data |
| 2 | Hole | Anti-stud / tube / socket (subtype = `HoleT`) |
| 3 | Stud | Grid of stud cells |
| 4 | Fixed | Tagged fixed attachment (2 axes + tag) |
| 5 | Gear | Not used by Studio's tools; not implemented here |
| 6 | Hinge | Limits + orientation flag |
| 7 | Rail | Length |
| 8 | Slider | Length + axis booleans |

### `AxleT` (subtypes)

TechnicPinSocket 2, TechnicPin 3, TechnicPinWOHole 5, AxleSocket 6, Axle 7,
AxleWidthGuard 9, RoundHole 10, BarForRoundHole 11, Clip 12, Bar 13, PinSocket
14, BarWithPinSocket 15, Pin 17.

### `HoleT` (subtypes)

Brick 0, Plate 1, TechPinSocket 2, Bar 3, RoundHole 4.

## Matrix encoding

Every connector carries a 4×3 transform as a **12-float array** (`ConnMatrix`).
In the `.conn` binary and the `PE_CONN` text form, **five fields are stored
negated** relative to the logical matrix:

- Logical `m` (row-major 4×3): `[m00 m01 m02 m03; m10 m11 m12 m13; m20 m21 m22 m23]`
- On disk / in text, indices `2, 5, 6, 7, 11` are negated — i.e. `m20, m21,
  m02, m12, m23`.

`connPosition(m)` = `m[9..11]`, `connDirection(m)` = `m[3..5]` (matrix × +Y),
`connFront(m)` = `m[6..8]`. The negation normalizes `-0` to `0` so serialized
output is deterministic.

## Binary `.conn` layout

Two serialization versions share the same logical model:

- **V0** (Part Designer's export): headerless — records begin immediately, `Int16`
  type/subtype tags, `Int16` grid cells.
- **V1** (Studio 2.0): a `!!HS` header, `Int32` flag type/subtype tags, `Int32`
  grid cells, plus optional per-record file names and tags.

`parseConnBinary(bytes)` sniffs for the `!!HS` magic and dispatches
automatically. `writeConnBinary(connectors, version)` defaults to `'v1'`.

### V0 record layout

Little-endian, **no file header and no record count** — a flat stream of
records. Each record begins with the 52-byte common header:

| Offset | Type | Field |
|---|---|---|
| 0 | Int16 | `ConnType` |
| 2 | Int16 | `SubType` |
| 4..51 | 12×Single | Matrix (with the five negated fields) |

Type-specific trailers:

| Type | Record size | Trailer |
|---|---|---|
| Axle | 60 | 4 bools (`isStartCapped`, `isEndCapped`, `isGrabbing`, `isRequireGrabbing`) + `length` (Single) |
| Ball | 52 | — |
| Hole / Stud | variable | Int16 `height`, Int16 `width`, then `(H+1)(W+1)` cells, each `alt:occ` (Int16:Int16) |
| Fixed | 54 | `axes` (Int16) |
| Hinge | 69 | 4×Single limits + 1 bool `isOriented` |
| Rail | 56 | `length` (Single) |
| Slider | 59 | 3 bools (`isStartCapped`, `isEndCapped`, `isCylindrical`) + `length` (Single) |

### V1 record layout (Studio 2.0)

File header:

```
"!!HS"                      (4 bytes: 21 21 48 53)
Int32 SerializationVersion  (1)
Int32 FileType              (0 = Connectivity, 1 = Collider)
"!!ES"                      (4 bytes: 21 21 45 53)
[extension headers]         (none registered in Studio 2.0)
"!!DS"                      (4 bytes: 21 21 44 53)
```

Each record: `Int32` type flag → `Int32` subtype flag → 12×Single matrix
(byte-identical to V0) → type-specific payload → `bool hasFileName` +
optional UTF-8 string prefixed by its byte length as a 7-bit variable-length
integer (the .NET `BinaryWriter` string encoding).

| Element | V0 | V1 |
|---|---|---|
| Record type | Int16 | Int32 flag |
| SubType | Int16 | Int32 flag |
| Matrix | 12×Single, 5 negated | identical |
| Grid cell | Int16 altitude + Int16 occupied | Int32 + Int32 |
| Per-record file name | — | bool + string |
| Fixed / Hinge tag | — | bool + string |
| Ball flex | — | bool + Int16 count + count×Single |

### V1 flag enums

| Type | V0 value | V1 flag |
|---|---|---|
| Axle | 0 | `0x10` |
| Ball | 1 | `0x80` |
| Hole | 2 | `0x400` |
| Stud | 3 | `0x2000` |
| Fixed | 4 | `0x8000` |
| Hinge | 6 | `0x40000` |
| Rail | 7 | `0x200000` |
| Slider | 8 | `0x1000000` |

Axle subtypes: TechnicPinSocket 2→`0x40`, TechnicPin 3→`0x100`,
TechnicPinWOHole 5→`0x400`, AxleSocket 6→`0x1000`, Axle 7→`0x4000`,
AxleWithGuard 9→`0x10000`, RoundHole 10→`0x40000`, BarForRoundHole 11→`0x100000`,
Clip 12→`0x400000`, Bar 13→`0x1000000`, PinSocket 14→`0x4000000`,
BarWithPinSocket 15→`0x10000000`, Pin 17→`0x40000000`.

Hole subtypes: Brick 0→`0x40`, Plate 1→`0x1000`, TechPinSocket 2→`0x40000`,
Bar 3→`0x1000000`. (Studio 2.0 has no `RoundHole` hole subtype.)

Subtype flags are converted back to V0 numbers on V1 read and forward on V1
write, so the rest of the code always sees V0 numbers.

## `PE_CONN` text format

```
0 PE_CONN {ConnType} {SubType} {m00} {m10} {-m20} {m01} {m11} {-m21} {-m02} {-m12} {m22} {m03} {m13} {-m23} {details}
```

Details by type:

- **Axle / Slider**: `{length}` in LDU ÷ 25 (studs).
- **Hole / Stud**: `{height} {width} {cells}` where `cells` is a comma-joined
  list of `alt:occ` (altitude:occupiedArea) in row-major order.
- **Hinge**: `{flipLimMax} {flipLimMin} {limMax} {limMin} {isOriented(0|1)} {tag}`.
- **Fixed**: `{axes} {tag}`.
- **Rail**: `{length}` in raw LDU (no ÷25).

## Stud / hole grids

A single 1×1 connector uses a 3×3 grid (`height = 2`, `width = 2`):

| Cell | altitude | occupiedArea | Meaning |
|---|---|---|---|
| center `[1,1]` | 10 | 4 | the real cell |
| corners `[0,0] [0,2] [2,0] [2,2]` | 3 | 1 | corner |
| edges | 0 | 4 | edge |

The matrix origin is the grid's top-left corner, so factories offset the
position by `-10` LDU in X/Z. Cell semantics: altitude `-1` empty, `0` filler,
`3` corner, `10` stud/tube, `20` center hole; occupiedArea `1` corner, `2`
edge, `4` actual.

## Connector colors (viewport markers)

Marker colors follow the convention of Studio's own tools:

- **Stud** → red.
- **Hole** → cyan.
- **Axle / Slider / Hinge / Ball / Fixed** → even subtype yellow `0xffcc00`,
  odd subtype blue `0x2244ff`.

## Placement

The **Connectivity** tab drives `variant.kind === 'connector'` through the same
draw gesture as Shape tools. `LDrawScene.finishDraw()` builds the record and
calls `onAddConnector`, which appends a `0 PE_CONN …` line (a single history
entry “Add connector”). Placement anchors to the model bounds:

- **stud** → top surface (scene `max.y`),
- **hole** → bottom surface (scene `min.y`),
- **axle / pin / clip / bar** → vertical center.

Studs use a 180°-about-X rotation so the direction is −Y (up); hole/axle use
identity.

Two drag gestures:

- **Stud / Hole** — drag to tile. A drag over W×H grid cells creates ONE
  connector whose grid is `(2W+1)×(2H+1)` cells (`makeStudGridConnector` /
  `makeHoleGridConnector`). A plain click yields the 1×1 connector.
- **Axle / Slider** — drag to set the length along the connector axis (minimum
  4 LDU, snapped to 1 LDU). A plain click uses the variant's default length.

## Rendering

`LDrawScene.renderConnectors()` parses the active model's `PE_CONN` lines and
draws shape-based markers, colored by type, in a dedicated `connectorGroup`
that is excluded from picking:

- **Stud / Hole** — the full grid: a translucent base plate over the grid
  extent, a cylinder per occupied cell (studs, tubes, posts), and small dots
  for corner markers.
- **Axle (subtype 7)** — a cross (two perpendicular fins) along the axis.
- **Axle sockets / pins / bars / clips** — cylinders along the axis (wider for
  sockets, slim for pins/bars), with cap spheres for capped ends.
- **Ball / Fixed** — sphere (Fixed adds an orientation cube).
- **Hinge** — a cylinder.
- **Rail / Slider** — a box / cylinder stretched to the connector length.

## Store integration

- `derive()` extracts `ConnectorEntry[]` (`connector` + global `lineNumber`)
  from the active model's `PE_CONN` comments.
- `addConnector(connector)` appends a formatted `0 PE_CONN` line inside the
  model block.
- `removeConnector(lineNumber)` deletes the line.
- Export (File → Export Connectivity) serializes all connectors with
  `writeConnBinary` (V1 by default, Studio 2.0 native) and downloads
  `{name}.conn`.

## Tests

- `src/lib/conn.test.ts` — V0 binary round-trips for every type, five-field
  negation byte check, text parse/round-trip, grid factory patterns.
- `src/lib/conn-v1.test.ts` — V1 header bytes, V1 round-trips, flag subtype
  mapping, 32-bit grid cells, backward-compatible V0 read.
- `src/lib/conn-fixture.test.ts` — reads a real `3001b` `.conn` file and
  re-serializes it byte-identically. The file is not redistributed here; set
  `CONN_FIXTURE_3001B` to a local copy to run it (skipped otherwise).
- `src/store/editorStore.conn.test.ts` — add/remove connector store actions.
