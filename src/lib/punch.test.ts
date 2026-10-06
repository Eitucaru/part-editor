import { describe, it, expect } from 'vitest'
import { boxSolid, solidToTriangles } from './csg'
import { punchCylinderSolid, soupToLdrawLines, subtractSoup } from './punch'

/** Signed volume of a scene-space triangle soup. */
function volume(positions: number[]): number {
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

describe('punch — soupToLdrawLines', () => {
  it('flips Y and reverses winding back to LDraw space', () => {
    const soup = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      colorCodes: [16, 16, 16],
    }
    const lines = soupToLdrawLines(soup)
    expect(lines).toEqual(['3 16 0 0 0 0 -1 0 1 0 0'])
  })
})

describe('punch — subtractSoup', () => {
  it('punches a cylinder hole through a brick soup', () => {
    const brick = boxSolid({ x: -20, y: 0, z: -20 }, { x: 20, y: 24, z: 20 })
    const { positions, colorCodes } = solidToTriangles(brick)
    const drill = punchCylinderSolid({ x: 0, y: 12, z: 0 }, 6, 40, 48)
    const result = subtractSoup({ positions, colorCodes }, drill)

    const expected = 40 * 24 * 40 - Math.PI * 6 * 6 * 24
    expect(Math.abs(volume(result.positions) - expected)).toBeLessThan(15)
    // The hole walls add triangles beyond the brick's original 12.
    expect(result.positions.length / 9).toBeGreaterThan(12)
  })
})
