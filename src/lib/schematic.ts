import type { DirectGeometry } from './geometry-builder'

/**
 * Pure 2D-schematic helpers for the vertex-mode companion view.
 *
 * A "schematic" is an orthographic projection of the editable geometry of the
 * active file (the same `DirectGeometry` the 3D vertex editor shows). The
 * helpers here extract the source polygons/lines/welded-vertices from a
 * `DirectGeometry`, and provide the projection math used to turn scene-space
 * 3D points into the 2D canvas (and back) so vertex edits made in 2D stay in
 * the projected plane while the depth coordinate is preserved.
 *
 * Coordinates are scene space (LDraw with Y negated), matching `DirectGeometry`
 * and the 3D viewport. Nothing in this module touches the DOM.
 */

export interface VertexRef {
  lineNumber: number
  vertexIndex: number
}

/** Scene-space point. */
export interface ScPt {
  x: number
  y: number
  z: number
}

/**
 * One authored polygon (source type-3/4 line). Quads have been re-joined from
 * the two triangles the geometry builder emitted, so each polygon corresponds
 * to exactly one editable source line.
 */
export interface SchematicPoly {
  /** 1-based source line number in the active file. */
  line: number
  /** Resolved LDraw color code. */
  colorCode: number
  /** Scene-space corners in authored order. */
  verts: ScPt[]
}

/** A straight line segment from a type-2/type-5 source line. */
export interface SchematicEdge {
  a: ScPt
  b: ScPt
  colorCode: number
}

/** A welded vertex (a corner shared by several lines at one position). */
export interface WeldedVertex {
  /** Stable key derived from the position (`posKey`). */
  key: string
  pos: ScPt
  refs: VertexRef[]
}

export interface SchematicGeom {
  polys: SchematicPoly[]
  edges: SchematicEdge[]
  /** Welded vertex key → welded vertex (positions welded to ~0.001 LDU). */
  weld: Map<string, WeldedVertex>
  /** `${line}:${vertexIndex}` → welded key (mirrors the 3D vertex editor). */
  refToKey: Map<string, string>
  /** True when there is nothing editable to show. */
  empty: boolean
}

/** Stable key for a scene-space position, welded to ~0.001 LDU (scene convention). */
export function posKey(p: { x: number; y: number; z: number }): string {
  return `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}:${Math.round(p.z * 1000)}`
}

function pt(x: number, y: number, z: number): ScPt {
  return { x, y, z }
}

/**
 * Reconstruct authored polygons (tris and re-joined quads) from a
 * `DirectGeometry`. The builder emits one triangle per face with per-vertex
 * `(line, vertexIndex)` metadata; a quad yields two consecutive triangles
 * (indices 0,1,2 and 0,2,3), which we join back into a single 4-corner polygon
 * so outlines have no diagonal seam.
 */
export function reconstructPolys(direct: DirectGeometry): SchematicPoly[] {
  const polys: SchematicPoly[] = []
  // Geometry buffers are per-vertex (3 floats each); a triangle is 3
  // consecutive vertices. A single source line produces exactly one triangle
  // or one quad (two consecutive triangles), so grouping consecutive triangles
  // by source line recovers the authored polygons.
  const triCount = Math.round(direct.facePositions.length / 9)
  let t = 0
  while (t < triCount) {
    const baseVertex = t * 3
    const line = Math.round(direct.faceLineIndices[baseVertex] ?? 0)
    const colorCode = direct.faceColorCodes[baseVertex] ?? 16
    let t2 = t
    while (t2 < triCount && Math.round(direct.faceLineIndices[t2 * 3] ?? 0) === line) t2++

    const byIndex = new Map<number, ScPt>()
    let maxIndex = -1
    for (let tt = t; tt < t2; tt++) {
      for (let k = 0; k < 3; k++) {
        const vi = tt * 3 + k
        const index = Math.round(direct.faceVertexIndices[vi] ?? 0)
        byIndex.set(index, pt(direct.facePositions[vi * 3], direct.facePositions[vi * 3 + 1], direct.facePositions[vi * 3 + 2]))
        if (index > maxIndex) maxIndex = index
      }
    }
    const verts: ScPt[] = []
    for (let index = 0; index <= maxIndex; index++) {
      const p = byIndex.get(index)
      if (p) verts.push(p)
    }
    if (verts.length >= 3) polys.push({ line, colorCode, verts })
    t = t2
  }
  return polys
}

/** Extract type-2/type-5 edges as segments. */
export function reconstructEdges(direct: DirectGeometry): SchematicEdge[] {
  const edges: SchematicEdge[] = []
  const count = Math.round(direct.edgePositions.length / 3)
  for (let vi = 0; vi + 1 < count; vi += 2) {
    edges.push({
      a: pt(direct.edgePositions[vi * 3], direct.edgePositions[vi * 3 + 1], direct.edgePositions[vi * 3 + 2]),
      b: pt(direct.edgePositions[(vi + 1) * 3], direct.edgePositions[(vi + 1) * 3 + 1], direct.edgePositions[(vi + 1) * 3 + 2]),
      colorCode: direct.edgeColorCodes[vi] ?? 24,
    })
  }
  return edges
}

function addRef(
  weld: Map<string, WeldedVertex>,
  pos: ScPt,
  line: number,
  vertexIndex: number,
): void {
  const key = posKey(pos)
  let vertex = weld.get(key)
  if (!vertex) {
    vertex = { key, pos: { ...pos }, refs: [] }
    weld.set(key, vertex)
  }
  if (!vertex.refs.some((r) => r.lineNumber === line && r.vertexIndex === vertexIndex)) {
    vertex.refs.push({ lineNumber: line, vertexIndex })
  }
}

/** Welded vertex map from a `DirectGeometry` (faces + edges), scene convention. */
export function buildWeld(direct: DirectGeometry): Map<string, WeldedVertex> {
  const weld = new Map<string, WeldedVertex>()
  const faceCount = Math.round(direct.facePositions.length / 3)
  for (let vi = 0; vi < faceCount; vi++) {
    addRef(
      weld,
      pt(direct.facePositions[vi * 3], direct.facePositions[vi * 3 + 1], direct.facePositions[vi * 3 + 2]),
      Math.round(direct.faceLineIndices[vi] ?? 0),
      Math.round(direct.faceVertexIndices[vi] ?? 0),
    )
  }
  const edgeCount = Math.round(direct.edgePositions.length / 3)
  for (let vi = 0; vi < edgeCount; vi++) {
    addRef(
      weld,
      pt(direct.edgePositions[vi * 3], direct.edgePositions[vi * 3 + 1], direct.edgePositions[vi * 3 + 2]),
      Math.round(direct.edgeLineIndices[vi] ?? 0),
      Math.round(direct.edgeVertexIndices[vi] ?? 0),
    )
  }
  return weld
}

/** Build the complete schematic model from an editable `DirectGeometry`. */
export function buildSchematicGeom(direct: DirectGeometry): SchematicGeom {
  const polys = reconstructPolys(direct)
  const edges = reconstructEdges(direct)
  const weld = buildWeld(direct)
  const refToKey = new Map<string, string>()
  for (const vertex of weld.values()) {
    for (const ref of vertex.refs) {
      refToKey.set(`${ref.lineNumber}:${ref.vertexIndex}`, vertex.key)
    }
  }
  return {
    polys,
    edges,
    weld,
    refToKey,
    empty: polys.length === 0 && edges.length === 0,
  }
}

/* ------------------------------------------------------------------ */
/* Projections                                                         */
/* ------------------------------------------------------------------ */

export interface Projection {
  /** Screen-right axis (world). */
  u: ScPt
  /** Screen-up axis (world). */
  v: ScPt
  /** View direction (world), perpendicular to u and v. */
  n: ScPt
}

export type ViewId = 'front' | 'side' | 'top'

/**
 * The three principal orthographic views of the scene space (LDraw with Y
 * negated, so +Y is "up" on screen for front/side, and the stud-bearing top
 * face is at the largest Y).
 */
export function canonicalView(id: ViewId): Projection {
  switch (id) {
    case 'front': // XY plane, looking from +Z
      return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } }
    case 'side': // ZY plane
      return { u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: 1, z: 0 }, n: { x: -1, y: 0, z: 0 } }
    case 'top': // XZ plane, looking down from +Y (the stud-bearing side) onto -Y.
      return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, n: { x: 0, y: 1, z: 0 } }
  }
}

function normalize(p: ScPt): ScPt {
  const len = Math.hypot(p.x, p.y, p.z) || 1
  return { x: p.x / len, y: p.y / len, z: p.z / len }
}

function cross(a: ScPt, b: ScPt): ScPt {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function dot(a: ScPt, b: ScPt): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Orthonormal basis whose normal is `normal` (a face plane). The basis is
 * deterministic; `v` is chosen to lean toward world +Y where possible so the
 * focused surface reads "right side up".
 */
export function planeProjection(normal: ScPt): Projection {
  const n = normalize(normal)
  const worldUp: ScPt = { x: 0, y: 1, z: 0 }
  // Project worldUp onto the plane perpendicular to n.
  const dotNU = dot(n, worldUp)
  let vRaw: ScPt
  if (Math.abs(dotNU) < 0.99) {
    vRaw = { x: worldUp.x - n.x * dotNU, y: worldUp.y - n.y * dotNU, z: worldUp.z - n.z * dotNU }
  } else {
    // n is (near) vertical — fall back to +Z as the "up" hint.
    const zUp: ScPt = { x: 0, y: 0, z: 1 }
    const dotNZ = dot(n, zUp)
    vRaw = { x: zUp.x - n.x * dotNZ, y: zUp.y - n.y * dotNZ, z: zUp.z - n.z * dotNZ }
  }
  const v = normalize(vRaw)
  // u = v × n is perpendicular to both and gives a right-handed u,v,n screen.
  const u = normalize(cross(v, n))
  return { u, v, n }
}

/** Project a scene point onto a 2D basis. `d` is the depth along `n`. */
export function project(p: ScPt, proj: Projection): { u: number; v: number; d: number } {
  return { u: dot(p, proj.u), v: dot(p, proj.v), d: dot(p, proj.n) }
}

/** Rebuild a scene point from in-plane coordinates and a depth along `n`. */
export function pointFromUv(u: number, v: number, depth: number, proj: Projection): ScPt {
  return {
    x: proj.u.x * u + proj.v.x * v + proj.n.x * depth,
    y: proj.u.y * u + proj.v.y * v + proj.n.y * depth,
    z: proj.u.z * u + proj.v.z * v + proj.n.z * depth,
  }
}

/** Move `p` by an in-plane delta (du along u, dv along v), depth unchanged. */
export function moveInPlane(p: ScPt, du: number, dv: number, proj: Projection): ScPt {
  return pointFromUv(dot(p, proj.u) + du, dot(p, proj.v) + dv, dot(p, proj.n), proj)
}

/* ------------------------------------------------------------------ */
/* Polygon planes                                                      */
/* ------------------------------------------------------------------ */

const EPS_PLANE = 0.5

/** Newell normal of a polygon (not normalized), for robust planar faces. */
export function polyNormalRaw(poly: SchematicPoly): ScPt {
  const verts = poly.verts
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < verts.length; i++) {
    const cur = verts[i]
    const next = verts[(i + 1) % verts.length]
    nx += (cur.y - next.y) * (cur.z + next.z)
    ny += (cur.z - next.z) * (cur.x + next.x)
    nz += (cur.x - next.x) * (cur.y + next.y)
  }
  return { x: nx, y: ny, z: nz }
}

export function polyNormal(poly: SchematicPoly): ScPt {
  return normalize(polyNormalRaw(poly))
}

export function polyCentroid(poly: SchematicPoly): ScPt {
  let x = 0
  let y = 0
  let z = 0
  for (const p of poly.verts) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = poly.verts.length || 1
  return { x: x / n, y: y / n, z: z / n }
}

/** The plane of a polygon: a unit normal and the signed distance along it. */
export function planeOf(poly: SchematicPoly): { n: ScPt; d: number } {
  const n = polyNormal(poly)
  const c = polyCentroid(poly)
  return { n, d: dot(n, c) }
}

/** True when every corner of `poly` lies on the plane `(n, d)`. */
export function polyOnPlane(poly: SchematicPoly, n: ScPt, d: number, eps = EPS_PLANE): boolean {
  const nn = normalize(n)
  for (const p of poly.verts) {
    if (Math.abs(dot(nn, p) - d) > eps) return false
  }
  return true
}

/** Dominant (largest-magnitude) world axis of a normal, with its sign. */
export function dominantAxis(n: ScPt): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax >= ay && ax >= az) return { axis: 'x', sign: n.x < 0 ? -1 : 1 }
  if (ay >= az) return { axis: 'y', sign: n.y < 0 ? -1 : 1 }
  return { axis: 'z', sign: n.z < 0 ? -1 : 1 }
}

/** Human description of a plane, e.g. `+Y @ 24` or `plane 0.00,-0.71,0.71`. */
export function describePlane(n: ScPt, d: number, ref: ScPt): string {
  const nn = normalize(n)
  const { axis, sign } = dominantAxis(nn)
  // If the plane is axis-aligned, report the coordinate it sits at.
  const axisVal = ref[axis]
  if (Math.abs(dot(nn, ref) - d) < EPS_PLANE && Math.abs(nn[axis]) > 0.98) {
    const label = axis.toUpperCase()
    return `${sign > 0 ? '+' : '-'}${label} @ ${round4(axisVal)}`
  }
  return `plane ${round4(nn.x)},${round4(nn.y)},${round4(nn.z)} @ ${round4(d)}`
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

/* ------------------------------------------------------------------ */
/* Schematic modes & separated true-shape ("atlas") layout             */
/* ------------------------------------------------------------------ */

export type SchematicMode = 'full' | 'side' | 'plane'

/** A geometric plane grouping of polygons (coplanar within tolerance). */
export interface PlaneGroup {
  n: ScPt
  d: number
  polyIndices: number[]
  /** Sum of polygon areas (Newell magnitude), used to order the layout. */
  area: number
}

/** 2× polygon area = length of the Newell vector. */
function polyArea2(poly: SchematicPoly): number {
  const r = polyNormalRaw(poly)
  return Math.hypot(r.x, r.y, r.z)
}

/** Group polygons by the exact geometric plane they lie in. */
export function groupPolysByPlane(polys: SchematicPoly[]): PlaneGroup[] {
  const byKey = new Map<string, PlaneGroup>()
  for (let i = 0; i < polys.length; i++) {
    const { n, d } = planeOf(polys[i])
    const key = `${round4(n.x)}:${round4(n.y)}:${round4(n.z)}@${round4(d)}`
    let g = byKey.get(key)
    if (!g) {
      g = { n: { ...n }, d, polyIndices: [], area: 0 }
      byKey.set(key, g)
    }
    g.polyIndices.push(i)
    g.area += polyArea2(polys[i])
  }
  return [...byKey.values()]
}

/** Signed facing of a polygon toward `view` (+1 head-on, ~0 edge-on, −1 away). */
export function facingScore(poly: SchematicPoly, view: ScPt): number {
  return dot(polyNormal(poly), normalize(view))
}

/**
 * Choose which polygon indices a mode displays for a viewing direction:
 * - full:  every surface of the part.
 * - side:  surfaces facing the viewer, including ones rotated up to (but not
 *          quite) being another side — i.e. everything in the front hemisphere.
 * - plane: only the surfaces that are essentially head-on.
 */
export function selectPolysForMode(polys: SchematicPoly[], mode: SchematicMode, view: ScPt): number[] {
  const out: number[] = []
  for (let i = 0; i < polys.length; i++) {
    const f = facingScore(polys[i], view)
    if (mode === 'full') out.push(i)
    else if (mode === 'side') {
      if (f > 0.001) out.push(i)
    } else if (f > 0.95) {
      out.push(i)
    }
  }
  return out
}

export interface PlacedPlane {
  group: PlaneGroup
  /** In-plane axes used to draw this plane at its true shape. */
  basis: Projection
  minU: number
  maxU: number
  minV: number
  maxV: number
  /** Atlas top-left of the group's cell, in LDU (x right, y down). */
  x0: number
  y0: number
}

export interface AtlasLayout {
  placed: PlacedPlane[]
  /** Atlas extents in LDU. */
  width: number
  height: number
}

/**
 * Lay out each plane group at its true shape, separated from every other
 * group (an "atlas"). Each group keeps its own in-plane axes; all groups share
 * one LDU scale so relative sizes are correct and nothing overlaps.
 */
export function layoutAtlas(polys: SchematicPoly[], groups: PlaneGroup[], gapLdu = 14): AtlasLayout {
  const placed: PlacedPlane[] = groups.map((g) => {
    const basis = planeProjection(g.n)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const i of g.polyIndices) {
      for (const p of polys[i].verts) {
        const pr = project(p, basis)
        if (pr.u < minU) minU = pr.u
        if (pr.u > maxU) maxU = pr.u
        if (pr.v < minV) minV = pr.v
        if (pr.v > maxV) maxV = pr.v
      }
    }
    return { group: g, basis, minU, maxU, minV, maxV, x0: 0, y0: 0 }
  })

  // Shelf-packing, biggest plane first.
  placed.sort((a, b) => b.group.area - a.group.area)
  const totalCellArea = placed.reduce((s, p) => s + (p.maxU - p.minU + gapLdu) * (p.maxV - p.minV + gapLdu), 0)
  const maxCellW = Math.max(1, ...placed.map((p) => p.maxU - p.minU + gapLdu))
  const rowTarget = Math.max(maxCellW, Math.sqrt(totalCellArea) * 2)

  let x = 0
  let y = 0
  let rowW = 0
  let rowH = 0
  for (const p of placed) {
    const w = p.maxU - p.minU + gapLdu
    const h = p.maxV - p.minV + gapLdu
    if (rowW > 0 && rowW + w > rowTarget) {
      x = 0
      y += rowH
      rowW = 0
      rowH = 0
    }
    p.x0 = x
    p.y0 = y
    x += w
    rowW += w
    if (h > rowH) rowH = h
  }

  let width = 0
  let height = y + rowH
  for (const p of placed) {
    width = Math.max(width, p.x0 + (p.maxU - p.minU) + gapLdu)
    height = Math.max(height, p.y0 + (p.maxV - p.minV) + gapLdu)
  }
  return { placed, width, height }
}

/** In-plane (u,v) of a scene point for a placed plane, plus the atlas cell origin. */
export function planeLocal(p: ScPt, placed: PlacedPlane): { u: number; v: number } {
  const pr = project(p, placed.basis)
  return { u: pr.u - placed.minU, v: placed.maxV - pr.v }
}

/** Map a scene point to atlas coordinates (LDU) for a placed plane. */
export function toAtlas(p: ScPt, placed: PlacedPlane): { x: number; y: number } {
  const l = planeLocal(p, placed)
  return { x: placed.x0 + l.u, y: placed.y0 + l.v }
}

/** Scene point reconstructed from atlas coords (u right, v up within the plane). */
export function fromAtlasDelta(placed: PlacedPlane, du: number, dv: number): ScPt {
  // du/dv are in-plane deltas (u axis & v axis of the group's basis).
  return {
    x: placed.basis.u.x * du + placed.basis.v.x * dv,
    y: placed.basis.u.y * du + placed.basis.v.y * dv,
    z: placed.basis.u.z * du + placed.basis.v.z * dv,
  }
}

/** Rotate a vector about an axis by `angle` radians (Rodrigues). */
export function rotateAbout(v: ScPt, axis: ScPt, angle: number): ScPt {
  const a = normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dotA = dot(v, a)
  const c1 = 1 - c
  const rx = v.x * c + c1 * dotA * a.x + s * (a.y * v.z - a.z * v.y)
  const ry = v.y * c + c1 * dotA * a.y + s * (a.z * v.x - a.x * v.z)
  const rz = v.z * c + c1 * dotA * a.z + s * (a.x * v.y - a.y * v.x)
  return { x: rx, y: ry, z: rz }
}

/** Orbit a look direction by screen drag deltas (dx right, dy down). */
export function orbitView(view: ScPt, dx: number, dy: number, k = 0.006): ScPt {
  let v = normalize(view)
  const up: ScPt = { x: 0, y: 1, z: 0 }
  // Rotate horizontally about world up, then vertically about the side axis.
  v = rotateAbout(v, up, dx * k)
  const side = normalize(cross(v, up))
  if (Number.isFinite(side.x) && (Math.abs(side.x) + Math.abs(side.y) + Math.abs(side.z)) > 1e-9) {
    v = rotateAbout(v, side, -dy * k)
  }
  return normalize(v)
}

/** Axis presets for the side/plane orientation selector. */
export const VIEW_PRESETS: Array<{ label: string; view: ScPt }> = [
  { label: 'Front (+Z)', view: { x: 0, y: 0, z: 1 } },
  { label: 'Back (−Z)', view: { x: 0, y: 0, z: -1 } },
  { label: 'Right (+X)', view: { x: 1, y: 0, z: 0 } },
  { label: 'Left (−X)', view: { x: -1, y: 0, z: 0 } },
  { label: 'Top (+Y)', view: { x: 0, y: 1, z: 0 } },
  { label: 'Bottom (−Y)', view: { x: 0, y: -1, z: 0 } },
]

/** Short human label for an arbitrary look direction. */
export function viewLabel(view: ScPt): string {
  const v = normalize(view)
  const { axis, sign } = dominantAxis(v)
  if (Math.abs(v[axis]) > 0.995) {
    const map: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' }
    return `${sign > 0 ? '+' : '-'}${map[axis]}`
  }
  return `custom ${round4(v.x)},${round4(v.y)},${round4(v.z)}`
}

/* ------------------------------------------------------------------ */
/* Papercraft net unfold                                               */
/* ------------------------------------------------------------------ */

export interface Pt2 {
  x: number
  y: number
}

/** One face of an unfolded net, laid flat in the paper plane. */
export interface NetFace {
  /** Index into the polygon list passed to `unfoldPolys`. */
  polyIndex: number
  /** Paper (x, y) per polygon vertex, aligned with `polys[i].verts`. */
  pts: Pt2[]
}

export interface Net {
  faces: NetFace[]
  /** Paper extents in model units (x right, y down after normalisation). */
  width: number
  height: number
}

function dot2(a: Pt2, b: Pt2): number {
  return a.x * b.x + a.y * b.y
}

function cross2(a: Pt2, b: Pt2): number {
  return a.x * b.y - a.y * b.x
}

function pt2Avg(pts: Pt2[]): Pt2 {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  const n = pts.length || 1
  return { x: x / n, y: y / n }
}

/**
 * Unfold a set of polygons into a flat "papercraft" net: faces that share an
 * edge are kept attached and folded into a single 2D plane at their true
 * shape. Faces that share only a corner are NOT treated as attached. Disjoint
 * groups are laid out as separate components stacked below each other, so the
 * whole result never overlaps.
 */
export function unfoldPolys(polys: SchematicPoly[]): Net {
  const n = polys.length
  const cornerKeys = polys.map((p) => p.verts.map((v) => posKey(v)))
  // Face info: in-plane basis + local coordinates per corner.
  const info = polys.map((p, i) => {
    const basis = planeProjection(polyNormal(p))
    const local = p.verts.map((v) => {
      const pr = project(v, basis)
      return { x: pr.u, y: pr.v }
    })
    const idxByKey = new Map<string, number>()
    cornerKeys[i].forEach((k, c) => idxByKey.set(k, c))
    return { basis, local, idxByKey }
  })
  // Adjacency: two polygons share an edge when they share >= 2 corner keys.
  const adj: number[][] = polys.map(() => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const setJ = new Set(cornerKeys[j])
      let shared = 0
      for (const k of cornerKeys[i]) if (setJ.has(k)) shared++
      if (shared >= 2) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }

  const paper: Pt2[][] = []
  const ptsByKey: Map<string, Pt2>[] = []
  const placed = new Array<boolean>(n).fill(false)
  const placedSet = new Set<number>()

  function placeComponent(root: number): void {
    // Seed the component with the root face (its own plane axes).
    placed[root] = true
    placedSet.add(root)
    paper[root] = info[root].local.map((p) => ({ x: p.x, y: p.y }))
    const mb = new Map<string, Pt2>()
    cornerKeys[root].forEach((k, c) => mb.set(k, paper[root][c]))
    ptsByKey[root] = mb

    const queue = [root]
    while (queue.length > 0) {
      const parent = queue.shift()!
      for (const child of adj[parent]) {
        if (placed[child]) continue
        const shared = cornerKeys[parent].filter((k) => cornerKeys[child].includes(k))
        if (shared.length < 2) continue
        const ka = shared[0]
        const kb = shared[1]
        const aPap = ptsByKey[parent].get(ka)!
        const bPap = ptsByKey[parent].get(kb)!
        const aLoc = info[child].local[info[child].idxByKey.get(ka)!]
        const bLoc = info[child].local[info[child].idxByKey.get(kb)!]

        // Edge frames.
        const dLoc = { x: bLoc.x - aLoc.x, y: bLoc.y - aLoc.y }
        const dPap = { x: bPap.x - aPap.x, y: bPap.y - aPap.y }
        const lLoc = Math.hypot(dLoc.x, dLoc.y) || 1e-9
        const lPap = Math.hypot(dPap.x, dPap.y) || 1e-9
        const e1Loc = { x: dLoc.x / lLoc, y: dLoc.y / lLoc }
        const e1Pap = { x: dPap.x / lPap, y: dPap.y / lPap }
        const e2Loc = { x: -e1Loc.y, y: e1Loc.x } // CCW perpendicular
        const perpPap = { x: -e1Pap.y, y: e1Pap.x }

        // Fold so the child lands on the opposite side of the edge from its
        // parent (a clean, non-overlapping unfold).
        const parentCentre = pt2Avg(paper[parent])
        const parentSide = cross2(e1Pap, { x: parentCentre.x - aPap.x, y: parentCentre.y - aPap.y })
        const childCentreRel = pt2Avg(info[child].local)
        const relU = childCentreRel.x - aLoc.x
        const relV = childCentreRel.y - aLoc.y
        const locSide = cross2(e1Loc, { x: relU, y: relV })
        let orient = 1
        if (Math.abs(parentSide) > 1e-9 && Math.abs(locSide) > 1e-9) {
          orient = -(Math.sign(parentSide) * Math.sign(locSide))
        } else {
          orient = -1 // degenerate: default to folded-over
        }

        const mapPt = (p: Pt2): Pt2 => {
          const r = { x: p.x - aLoc.x, y: p.y - aLoc.y }
          const u = dot2(r, e1Loc)
          const v = dot2(r, e2Loc)
          return {
            x: aPap.x + u * e1Pap.x + orient * v * perpPap.x,
            y: aPap.y + u * e1Pap.y + orient * v * perpPap.y,
          }
        }
        const childPts = info[child].local.map(mapPt)
        placed[child] = true
        placedSet.add(child)
        paper[child] = childPts
        const cmb = new Map<string, Pt2>()
        cornerKeys[child].forEach((k, c) => cmb.set(k, childPts[c]))
        ptsByKey[child] = cmb
        queue.push(child)
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!placed[i]) placeComponent(i)
  }

  // Re-derive connected components (via shared edges) so we can lay each net
  // out without overlap, stacked side by side.
  const components: number[][] = []
  const seen = new Set<number>()
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue
    const stack = [i]
    const group: number[] = []
    seen.add(i)
    while (stack.length > 0) {
      const cur = stack.pop()!
      group.push(cur)
      for (const nx of adj[cur]) {
        if (!seen.has(nx)) {
          seen.add(nx)
          stack.push(nx)
        }
      }
    }
    components.push(group)
  }

  const rowGap = 24
  let cursorX = 0
  let cursorY = 0
  let rowH = 0
  for (const group of components) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const i of group) {
      for (const p of paper[i]) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }
    // Wrap to a new row when this component would overflow a ~600-unit row.
    const w = Math.max(maxX - minX, 0)
    const h = Math.max(maxY - minY, 0)
    if (cursorX > 0 && cursorX + w > 600) {
      cursorX = 0
      cursorY += rowH + rowGap
      rowH = 0
    }
    for (const i of group) {
      paper[i] = paper[i].map((p) => ({ x: p.x - minX + cursorX, y: p.y - minY + cursorY }))
    }
    cursorX += w + rowGap
    if (h > rowH) rowH = h
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    for (const p of paper[i]) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  const faces: NetFace[] = []
  for (let i = 0; i < n; i++) {
    faces.push({ polyIndex: i, pts: paper[i].map((p) => ({ x: p.x - minX, y: p.y - minY })) })
  }
  return { faces, width: Math.max(maxX - minX, 0), height: Math.max(maxY - minY, 0) }
}
