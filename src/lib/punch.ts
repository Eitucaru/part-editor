import { formatNumber } from '../core'
import type { Vec3 } from '../core'
import { boxSolid, cylinderSolid, solidFromTriangles, solidToTriangles, subtract } from './csg'
import type { CsgSolid } from './csg'
import type { TriangleSoup } from './geometry-builder'
import type { EdgeSoup } from './geometry-builder'

/**
 * Punch / erase pipeline: flatten a built part into a triangle soup, subtract
 * a tool solid via CSG, and emit the result as LDraw type-3 lines.
 *
 * All geometry here is in **scene space** (+Y up) — the same space the CSG
 * engine and the viewport use. `soupToLdrawLines` converts back to LDraw
 * (-Y up) on the way out.
 */

/** The LDraw color code assigned to freshly cut (tool-side) faces. */
export const PUNCH_TOOL_COLOR = 16

function flipY(v: Vec3): Vec3 {
  return { x: v.x, y: v.y === 0 ? 0 : -v.y, z: v.z }
}

function fmt(n: number): string {
  return formatNumber(n, 4)
}

/** A scene-space cylinder tool (axis along Y) for punching axle/pin holes. */
export function punchCylinderSolid(center: Vec3, radius: number, height: number, segments = 32): CsgSolid {
  return cylinderSolid(center, radius, height, segments, PUNCH_TOOL_COLOR)
}

/** A scene-space box tool for erasing a rectangular region. */
export function punchBoxSolid(min: Vec3, max: Vec3): CsgSolid {
  return boxSolid(min, max, PUNCH_TOOL_COLOR)
}

/** Subtract a tool solid from a scene-space triangle soup, returning a new soup. */
export function subtractSoup(target: TriangleSoup, tool: CsgSolid): TriangleSoup {
  const targetSolid = solidFromTriangles(target.positions, target.colorCodes)
  const result = subtract(targetSolid, tool)
  const { positions, colorCodes } = solidToTriangles(result)
  return { positions, colorCodes }
}

/**
 * Convert a scene-space triangle soup to LDraw type-3 lines. Each scene-space
 * triangle is written back with negated Y and reversed winding, so outward
 * normals stay outward in LDraw's -Y-up space.
 */
export function soupToLdrawLines(soup: TriangleSoup): string[] {
  const lines: string[] = []
  for (let i = 0; i + 9 <= soup.positions.length; i += 9) {
    const color = soup.colorCodes[i / 3] ?? PUNCH_TOOL_COLOR
    const p0 = { x: soup.positions[i], y: soup.positions[i + 1], z: soup.positions[i + 2] }
    const p1 = { x: soup.positions[i + 3], y: soup.positions[i + 4], z: soup.positions[i + 5] }
    const p2 = { x: soup.positions[i + 6], y: soup.positions[i + 7], z: soup.positions[i + 8] }
    const v0 = flipY(p0)
    const v1 = flipY(p2)
    const v2 = flipY(p1)
    lines.push(`3 ${color} ${fmt(v0.x)} ${fmt(v0.y)} ${fmt(v0.z)} ${fmt(v1.x)} ${fmt(v1.y)} ${fmt(v1.z)} ${fmt(v2.x)} ${fmt(v2.y)} ${fmt(v2.z)}`)
  }
  return lines
}

/**
 * Convert a scene-space edge list to LDraw type-2 lines. Each edge (2 scene
 * vertices) is written back with negated Y.
 */
export function edgeSoupToLdrawLines(soup: EdgeSoup): string[] {
  const lines: string[] = []
  for (let i = 0; i + 6 <= soup.positions.length; i += 6) {
    const color = soup.colorCodes[i / 3] ?? 24
    const p0 = { x: soup.positions[i], y: soup.positions[i + 1], z: soup.positions[i + 2] }
    const p1 = { x: soup.positions[i + 3], y: soup.positions[i + 4], z: soup.positions[i + 5] }
    const v0 = flipY(p0)
    const v1 = flipY(p1)
    lines.push(`2 ${color} ${fmt(v0.x)} ${fmt(v0.y)} ${fmt(v0.z)} ${fmt(v1.x)} ${fmt(v1.y)} ${fmt(v1.z)}`)
  }
  return lines
}
