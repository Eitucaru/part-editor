import { describe, it, expect } from 'vitest'
import type { DirectGeometry } from './geometry-builder'
import {
  buildSchematicGeom,
  canonicalView,
  describePlane,
  dominantAxis,
  moveInPlane,
  planeOf,
  planeProjection,
  polyOnPlane,
  posKey,
  project,
  reconstructEdges,
  reconstructPolys,
} from './schematic'

/** Build a DirectGeometry from authored (line, color) faces in scene coords. */
function directOf(faces: Array<{ line: number; color: number; verts: number[][] }>): DirectGeometry {
  const d: DirectGeometry = {
    facePositions: [],
    faceColors: [],
    faceColorCodes: [],
    faceLineIndices: [],
    faceVertexIndices: [],
    edgePositions: [],
    edgeColors: [],
    edgeColorCodes: [],
    edgeLineIndices: [],
    edgeVertexIndices: [],
  }
  for (const face of faces) {
    // Emulate the builder: a quad becomes two triangles (0,1,2) and (0,2,3).
    const v = face.verts
    const tris: Array<Array<{ p: number[]; i: number }>> =
      v.length === 4
        ? [
            [0, 1, 2],
            [0, 2, 3],
          ].map((idx) => idx.map((i) => ({ p: v[i], i })))
        : [[0, 1, 2].map((i) => ({ p: v[i], i }))]
    for (const tri of tris) {
      for (const { p, i } of tri) {
        d.facePositions.push(p[0], p[1], p[2])
        d.faceColorCodes.push(face.color)
        d.faceColors.push(0, 0, 0)
        d.faceLineIndices.push(face.line)
        d.faceVertexIndices.push(i)
      }
    }
  }
  return d
}

function directWithEdges(
  faces: Array<{ line: number; color: number; verts: number[][] }>,
  edges: Array<{ line: number; color: number; a: number[]; b: number[] }>,
): DirectGeometry {
  const d = directOf(faces)
  for (const e of edges) {
    for (const p of [e.a, e.b]) d.edgePositions.push(p[0], p[1], p[2])
    d.edgeColorCodes.push(e.color, e.color)
    d.edgeColors.push(0, 0, 0, 0, 0, 0)
    d.edgeLineIndices.push(e.line, e.line)
    d.edgeVertexIndices.push(0, 1)
  }
  return d
}

describe('reconstructPolys', () => {
  it('re-joins a quad (two triangles) into one 4-corner polygon in authored order', () => {
    const a = [0, 0, 0]
    const b = [10, 0, 0]
    const c = [10, 0, 10]
    const dd = [0, 0, 10]
    const geom = directOf([{ line: 12, color: 4, verts: [a, b, c, dd] }])
    const polys = reconstructPolys(geom)
    expect(polys).toHaveLength(1)
    expect(polys[0].line).toBe(12)
    expect(polys[0].colorCode).toBe(4)
    expect(polys[0].verts).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
      { x: 0, y: 0, z: 10 },
    ])
  })

  it('keeps a triangle as a 3-corner polygon', () => {
    const geom = directOf([{ line: 8, color: 16, verts: [[0, 0, 0], [4, 0, 0], [0, 4, 0]] }])
    const polys = reconstructPolys(geom)
    expect(polys).toHaveLength(1)
    expect(polys[0].verts).toHaveLength(3)
  })

  it('produces one polygon per source line', () => {
    const geom = directOf([
      { line: 1, color: 4, verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { line: 2, color: 4, verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    ])
    expect(reconstructPolys(geom)).toHaveLength(2)
  })
})

describe('reconstructEdges', () => {
  it('turns pairs of edge vertices into segments', () => {
    const geom = directWithEdges(
      [],
      [{ line: 20, color: 24, a: [0, 0, 0], b: [10, 0, 0] }],
    )
    const edges = reconstructEdges(geom)
    expect(edges).toHaveLength(1)
    expect(edges[0].a).toEqual({ x: 0, y: 0, z: 0 })
    expect(edges[0].b).toEqual({ x: 10, y: 0, z: 0 })
  })
})

describe('weld / buildSchematicGeom', () => {
  it('welds corners shared by a face and an edge into one vertex with both refs', () => {
    const a = [0, 0, 0]
    const b = [10, 0, 0]
    const c = [10, 0, 10]
    const dd = [0, 0, 10]
    const geom = directWithEdges(
      [{ line: 10, color: 4, verts: [a, b, c, dd] }],
      [{ line: 20, color: 24, a, b }],
    )
    const g = buildSchematicGeom(geom)
    const aKey = posKey({ x: 0, y: 0, z: 0 })
    const vertex = g.weld.get(aKey)
    expect(vertex).toBeDefined()
    expect(vertex!.refs).toEqual([
      { lineNumber: 10, vertexIndex: 0 },
      { lineNumber: 20, vertexIndex: 0 },
    ])
    // ref → key lookup matches the 3D convention.
    expect(g.refToKey.get('10:0')).toBe(aKey)
    expect(g.refToKey.get('20:0')).toBe(aKey)
    expect(g.refToKey.get('10:1')).toBe(posKey({ x: 10, y: 0, z: 0 }))
    expect(g.weld.size).toBe(4)
  })

  it('reports empty when there is no geometry', () => {
    const g = buildSchematicGeom(directOf([]))
    expect(g.empty).toBe(true)
  })
})

describe('projections', () => {
  it('front projects onto X/Y with depth +Z', () => {
    const p = project({ x: 1, y: 2, z: 3 }, canonicalView('front'))
    expect(p).toEqual({ u: 1, v: 2, d: 3 })
  })
  it('side projects onto Z/Y', () => {
    const p = project({ x: 1, y: 2, z: 3 }, canonicalView('side'))
    expect(p.u).toBe(3)
    expect(p.v).toBe(2)
    expect(p.d).toBe(-1)
  })
  it('top projects onto X/Z', () => {
    const p = project({ x: 1, y: 2, z: 3 }, canonicalView('top'))
    expect(p.u).toBe(1)
    expect(p.v).toBe(-3)
    expect(p.d).toBe(2)
  })

  it('planeProjection builds an orthonormal basis perpendicular to the normal', () => {
    const proj = planeProjection({ x: 0, y: 1, z: 0 })
    const norm = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z)
    expect(norm(proj.n)).toBeCloseTo(1, 6)
    expect(proj.u.x * proj.n.x + proj.u.y * proj.n.y + proj.u.z * proj.n.z).toBeCloseTo(0, 6)
    expect(proj.v.x * proj.n.x + proj.v.y * proj.n.y + proj.v.z * proj.n.z).toBeCloseTo(0, 6)
    expect(proj.u.x * proj.v.x + proj.u.y * proj.v.y + proj.u.z * proj.v.z).toBeCloseTo(0, 6)
    // A sloped normal is handled too.
    const sloped = planeProjection({ x: 1, y: -1, z: 0 })
    expect(Math.hypot(sloped.u.x, sloped.u.y, sloped.u.z)).toBeCloseTo(1, 6)
    expect(Math.hypot(sloped.v.x, sloped.v.y, sloped.v.z)).toBeCloseTo(1, 6)
  })

  it('pointFromUv/moveInPlane round-trip through a projection and keep depth', () => {
    const proj = canonicalView('front')
    const p = { x: 1, y: 2, z: 3 }
    const moved = moveInPlane(p, 2, -1, proj)
    expect(moved).toEqual({ x: 3, y: 1, z: 3 })
    expect(project(moved, proj)).toEqual({ u: 3, v: 1, d: 3 })
  })
})

describe('polygon planes', () => {
  const topPoly = { line: 1, colorCode: 4, verts: [{ x: 0, y: 24, z: 0 }, { x: 20, y: 24, z: 0 }, { x: 20, y: 24, z: 20 }, { x: 0, y: 24, z: 20 }] }
  const sidePoly = { line: 2, colorCode: 4, verts: [{ x: 20, y: 0, z: 0 }, { x: 20, y: 0, z: 20 }, { x: 20, y: 24, z: 20 }, { x: 20, y: 24, z: 0 }] }

  it('computes an axis-aligned plane for the top face', () => {
    const { n, d } = planeOf(topPoly)
    expect(Math.abs(n.y)).toBeCloseTo(1, 6)
    expect(d).toBeCloseTo(24 * Math.sign(n.y), 6)
    expect(dominantAxis(n)).toEqual({ axis: 'y', sign: n.y < 0 ? -1 : 1 })
  })

  it('recognizes coplanar polygons and rejects off-plane ones', () => {
    const { n, d } = planeOf(topPoly)
    expect(polyOnPlane(topPoly, n, d)).toBe(true)
    expect(polyOnPlane(sidePoly, n, d)).toBe(false)
    // A polygon in the same geometric plane (e.g. an inner pad at y=24) counts.
    const pad = { line: 3, colorCode: 4, verts: [{ x: 4, y: 24, z: 4 }, { x: 6, y: 24, z: 4 }, { x: 6, y: 24, z: 6 }, { x: 4, y: 24, z: 6 }] }
    expect(polyOnPlane(pad, n, d)).toBe(true)
  })

  it('describes an axis plane by its coordinate', () => {
    expect(describePlane({ x: 0, y: 1, z: 0 }, 24, { x: 10, y: 24, z: 10 })).toBe('+Y @ 24')
    expect(describePlane({ x: 1, y: 0, z: 0 }, -20, { x: -20, y: 5, z: 5 })).toBe('+X @ -20')
  })
})
