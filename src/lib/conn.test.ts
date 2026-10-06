import { describe, it, expect } from 'vitest'
import {
  AxleT,
  HoleT,
  PhysicalT,
  connPosition,
  identityMatrix,
  makeAxleConnector,
  makeHoleConnector,
  makeHoleGridConnector,
  makeStudConnector,
  makeStudGridConnector,
  parseConnBinary,
  parseConnText,
  withPosition,
  writeConnBinary,
  writeConnText,
} from './conn'
import type { Connector } from './conn'

/** Round-trip a set of connectors through the binary codec. */
function binaryRoundTrip(connectors: Connector[]): Connector[] {
  return parseConnBinary(writeConnBinary(connectors))
}

describe('conn — binary round-trip', () => {
  it('round-trips every connector type', () => {
    const all: Connector[] = [
      makeAxleConnector({ x: 1, y: 2, z: 3 }, AxleT.Axle, 20),
      { connType: PhysicalT.Ball, subType: 0, matrix: withPosition(identityMatrix(), { x: 4, y: 5, z: 6 }) },
      makeHoleConnector({ x: 0, y: 24, z: 0 }, 10, HoleT.Brick),
      makeStudConnector({ x: 0, y: 0, z: 0 }, 10),
      { connType: PhysicalT.Fixed, subType: 0, matrix: identityMatrix(), axes: 7, tag: '' },
      {
        connType: PhysicalT.Hinge,
        subType: 0,
        matrix: identityMatrix(),
        flipLimMax: 90,
        flipLimMin: -90,
        limMax: 45,
        limMin: -45,
        isOriented: true,
        tag: '',
      },
      { connType: PhysicalT.Rail, subType: 0, matrix: identityMatrix(), length: 40 },
      {
        connType: PhysicalT.Slider,
        subType: 0,
        matrix: identityMatrix(),
        isStartCapped: true,
        isEndCapped: false,
        length: 24,
        isCylindrical: true,
      },
    ]

    const back = binaryRoundTrip(all)
    expect(back).toHaveLength(all.length)

    for (let i = 0; i < all.length; i++) {
      const a = all[i]
      const b = back[i]
      expect(b.connType).toBe(a.connType)
      expect(b.subType).toBe(a.subType)
      expect(Array.from(b.matrix)).toEqual(Array.from(a.matrix))
    }

    // Spot-check the axle's type-specific fields.
    const axle = back[0] as Extract<Connector, { connType: PhysicalT.Axle }>
    expect(axle.length).toBeCloseTo(20, 5)
    expect(axle.isEndCapped).toBe(false) // Axle (7) has no end cap
    expect(axle.isGrabbing).toBe(false)

    const stud = back[3] as Extract<Connector, { connType: PhysicalT.Stud }>
    expect(stud.height).toBe(2)
    expect(stud.width).toBe(2)
    expect(stud.cells[1][1]).toEqual({ altitude: 10, occupiedArea: 4 })
    expect(stud.cells[0][0]).toEqual({ altitude: 3, occupiedArea: 1 })
  })

  it('negates the five matrix fields on disk', () => {
    const c: Connector = {
      connType: PhysicalT.Rail,
      subType: 0,
      matrix: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      length: 13,
    }
    const bytes = writeConnBinary([c], 'v0')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // header: connType(2) + subType(2), then 12 floats.
    const get = (floatIndex: number) => view.getFloat32(4 + floatIndex * 4, true)
    expect(get(0)).toBe(1) // m00
    expect(get(2)).toBe(-3) // -m20
    expect(get(5)).toBe(-6) // -m21
    expect(get(6)).toBe(-7) // -m02
    expect(get(7)).toBe(-8) // -m12
    expect(get(11)).toBe(-12) // -m23

    const back = parseConnBinary(bytes)[0] as Extract<Connector, { connType: PhysicalT.Rail }>
    expect(Array.from(back.matrix)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(back.length).toBeCloseTo(13, 5)
  })
})

describe('conn — text round-trip', () => {
  it('parses the documented axle text form', () => {
    const line = '0 7 1.000000 0.000000 0.000000 0.000000 1.000000 0.000000 0.000000 0.000000 1.000000 0.000000 10.000000 0.000000 0 0 0.8 0 0'
    const c = parseConnText(line) as Extract<Connector, { connType: PhysicalT.Axle }>
    expect(c.connType).toBe(PhysicalT.Axle)
    expect(c.subType).toBe(AxleT.Axle)
    expect(connPosition(c.matrix)).toEqual({ x: 0, y: 10, z: 0 })
    expect(c.length).toBeCloseTo(20, 5) // 0.8 studs × 25
    expect(c.isGrabbing).toBe(false)
  })

  it('round-trips a stud grid through text', () => {
    const stud = makeStudConnector({ x: 0, y: 0, z: 0 }, 10)
    const line = writeConnText(stud)
    expect(line.startsWith('3 0 ')).toBe(true)

    const back = parseConnText(line) as Extract<Connector, { connType: PhysicalT.Stud }>
    expect(back.connType).toBe(PhysicalT.Stud)
    expect(back.height).toBe(2)
    expect(back.width).toBe(2)
    expect(back.cells[1][1]).toEqual({ altitude: 10, occupiedArea: 4 })
    expect(connPosition(back.matrix)).toEqual(connPosition(stud.matrix))
  })

  it('round-trips an axle with caps through text', () => {
    const axle = makeAxleConnector({ x: 1, y: 2, z: 3 }, AxleT.TechnicPin, 16)
    const back = parseConnText(writeConnText(axle)) as Extract<Connector, { connType: PhysicalT.Axle }>
    expect(back.subType).toBe(AxleT.TechnicPin)
    expect(back.length).toBeCloseTo(16, 4)
    expect(connPosition(back.matrix)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('round-trips a hinge with limits and orientation', () => {
    const hinge: Connector = {
      connType: PhysicalT.Hinge,
      subType: 0,
      matrix: identityMatrix(),
      flipLimMax: 90,
      flipLimMin: -90,
      limMax: 45,
      limMin: -45,
      isOriented: true,
      tag: '',
    }
    const back = parseConnText(writeConnText(hinge)) as Extract<Connector, { connType: PhysicalT.Hinge }>
    expect(back.flipLimMax).toBeCloseTo(90, 3)
    expect(back.limMin).toBeCloseTo(-45, 3)
    expect(back.isOriented).toBe(true)
  })
})

describe('conn — grid connectors', () => {
  const asStud = (c: Connector) => c as Extract<Connector, { connType: PhysicalT.Stud }>
  const asHole = (c: Connector) => c as Extract<Connector, { connType: PhysicalT.Hole }>

  it('builds a 1×1 stud grid with the standard 3×3 cell pattern', () => {
    const stud = asStud(makeStudGridConnector(0, 0, 0, 0, -24, 10, 0))
    expect(stud.height).toBe(2)
    expect(stud.width).toBe(2)
    expect(stud.cells[1][1]).toEqual({ altitude: 10, occupiedArea: 4 })
    expect(stud.cells[0][0]).toEqual({ altitude: 3, occupiedArea: 1 })
    expect(stud.cells[0][1]).toEqual({ altitude: 0, occupiedArea: 4 })
    // Origin at the top-left cell, so the matrix is offset -10 from the stud.
    expect(connPosition(stud.matrix)).toEqual({ x: -10, y: -24, z: -10 })
  })

  it('builds a 2×2 stud grid with a 5×5 cell pattern', () => {
    const stud = asStud(makeStudGridConnector(0, 0, 20, 20, 0, 10))
    expect(stud.height).toBe(4)
    expect(stud.width).toBe(4)
    // Studs at odd×odd cells.
    expect(stud.cells[1][1].altitude).toBe(10)
    expect(stud.cells[3][3].altitude).toBe(10)
    expect(stud.cells[1][3].altitude).toBe(10)
    // Corners at even×even.
    expect(stud.cells[0][0].altitude).toBe(3)
    expect(stud.cells[4][4].altitude).toBe(3)
    // Edges elsewhere.
    expect(stud.cells[1][0].altitude).toBe(0)
  })

  it('builds a hole grid with Hole type', () => {
    const hole = asHole(makeHoleGridConnector(0, 0, 20, 0, 24, 10, HoleT.Brick))
    expect(hole.connType).toBe(PhysicalT.Hole)
    expect(hole.height).toBe(4) // 2 studs along X
    expect(hole.width).toBe(2) // 1 stud along Z
  })
})
