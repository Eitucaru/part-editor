# Abstract Syntax Tree (AST)

The AST is defined in `src/core/types.ts`. Every source line maps to exactly one
command, which makes parsing lossless and formatting deterministic.

## Commands

| Kind | Interface | Line type |
|---|---|---|
| `comment` | `CommentLine` | 0 |
| `subfile` | `SubfileLine` | 1 |
| `line` | `LineLine` | 2 |
| `triangle` | `TriangleLine` | 3 |
| `quad` | `QuadLine` | 4 |
| `optional-line` | `OptionalLineLine` | 5 |
| `raw` | `RawLine` | unrecognized/malformed |

All commands carry a `lineNumber` (1-based) for source mapping — useful for
editor decorations and error reporting.

### `CommentLine`

```ts
{
  kind: 'comment'
  lineNumber: number
  text: string     // content after the leading "0"
  keyword: string  // uppercased first token, '' when empty
  rest: string     // content after the keyword, '' when none
}
```

`keyword` normalizes the trailing colon used by `Description:`, `Name:`, and
`Author:` away — so `Description: Foo` has `keyword === 'DESCRIPTION'` and
`rest === 'Foo'`.

### `SubfileLine`

```ts
{
  kind: 'subfile'
  lineNumber: number
  color: number
  position: Vec3
  matrix: Mat3      // { a..i } in LDraw row-major order
  file: string      // may contain spaces
  inverted: boolean // true when the matrix is mirrored
}
```

### Geometry commands

`LineLine` has `from` / `to`. `TriangleLine`, `QuadLine`, and
`OptionalLineLine` have a `vertices` tuple. `TriangleLine` and `QuadLine` may
carry optional `uv` values.

### `RawLine`

`{ kind: 'raw', lineNumber, text }` — the original text of a line that could
not be classified (wrong type digit, or a geometry line that is incomplete or
has non-numeric fields). This is critical for a live editor: text the user is
mid-way through typing is never dropped.

## Document model

```ts
interface LDrawDocument {
  models: LDrawModel[]   // one entry per file (or one unnamed entry)
  isMpd: boolean         // true when FILE/NOFILE delimiters were present
}

interface LDrawModel {
  name: string           // '' for the top-level model
  commands: LDrawCommand[]
  description?: string   // first Description meta or first plain comment
}
```

## Type guards

`isComment`, `isSubfile`, and `isGeometry` are provided for convenient
narrowing.

## Why not a class hierarchy?

Plain discriminated unions (a) serialize trivially, (b) work well with
structured cloning and React state, and (c) keep the core free of any runtime
dependencies. Behaviour lives in small pure functions rather than methods.
