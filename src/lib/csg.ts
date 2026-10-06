import type { Vec3 } from '../core'

/**
 * Constructive solid geometry (CSG) — a small BSP boolean engine over colored
 * triangle/quad polygons.
 *
 * Used by the punch (hole) and erase tools to subtract shapes from flattened
 * part geometry. Inputs are polygon soups; outputs are triangle soups, ready
 * to be written back as LDraw type-3 lines.
 *
 * The engine is pure TypeScript (no DOM / no Three.js) so it is fully
 * unit-testable. It follows the classic BSP CSG algorithm: each solid is a
 * BSP tree; boolean ops are implemented as tree clipping + inversion.
 */

export const CSG_EPS = 1e-6

export interface CsgPlane {
  /** Unit normal. */
  normal: Vec3
  /** Plane offset: `normal · p = w`. */
  w: number
}

export interface CsgPolygon {
  vertices: Vec3[]
  normal: Vec3
  w: number
  /** LDraw color code carried through booleans. */
  color: number
}

export interface CsgSolid {
  polygons: CsgPolygon[]
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalized(v: Vec3): Vec3 {
  const len = length(v)
  if (len === 0) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** A polygon plane from its first three vertices (right-hand rule). */
export function polygonFromVertices(vertices: Vec3[], color: number): CsgPolygon {
  const normal = normalized(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])))
  return { vertices, normal, w: dot(normal, vertices[0]), color }
}

export function solidFromPolygons(polygons: CsgPolygon[]): CsgSolid {
  return { polygons }
}

/** Build a solid from a triangle soup (3 position floats + 1 color code per vertex). */
export function solidFromTriangles(positions: number[], colorCodes: number[]): CsgSolid {
  const polygons: CsgPolygon[] = []
  for (let i = 0; i + 9 <= positions.length; i += 9) {
    const color = colorCodes[i / 3] ?? 16
    polygons.push(
      polygonFromVertices(
        [
          { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
          { x: positions[i + 3], y: positions[i + 4], z: positions[i + 5] },
          { x: positions[i + 6], y: positions[i + 7], z: positions[i + 8] },
        ],
        color,
      ),
    )
  }
  return { polygons }
}

/** Flatten a solid into a triangle soup (fan-triangulating any polygons). */
export function solidToTriangles(solid: CsgSolid): { positions: number[]; colorCodes: number[] } {
  const positions: number[] = []
  const colorCodes: number[] = []
  for (const poly of solid.polygons) {
    if (poly.vertices.length < 3) continue
    const base = poly.vertices[0]
    for (let i = 1; i + 1 < poly.vertices.length; i++) {
      const a = poly.vertices[i]
      const b = poly.vertices[i + 1]
      positions.push(base.x, base.y, base.z, a.x, a.y, a.z, b.x, b.y, b.z)
      colorCodes.push(poly.color, poly.color, poly.color)
    }
  }
  return { positions, colorCodes }
}

/* ----------------------------- BSP machinery ----------------------------- */

interface BspNode {
  plane: CsgPlane | null
  front: BspNode | null
  back: BspNode | null
  polygons: CsgPolygon[]
}

function newNode(): BspNode {
  return { plane: null, front: null, back: null, polygons: [] }
}

interface PolygonSplit {
  coplanarFront: CsgPolygon[]
  coplanarBack: CsgPolygon[]
  front: CsgPolygon[]
  back: CsgPolygon[]
}

function flipPolygon(poly: CsgPolygon): CsgPolygon {
  const vertices = poly.vertices.slice().reverse()
  return polygonFromVertices(vertices, poly.color)
}

function flipPlane(plane: CsgPlane): CsgPlane {
  return { normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }, w: -plane.w }
}

/**
 * Split a convex polygon against a plane. The polygon is classified as
 * coplanar-front, coplanar-back, front, back, or spanning (in which case it is
 * split into a front and a back piece).
 */
function splitPolygon(plane: CsgPlane, poly: CsgPolygon): PolygonSplit {
  const result: PolygonSplit = { coplanarFront: [], coplanarBack: [], front: [], back: [] }
  const dists = poly.vertices.map((v) => dot(plane.normal, v) - plane.w)

  let frontCount = 0
  let backCount = 0
  for (const d of dists) {
    if (d > CSG_EPS) frontCount++
    else if (d < -CSG_EPS) backCount++
  }

  if (frontCount === 0 && backCount === 0) {
    // Coplanar: keep orientation relative to the splitting plane.
    if (dot(plane.normal, poly.normal) >= 0) result.coplanarFront.push(poly)
    else result.coplanarBack.push(poly)
    return result
  }
  if (backCount === 0) {
    result.front.push(poly)
    return result
  }
  if (frontCount === 0) {
    result.back.push(poly)
    return result
  }

  // Spanning: clip into a front piece and a back piece.
  const frontVerts: Vec3[] = []
  const backVerts: Vec3[] = []
  for (let i = 0; i < poly.vertices.length; i++) {
    const j = (i + 1) % poly.vertices.length
    const di = dists[i]
    const dj = dists[j]
    if (di >= -CSG_EPS) frontVerts.push(poly.vertices[i])
    if (di <= CSG_EPS) backVerts.push(poly.vertices[i])
    if ((di > CSG_EPS && dj < -CSG_EPS) || (di < -CSG_EPS && dj > CSG_EPS)) {
      const denom = dot(plane.normal, sub(poly.vertices[j], poly.vertices[i]))
      const t = denom === 0 ? 0 : (plane.w - dot(plane.normal, poly.vertices[i])) / denom
      const v = lerp(poly.vertices[i], poly.vertices[j], t)
      frontVerts.push(v)
      backVerts.push(v)
    }
  }
  if (frontVerts.length >= 3) result.front.push(polygonFromVertices(frontVerts, poly.color))
  if (backVerts.length >= 3) result.back.push(polygonFromVertices(backVerts, poly.color))
  return result
}

function build(node: BspNode, polygons: CsgPolygon[]): void {
  if (polygons.length === 0) return
  if (!node.plane) node.plane = { normal: { ...polygons[0].normal }, w: polygons[0].w }
  const plane = node.plane
  const front: CsgPolygon[] = []
  const back: CsgPolygon[] = []
  for (const poly of polygons) {
    const s = splitPolygon(plane, poly)
    node.polygons.push(...s.coplanarFront, ...s.coplanarBack)
    front.push(...s.front)
    back.push(...s.back)
  }
  if (front.length > 0) {
    if (!node.front) node.front = newNode()
    build(node.front, front)
  }
  if (back.length > 0) {
    if (!node.back) node.back = newNode()
    build(node.back, back)
  }
}

function invert(node: BspNode): void {
  for (let i = 0; i < node.polygons.length; i++) node.polygons[i] = flipPolygon(node.polygons[i])
  if (node.plane) node.plane = flipPlane(node.plane)
  if (node.front) invert(node.front)
  if (node.back) invert(node.back)
  const tmp = node.front
  node.front = node.back
  node.back = tmp
}

function allPolygons(node: BspNode | null): CsgPolygon[] {
  if (!node) return []
  let polygons = node.polygons.slice()
  if (node.front) polygons = polygons.concat(allPolygons(node.front))
  if (node.back) polygons = polygons.concat(allPolygons(node.back))
  return polygons
}

/** Clip a set of polygons against a BSP tree, keeping the parts inside it. */
function clipPolygons(polygons: CsgPolygon[], node: BspNode | null): CsgPolygon[] {
  if (!node || !node.plane) return polygons.slice()
  let front: CsgPolygon[] = []
  let back: CsgPolygon[] = []
  for (const poly of polygons) {
    const s = splitPolygon(node.plane, poly)
    front = front.concat(s.coplanarFront, s.front)
    back = back.concat(s.coplanarBack, s.back)
  }
  if (node.front) front = clipPolygons(front, node.front)
  if (node.back) back = clipPolygons(back, node.back)
  else back = []
  return front.concat(back)
}

function clipTo(node: BspNode, other: BspNode | null): void {
  node.polygons = clipPolygons(node.polygons, other)
  if (node.front) clipTo(node.front, other)
  if (node.back) clipTo(node.back, other)
}

function csgFromNode(node: BspNode | null): CsgSolid {
  return { polygons: allPolygons(node) }
}

/* ------------------------------ boolean ops ------------------------------ */

function clonePolygons(polygons: CsgPolygon[]): CsgPolygon[] {
  return polygons.map((p) => ({ ...p, normal: { ...p.normal }, vertices: p.vertices.map((v) => ({ ...v })) }))
}

function unionSolids(a: CsgSolid, b: CsgSolid): CsgSolid {
  const aTree = newNode()
  build(aTree, clonePolygons(a.polygons))
  const bTree = newNode()
  build(bTree, clonePolygons(b.polygons))
  clipTo(aTree, bTree)
  clipTo(bTree, aTree)
  invert(bTree)
  clipTo(bTree, aTree)
  invert(bTree)
  build(aTree, allPolygons(bTree))
  return csgFromNode(aTree)
}

function subtractSolids(a: CsgSolid, b: CsgSolid): CsgSolid {
  const aTree = newNode()
  build(aTree, clonePolygons(a.polygons))
  const bTree = newNode()
  build(bTree, clonePolygons(b.polygons))
  invert(aTree)
  clipTo(aTree, bTree)
  clipTo(bTree, aTree)
  invert(bTree)
  clipTo(bTree, aTree)
  invert(bTree)
  build(aTree, allPolygons(bTree))
  invert(aTree)
  return csgFromNode(aTree)
}

function intersectSolids(a: CsgSolid, b: CsgSolid): CsgSolid {
  const aTree = newNode()
  build(aTree, clonePolygons(a.polygons))
  const bTree = newNode()
  build(bTree, clonePolygons(b.polygons))
  invert(aTree)
  clipTo(bTree, aTree)
  invert(bTree)
  clipTo(aTree, bTree)
  clipTo(bTree, aTree)
  build(aTree, allPolygons(bTree))
  invert(aTree)
  return csgFromNode(aTree)
}

export function cloneSolid(solid: CsgSolid): CsgSolid {
  return { polygons: clonePolygons(solid.polygons) }
}

export const union = unionSolids
export const subtract = subtractSolids
export const intersect = intersectSolids

/* ------------------------------ shape makers ------------------------------ */

/**
 * Orient every polygon so its normal points away from `center` (a convex
 * solid's centroid). Makes the generators robust regardless of how each face's
 * vertex order was authored.
 */
function orientOutward(polygons: CsgPolygon[], center: Vec3): void {
  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i]
    const centroid: Vec3 = { x: 0, y: 0, z: 0 }
    for (const v of poly.vertices) {
      centroid.x += v.x
      centroid.y += v.y
      centroid.z += v.z
    }
    centroid.x /= poly.vertices.length
    centroid.y /= poly.vertices.length
    centroid.z /= poly.vertices.length
    const outward = sub(centroid, center)
    if (dot(poly.normal, outward) < 0) {
      polygons[i] = polygonFromVertices(poly.vertices.slice().reverse(), poly.color)
    }
  }
}

/** An axis-aligned box solid spanning `min`..`max` (scene space, +Y up). */
export function boxSolid(min: Vec3, max: Vec3, color = 16): CsgSolid {
  const corners: Vec3[] = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ]
  const faces = [
    [1, 2, 6, 5], // +X (x = max)
    [0, 3, 7, 4], // -X (x = min)
    [2, 3, 7, 6], // +Y (y = max)
    [0, 1, 5, 4], // -Y (y = min)
    [4, 5, 6, 7], // +Z (z = max)
    [0, 1, 2, 3], // -Z (z = min)
  ]
  const polygons = faces.map((quad) => polygonFromVertices(quad.map((i) => corners[i]), color))
  orientOutward(polygons, {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  })
  return { polygons }
}

/** A cylinder along the Y axis, centered at `center`, height `height`. */
export function cylinderSolid(center: Vec3, radius: number, height: number, segments = 24, color = 16): CsgSolid {
  const polygons: CsgPolygon[] = []
  const topY = center.y + height / 2
  const bottomY = center.y - height / 2

  const ring = (y: number): Vec3[] => {
    const pts: Vec3[] = []
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      pts.push({ x: center.x + radius * Math.cos(angle), y, z: center.z + radius * Math.sin(angle) })
    }
    return pts
  }

  const top = ring(topY)
  const bottom = ring(bottomY)

  // Side wall.
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    polygons.push(polygonFromVertices([top[i], bottom[i], bottom[j], top[j]], color))
  }
  // Caps.
  polygons.push(polygonFromVertices([...top].reverse(), color))
  polygons.push(polygonFromVertices(bottom, color))

  orientOutward(polygons, center)
  return { polygons }
}
