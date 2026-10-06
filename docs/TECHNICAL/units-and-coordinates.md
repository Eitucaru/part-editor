# Units & Coordinate Systems

Implemented in `src/core/units.ts`, following the standard LDraw unit
conventions.

## Length units

| Unit | LDU per unit | Notes |
|---|---|---|
| **LDU** | 1 | LDraw base unit |
| **Stud** | 20 | 1 stud = 20 LDU |
| **MM** | 2.5 | 1 LDU = 0.4 mm |
| **Inch** | 64 | 1 inch = 64 LDU |

Derived: **1 stud = 8 mm**.

Geometry is always stored and processed in **LDU**. Unit conversion exists only
for UI display and import/export.

```ts
toLdu(value, 'stud')      // 20
convertLength(1, 'stud', 'mm') // 8
```

## Coordinate systems

- **LDraw** is **right-handed, −Y up**.
- **Three.js** is **right-handed, +Y up**.

The core works exclusively in native LDraw space. The renderer converts to
scene space with the mirror `F = diag(1, −1, 1)`: flip Y for points, apply
`F·M·F` for matrices, and reverse triangle winding so normals stay outward.

- **`.conn` files** store transforms in a **left-handed** convention (Z
  negated, same −Y↔+Y convention), so five matrix fields differ in sign from
  the LDraw values.

## Type-1 matrix mapping (LDraw → `.conn`)

For an LDraw type-1 line `x y z a b c d e f g h i`, the left-handed 4×4 matrix
used by `.conn` is:

```
m03 = x     m13 = y     m23 = -z
m00 = a     m01 = d     m02 = -g
m10 = b     m11 = e     m12 = -h
m20 = -c    m21 = -f    m22 =  i
```

Five matrix fields are negated (`m02`, `m12`, `m20`, `m21`, `m23`; see
[`connectivity.md`](connectivity.md)). This is why the core keeps the raw
LDraw values and does each conversion in one place.

## Grid & snapping

The draw tools snap to one stud (20 LDU) on X/Z. Finer grids are planned with
the primitive drawing tools.
