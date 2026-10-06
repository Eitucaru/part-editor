import { describe, it, expect } from 'vitest'
import type { SchematicPoly, ScPt } from './schematic'
import {
  facingScore,
  fromAtlasDelta,
  groupPolysByPlane,
  layoutAtlas,
  orbitView,
  polyNormal,
  posKey,
  selectPolysForMode,
  unfoldPolys,
  viewLabel,
} from './schematic'

/** Local Newell normal so tests don't depend on the lib's own helper. */
function rawNewell(poly: SchematicPoly): ScPt {
  const vs = poly.verts
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i]
    const b = vs[(i + 1) % vs.length]
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return { x: nx, y: ny, z: nz }
}

function faceAt(corners: ScPt[], outward: ScPt, line: number): SchematicPoly {
  const poly: SchematicPoly = { line, colorCode: 4, verts: corners }
  const n = rawNewell(poly)
  const d = n.x * outward.x + n.y * outward.y + n.z * outward.z
  return d < 0 ? { ...poly, verts: [...corners].reverse() } : poly
}

/** Build a half=10 cube centred at the origin with outward-facing faces. */
function cube(): SchematicPoly[] {
  const h = 10
  const v = (x: number, y: number, z: number): ScPt => ({ x, y, z })
  return [
    faceAt([v(h, -h, -h), v(h, -h, h), v(h, h, h), v(h, h, -h)], { x: 1, y: 0, z: 0 }, 1),
    faceAt([v(-h, -h, h), v(-h, -h, -h), v(-h, h, -h), v(-h, h, h)], { x: -1, y: 0, z: 0 }, 2),
    faceAt([v(-h, h, -h), v(h, h, -h), v(h, h, h), v(-h, h, h)], { x: 0, y: 1, z: 0 }, 3),
    faceAt([v(-h, -h, h), v(h, -h, h), v(h, -h, -h), v(-h, -h, -h)], { x: 0, y: -1, z: 0 }, 4),
    faceAt([v(-h, -h, h), v(h, -h, h), v(h, h, h), v(-h, h, h)], { x: 0, y: 0, z: 1 }, 5),
    faceAt([v(h, -h, -h), v(-h, -h, -h), v(-h, h, -h), v(h, h, -h)], { x: 0, y: 0, z: -1 }, 6),
  ]
}

describe('groupPolysByPlane', () => {
  it('groups the six faces of a cube into six distinct planes', () => {
    const faces = cube()
    const groups = groupPolysByPlane(faces)
    expect(groups).toHaveLength(6)
    for (const g of groups) {
      expect(g.polyIndices).toHaveLength(1)
      expect(g.area).toBeGreaterThan(0)
    }
    // Every face normal points along exactly one axis.
    for (const g of groups) {
      const ax = Math.abs(g.n.x) + Math.abs(g.n.y) + Math.abs(g.n.z)
      expect(ax).toBeCloseTo(1, 6)
    }
  })
})

describe('selectPolysForMode / facingScore', () => {
  const faces = cube()

  it('full selects every surface', () => {
    expect(selectPolysForMode(faces, 'full', { x: 0, y: 0, z: 1 })).toHaveLength(6)
  })

  it('side from +Z keeps only surfaces facing +Z', () => {
    const idx = selectPolysForMode(faces, 'side', { x: 0, y: 0, z: 1 })
    expect(idx).toHaveLength(1)
    const n = polyNormal(faces[idx[0]])
    expect(n.z).toBeCloseTo(1, 6)
  })

  it('side from a diagonal includes the two surfaces rotated up to another side', () => {
    const k = 1 / Math.sqrt(2)
    const idx = selectPolysForMode(faces, 'side', { x: k, y: k, z: 0 })
    expect(idx).toHaveLength(2)
  })

  it('plane from +Z keeps the head-on surface only', () => {
    const idx = selectPolysForMode(faces, 'plane', { x: 0, y: 0, z: 1 })
    expect(idx).toHaveLength(1)
    expect(facingScore(faces[idx[0]], { x: 0, y: 0, z: 1 })).toBeGreaterThan(0.95)
  })

  it('plane from a diagonal has no perfectly head-on surface', () => {
    const k = 1 / Math.sqrt(2)
    expect(selectPolysForMode(faces, 'plane', { x: k, y: k, z: 0 })).toHaveLength(0)
  })
})

describe('layoutAtlas / fromAtlasDelta', () => {
  const faces = cube()

  it('lays each cube face at true shape, separated without overlap', () => {
    const groups = groupPolysByPlane(faces)
    const layout = layoutAtlas(faces, groups, 8)
    expect(layout.placed).toHaveLength(6)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    // No two placed cells overlap.
    for (let i = 0; i < layout.placed.length; i++) {
      const a = layout.placed[i]
      expect(a.maxU - a.minU).toBeCloseTo(20, 6)
      expect(a.maxV - a.minV).toBeCloseTo(20, 6)
      for (let j = i + 1; j < layout.placed.length; j++) {
        const b = layout.placed[j]
        const overlapsX = a.x0 < b.x0 + (b.maxU - b.minU) && b.x0 < a.x0 + (a.maxU - a.minU)
        const overlapsY = a.y0 < b.y0 + (b.maxV - b.minV) && b.y0 < a.y0 + (a.maxV - a.minV)
        expect(overlapsX && overlapsY).toBe(false)
      }
    }
  })

  it('round-trips an in-plane delta back to a scene-space displacement', () => {
    const groups = groupPolysByPlane(faces)
    const layout = layoutAtlas(faces, groups, 8)
    const g = layout.placed.find((p) => Math.abs(p.basis.n.z) > 0.9)!
    const d = fromAtlasDelta(g, 3, 4)
    // Moving 3 along u, 4 along v must stay inside the +Z plane (no z change).
    expect(d.z).toBeCloseTo(0, 6)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(5, 6)
  })
})

describe('orbitView / viewLabel', () => {
  it('keeps the direction unit length and rotates it', () => {
    const out = orbitView({ x: 0, y: 0, z: 1 }, 20, 10)
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6)
    expect(Math.abs(out.x) + Math.abs(out.z)).toBeGreaterThan(0)
  })

  it('labels the six axis presets', () => {
    expect(viewLabel({ x: 0, y: 0, z: 1 })).toBe('+Z')
    expect(viewLabel({ x: 0, y: 1, z: 0 })).toBe('+Y')
  })
})

describe('unfoldPolys (papercraft net)', () => {
  it('unfolds the six faces of a cube into a connected flat net, preserving face shapes', () => {
    const faces = cube()
    const net = unfoldPolys(faces)
    expect(net.faces).toHaveLength(6)
    for (const f of net.faces) {
      expect(f.pts).toHaveLength(4)
      // Every edge stays 20 units long and every corner stays a right angle.
      for (let c = 0; c < 4; c++) {
        const a = f.pts[c]
        const b = f.pts[(c + 1) % 4]
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 3)
      }
      const a = f.pts[0]
      const c = f.pts[2]
      expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(Math.sqrt(800), 3)
    }
    // Adjacent cube faces coincide along the (5) edges kept by the spanning
    // tree; non-tree edges are cut open (as in a real papercraft net).
    const coincident: string[] = []
    const edgePairs: string[] = []
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const ai = faces[i].verts.map((p) => posKey(p))
        const bj = new Set(faces[j].verts.map((p) => posKey(p)))
        const sharedKeys = ai.filter((k) => bj.has(k))
        if (sharedKeys.length < 2) continue
        edgePairs.push(`${i}-${j}`)
        const mapA = new Map<string, { x: number; y: number }>()
        faces[i].verts.forEach((p, c) => mapA.set(posKey(p), net.faces.find((f) => f.polyIndex === i)!.pts[c]))
        const mapB = new Map<string, { x: number; y: number }>()
        faces[j].verts.forEach((p, c) => mapB.set(posKey(p), net.faces.find((f) => f.polyIndex === j)!.pts[c]))
        const ok = sharedKeys.every((k) => {
          const pa = mapA.get(k)!
          const pb = mapB.get(k)!
          return Math.abs(pa.x - pb.x) < 1e-3 && Math.abs(pa.y - pb.y) < 1e-3
        })
        if (ok) coincident.push(`${i}-${j}`)
      }
    }
    // A single connected component needs exactly faces-1 = 5 attached edges.
    expect(edgePairs.length).toBeGreaterThanOrEqual(5)
    expect(coincident.length).toBeGreaterThanOrEqual(5)
  })

  it('unfolds two perpendicular squares into one 40x20 strip sharing their edge', () => {
    const faces = cube()
    const net = unfoldPolys([faces[0], faces[4]]) // +X and +Z faces share an edge
    expect(net.faces).toHaveLength(2)
    // Six unique points (each face keeps its four, two are shared).
    const unique = new Set<string>()
    for (const f of net.faces) for (const p of f.pts) unique.add(`${p.x.toFixed(3)}:${p.y.toFixed(3)}`)
    expect(unique.size).toBe(6)
    const dims = [net.width, net.height].sort((a, b) => a - b)
    expect(dims[0]).toBeCloseTo(20, 2)
    expect(dims[1]).toBeCloseTo(40, 2)
  })

  it('keeps disjoint components separated (no shared edge, laid side by side)', () => {
    const faces = cube()
    // Two faces that only touch at one corner would still share <2 keys; use the
    // +X and -X faces which never touch.
    const net = unfoldPolys([faces[0], faces[1]])
    expect(net.faces).toHaveLength(2)
    const unique = new Set<string>()
    for (const f of net.faces) for (const p of f.pts) unique.add(`${p.x.toFixed(3)}:${p.y.toFixed(3)}`)
    expect(unique.size).toBe(8)
  })
})
