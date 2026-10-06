# Serializer

Implemented in `src/core/serializer.ts`. The serializer turns a parsed
`LDrawDocument` back into text, with three formatting modes.

## Formatting modes

| Mode | Whitespace | Blank lines | Number precision |
|---|---|---|---|
| `pretty` | 3-space group separators | inserted before comment sections | 4 decimals |
| `compact` | single spaces | none inserted | 4 decimals |
| `minified` | single spaces | none inserted | 3 decimals |

### `pretty`

Human-readable output that matches the original editor's style:

```
1 16   0 0 0   1 0 0   0 1 0   0 0 1 stud.dat
2 24   0 0 0   0 1 0
```

Logical groups (position, each matrix row, each vertex) are separated by three
spaces. A blank line is inserted before a comment section that follows geometry.

### `compact`

Single-space separators, no inserted blank lines. The standard "normalize
whitespace" output.

### `minified`

Like `compact`, but numbers use 3 decimals and blank lines are removed —
the "compress the file" operation used for export.

## Number formatting

`formatNumber` (in `src/core/format.ts`) applies these rules:

1. Round to the requested precision.
2. Normalize `-0` to `0`.
3. Never emit scientific notation.
4. Strip trailing zeros (`1.5000` → `1.5`, `1.0` → `1`).

## Determinism and idempotency

Formatting is idempotent: `format(format(x)) === format(x)`. This is verified by
tests and is essential for the live-sync editor, where formatting must not
change content or cause feedback loops.

## MPD output

Named models are wrapped in `0 FILE <name>` / `0 NOFILE`. The top-level
(unnamed) model is emitted without a wrapper. In `pretty` mode, models are
separated by a blank line.

## API

```ts
serializeCommand(cmd, options): string
serializeModel(model, options): string[]
serializeLDraw(document, options): string

formatLDraw(text, options): { text, errors }   // parse + serialize
minifyLDraw(text, options): { text, errors }   // parse + serialize (minified)
```

Options: `{ mode, precision, newline, finalNewline }`.
