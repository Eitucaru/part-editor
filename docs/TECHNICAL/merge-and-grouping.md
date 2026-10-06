# Merge mode & grouping — design notes

> How `part-editor-v2` implements two editing workflows that sit above the
> plain LDraw text: **merging** (inlining a referenced file into concrete
> geometry) and **grouping** (selecting several parts so they move together).
> Both are editor-level conveniences that never change the LDraw format
> itself.

---

## 1. Merge

### 1.1 What it does

"Merge" replaces the selected type-1 sub-file references with the actual
geometry of the files they point at, transformed into place. Every selected
part is baked, and all of the baked geometry lands in the main model as one
flat list of lines. After a merge:

- the selected type-1 lines are gone;
- the body is a flat list of type-2/3/4/5 lines (and kept metas like `BFC`);
- type-2 edge lines are preserved, so the result keeps its crisp outlines;
- the result is editable as ordinary geometry in the current file.

Merging collapses a part reference so two parts can then be boolean-ed
together (union / intersect / difference) as one solid. The boolean work
happens separately through the CSG engine; merge is just the step that makes
references into local geometry.

### 1.2 Why it needs a bake step

A merge cannot simply copy the referenced file's lines and wrap them in the
reference matrix, because:

1. **Library primitives have sub-references of their own** (e.g. a brick
   referencing `stud.dat`, `box5.dat`), each with their own transforms and
   colours. Copying only the top file would drag in unresolved references.
2. **Winding and colour inheritance** (`BFC`, `INVERTNEXT`, colour 16) are
   resolved by the geometry builder. Running the reference through the same
   builder the viewport uses is the only faithful way to know what it
   *looks like*.

So merge goes through the render pipeline rather than the text pipeline.

### 1.3 Pipeline

Implemented in `src/lib/merge.ts` as `bakeReference(code, lineNumber,
provider)`, which returns the replacement lines for one reference (faces +
edges). The store's `mergeSelected` calls it once per selected reference,
removes all of the baked references, and inserts the combined lines where the
first reference was.

```
type-1 line in main model
        │  parse, find command at lineNumber
        ▼
resolve referenced text
        │  workspace block (same basename) ──► parse that block
        │  else provider.load(base)          ──► parse library file
        ▼
build with referenced file as ROOT
        │  buildModelGeometry(combined, provider, rootModel.name)
        │  combined = [rootModel, ...workspace models] (dedup by basename)
        │  → resolves sub-references recursively
        ▼
flatten to scene-space soup        flattenBuiltToSceneSoup(built)  (faces)
        │                          flattenBuiltToSceneEdges(built) (type-2 lines)
        ▼
apply the reference transform      transformSoup / transformEdgeSoup
        │  scenePos = flipY(cmd.position)          (LDraw -Y up → scene)
        │  sceneMat = ldrawMatrixToScene(cmd.matrix)
        ▼
soup → LDraw lines                 soupToLdrawLines + edgeSoupToLdrawLines
        ▼
store: remove all baked refs, insert combined lines at first ref's position
```

The flip between coordinate spaces is the same `F = diag(1,-1,1)` convention
used everywhere else (see `units-and-coordinates.md`): the geometry builder
produces scene-space soup, so the reference position/matrix must be converted
to scene space before being applied, and the soup converters flip Y back to
LDraw space on the way out.

### 1.4 Why "build with the file as root" matters

`buildModelGeometry` normally builds the *main model* and resolves references
by basename. For merge we want the *referenced* file's own geometry, not the
main model's view of it. Building the referenced
model as `rootModel` gives exactly that, while still providing the rest of the
workspace as resolution targets for internal references (deduplicated so the
root wins).

### 1.5 Limits

- **Color fidelity.** The soup pipeline carries per-face colors and type-2
  edge colors, but meta-only content (author lines, `0 !` comments, connector
  records) inside the merged file is dropped. That is acceptable for a
  geometry merge, but the operation is lossy by design — it is a one-way
  collapse.
- **References only resolve when the library is available.** A part that
  references library primitives needs the active library to load them.
- **No undo of the bake semantics.** Undo/redo restores the previous text
  (including the type-1 lines), as with any other edit — merge participates in
  the same history.

---

## 2. Grouping

### 2.1 What it does

Grouping lets the user select two or more part references and treat them as a
unit:

- **Multi-select** with Ctrl/Cmd+click adds/removes parts from the selection.
- **Group Selection** records the selected line numbers as a group.
- Selecting any member of a group selects the **whole group**.
- The **move** tool (and drag-to-move in the select tool) translates every
  member by the same delta.
- **Ungroup** dissolves the group and leaves the clicked part selected.

The goal is fast re-arrangement of assemblies (e.g. "move this whole stud
ring over by 40 LDU") without merging or restructuring the file.

### 2.2 Where the state lives

Groups are **editor state, not document state**:

```
src/store/editorStore.ts
  PartGroup { id: string; lines: number[] }   // global line numbers
  selectedLines: number[]                     // multi-selection
  groups: PartGroup[]                         // all groups
  toggleSelect(lineNumber)
  groupSelection()
  ungroup(lineNumber)
```

They are deliberately kept out of the LDraw text. LDraw has no group
construct, so groups are resolved at interaction time:

- `selectPart(selection)` looks up whether `selection.lineNumber` belongs to a
  group and, if so, sets `selectedLines` to the whole group.
- `transformPart(lineNumber, position, matrix)` — for the **move** tool *and*
  for **select-tool dragging** (both translate parts) — applies the same
  translation delta to every selected line (rotate/scale still act on the
  primary part only).

Line numbers are global and are kept valid because these operations replace
lines in place (`applyCommandEdit`) rather than inserting or deleting, so a
group's members do not shift. Operations that *do* restructure the document
(delete, merge, switching files, replacing the document) clear
`selectedLines`; merge additionally clears `groups`, since the merged lines no
longer exist as references.

### 2.3 Scene interaction

`src/render/ldraw-scene.ts`:

- `callbacks.onToggleSelect` is fired on Ctrl/Cmd+click in the select tool
  (normal click still calls `onSelectPart`).
- `setSelectedLines(primary, lines)` drives the highlight: each selected line's
  part group gets its own `BoxHelper`, so a multi-selection shows one box per
  part rather than one box around everything.
- The transform gizmo attaches to the **primary** (`selectedLine`) part; moving
  it reports the delta that the store then replays across the group. The gizmo
  commit hooks onto TransformControls' `mouseDown`/`mouseUp` events — Three
  r160 has no `dragging-changed` event (that arrived in a later release).
- **Live group movement.** During a drag the scene records every selected
  part's starting position (`startPositions`) and, on each pointer move,
  applies the same translation delta to *all* of them, so a group slides as
  one object instead of snapping the followers into place on release. The
  gizmo does the same for translate drags via its `objectChange` event
  (rotate/scale still act on the primary part only, matching the store).
- The Move tool also supports direct body-drag (like the Select tool), with a
  guard so the transform gizmo still takes priority when one of its handles is
  grabbed.

`src/components/ViewportPane.tsx` wires the callbacks to the store and adds
**Merge Part**, **Group Selection** (enabled at ≥2 selected parts), and
**Ungroup** (enabled when the selected part is in a group) to the viewport
context menu.

### 2.4 Tests

- `src/store/editorStore.groups.test.ts` covers toggle, group creation, the
  ≥2-parts guard, whole-group selection, group move (move tool *and*
  select-tool drag), and ungroup.
- `src/store/editorStore.merge.test.ts` covers multi-reference merge, edge
  preservation, and ignoring non-reference lines in the selection.
- `src/lib/merge.test.ts` covers baking a workspace reference and a library
  primitive reference.

---

## 3. Tab ↔ scene selection sync

### 3.1 What it does

The file tabs and the viewport selection are kept in sync, both directions:

- **Tab → scene.** Focusing a file tab selects every part in the main model
  that references that file (by basename), lighting them up in the viewport so
  you can see which physical part a file corresponds to. Focusing `main.ldr`
  clears the part selection.
- **Scene → tab.** Clicking a part that references a workspace file focuses
  that file's tab (and selects the part, or its whole group if grouped).
  Clicking a part that references a library file does not change the tab.

### 3.2 Cursor preservation

Neither direction resets the editor caret unless the **active file actually
changes**:

- Clicking the already-active tab recomputes `activeCode` with identical
  content; Monaco's value diff (`value !== editor.getValue()`) is a no-op, so
  the caret and selection are untouched.
- Clicking a part in the same file as the open tab does not touch `activeCode`.
- Clicking a part or tab that switches the active file swaps the editor text
  (and therefore the caret), which is the expected "open tab changed" case.

### 3.3 Where it lives

- `src/store/editorStore.ts` — `setActiveFile(index)` now scans the main model
  for sub-file references whose basename matches the focused file and sets
  `selectedLine` / `selectedLines`; `selectPart(selection)` already switched
  the tab when the clicked part references a workspace file.
- `src/render/ldraw-scene.ts` + `src/components/ViewportPane.tsx` — the
  `selectedLines` state drives per-part `BoxHelper` highlights, so tab focus
  is visible in the viewport without any extra scene API.

---

## 4. Related reading

- `TECHNICAL/units-and-coordinates.md` — the LDraw↔scene flip used in
  `bakeReference`.
- `TECHNICAL/csg.md` — the boolean engine merge is typically paired with.
- `TECHNICAL/editing.md` — selection, transform, and the edit operations
  behind grouping.
