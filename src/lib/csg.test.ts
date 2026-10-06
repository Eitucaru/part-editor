import { describe, it, expect } from 'vitest'
import {
  boxSolid,
  cylinderSolid,
  solidFromTriangles,
  solidToTriangles,
  subtract,
  union,
  intersect,
} from './csg'
import type { CsgSolid } from './csg'

/** Signed volume of a triangle soup (positive for outward CCW winding). */
function volume(solid: CsgSolid): number {
  const { positions } = solidToTriangles(solid)
  let sum = 0
  for (let i = 0; i + 9 <= positions.length; i += 9) {
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const bx = positions[i + 3]
    const by = positions[i + 4]
    const bz = positions[i + 5]
    const cx = positions[i + 6]
    const cy = positions[i + 7]
    const cz = positions[i + 8]
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return sum / 6
}

function close(actual: number, expected: number, tol = 1e-3): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tol)
}

describe('csg — shape generators', () => {
  it('boxSolid is outward-wound with the correct volume', () => {
    const box = boxSolid({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 })
    close(volume(box), 24)
  })

  it('cylinderSolid approximates πr²h', () => {
    const cyl = cylinderSolid({ x: 0, y: 0, z: 0 }, 1, 4, 128)
    close(volume(cyl), Math.PI * 4, 0.01)
  })

  it('round-trips a triangle soup losslessly in volume', () => {
    const box = boxSolid({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const { positions, colorCodes } = solidToTriangles(box)
    const rebuilt = solidFromTriangles(positions, colorCodes)
    close(volume(rebuilt), volume(box))
  })
})

describe('csg — booleans', () => {
  it('union of disjoint boxes sums volumes', () => {
    const a = boxSolid({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const b = boxSolid({ x: 2, y: 0, z: 0 }, { x: 3, y: 1, z: 1 })
    close(volume(union(a, b)), 2)
  })

  it('subtract of a centered cavity removes exactly the tool volume', () => {
    const a = boxSolid({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })
    const b = boxSolid({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1.5, y: 1.5, z: 1.5 })
    close(volume(subtract(a, b)), 8 - 1)
  })

  it('subtract that fully contains the target yields empty', () => {
    const a = boxSolid({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const b = boxSolid({ x: -1, y: -1, z: -1 }, { x: 2, y: 2, z: 2 })
    close(volume(subtract(a, b)), 0)
  })

  it('intersect of overlapping boxes yields the overlap volume', () => {
    const a = boxSolid({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })
    const b = boxSolid({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 })
    close(volume(intersect(a, b)), 1)
  })

  it('handles multi-axis overlapping boxes (no coplanar faces)', () => {
    const a = boxSolid({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })
    const b = boxSolid({ x: 0.3, y: 0.7, z: 1.1 }, { x: 2.4, y: 2.9, z: 3.2 })
    const overlap = (2 - 0.3) * (2 - 0.7) * (2 - 1.1)
    const bVolume = (2.4 - 0.3) * (2.9 - 0.7) * (3.2 - 1.1)
    close(volume(intersect(a, b)), overlap)
    close(volume(union(a, b)), 8 + bVolume - overlap)
    close(volume(subtract(a, b)), 8 - overlap)
  })

  it('punches a through-hole in a box with a cylinder', () => {
    const brick = boxSolid({ x: -20, y: 0, z: -20 }, { x: 20, y: 24, z: 20 })
    const drill = cylinderSolid({ x: 0, y: 12, z: 0 }, 6, 40, 48)
    const punched = subtract(brick, drill)
    // The cylinder removes material only where it overlaps the brick (y 0..24).
    const expected = 40 * 24 * 40 - Math.PI * 6 * 6 * 24
    // Tolerance accounts for the 48-gon cylinder approximation (~0.3%).
    close(volume(punched), expected, 15)
  })
})
