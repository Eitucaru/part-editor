import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyLdrawMatrix, flipY, ldrawMatrixToScene, ldrawToMatrix4, matrix4ToLdraw, sceneMatrixToLdraw } from './matrix3d'
import type { Mat3, Vec3 } from '../core'

function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-6
}

function roundTrip(position: Vec3, matrix: Mat3): { position: Vec3; matrix: Mat3 } {
  const group = new THREE.Object3D()
  applyLdrawMatrix(group, position, matrix)
  group.updateMatrix()
  return matrix4ToLdraw(group.matrix)
}

function expectMatrixEquals(actual: Mat3, expected: Mat3): void {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const
  for (const key of keys) {
    expect(closeTo(actual[key], expected[key])).toBe(true)
  }
}

describe('applyLdrawMatrix round-trip', () => {
  it('preserves identity', () => {
    const result = roundTrip({ x: 0, y: 0, z: 0 }, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    expectMatrixEquals(result.matrix, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
  })

  it('preserves translation', () => {
    const result = roundTrip({ x: 10, y: -20, z: 30 }, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    expect(result.position).toEqual({ x: 10, y: -20, z: 30 })
  })

  it('preserves a 90° rotation', () => {
    const m = { a: 0, b: 0, c: 1, d: 0, e: 1, f: 0, g: -1, h: 0, i: 0 }
    expectMatrixEquals(roundTrip({ x: 0, y: 0, z: 0 }, m).matrix, m)
  })

  it('preserves non-uniform scale', () => {
    const m = { a: 2, b: 0, c: 0, d: 0, e: 3, f: 0, g: 0, h: 0, i: 4 }
    expectMatrixEquals(roundTrip({ x: 0, y: 0, z: 0 }, m).matrix, m)
  })

  it('preserves mirroring (negative determinant)', () => {
    const m = { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0, g: 0, h: 0, i: 1 }
    expectMatrixEquals(roundTrip({ x: 0, y: 0, z: 0 }, m).matrix, m)
  })

  it('preserves rotation combined with non-uniform scale', () => {
    const m = { a: 0, b: 0, c: 1, d: 0, e: 5, f: 0, g: -0.5, h: 0, i: 0 }
    expectMatrixEquals(roundTrip({ x: 0, y: 0, z: 0 }, m).matrix, m)
  })

  it('preserves the mirrored body case', () => {
    const m = { a: -1, b: 0, c: 0, d: 0, e: 3, f: 0, g: 0, h: 0, i: -1 }
    expectMatrixEquals(roundTrip({ x: 0, y: 0, z: 0 }, m).matrix, m)
  })
})

describe('ldrawToMatrix4', () => {
  it('maps rows correctly', () => {
    const m = ldrawToMatrix4({ x: 1, y: 2, z: 3 }, { a: 4, b: 5, c: 6, d: 7, e: 8, f: 9, g: 10, h: 11, i: 12 })
    const e = m.elements
    expect(e[0]).toBe(4) // m00
    expect(e[1]).toBe(7) // m10
    expect(e[4]).toBe(5) // m01
    expect(e[12]).toBe(1) // tx
    expect(e[13]).toBe(2) // ty
    expect(e[14]).toBe(3) // tz
  })
})

describe('Y-axis conversion (LDraw -Y up ↔ scene +Y up)', () => {
  it('flips point Y', () => {
    expect(flipY({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: -2, z: 3 })
  })

  it('converts a rotation matrix with F·M·F (negates row 2 and column 2)', () => {
    const m: Mat3 = { a: 0, b: 0, c: 1, d: 0, e: 1, f: 0, g: -1, h: 0, i: 0 }
    expect(ldrawMatrixToScene(m)).toEqual({ a: 0, b: 0, c: 1, d: 0, e: 1, f: 0, g: -1, h: 0, i: 0 })
  })

  it('is its own inverse (F = F⁻¹)', () => {
    const m: Mat3 = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }
    const roundTripped = sceneMatrixToLdraw(ldrawMatrixToScene(m))
    expect(roundTripped).toEqual(m)
  })

  it('keeps diagonal scales unchanged', () => {
    const m: Mat3 = { a: 2, b: 0, c: 0, d: 0, e: 3, f: 0, g: 0, h: 0, i: 4 }
    expect(ldrawMatrixToScene(m)).toEqual(m)
  })
})
