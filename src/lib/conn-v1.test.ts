import { describe, it, expect } from 'vitest'
import {
  AxleT,
  HoleT,
  PhysicalT,
  makeAxleConnector,
  makeHoleConnector,
  makeStudConnector,
  parseConnBinary,
  writeConnBinary,
} from './conn'
import type { Connector } from './conn'

const HEADER_START = [0x21, 0x21, 0x48, 0x53] // "!!HS"
const HEADER_END = [0x21, 0x21, 0x44, 0x53] // "!!DS"

describe('conn — V1 (Studio 2.0) binary', () => {
  it('writes the !!HS header, version 1, and !!DS', () => {
    const bytes = writeConnBinary([], 'v1')
    expect(Array.from(bytes.slice(0, 4))).toEqual(HEADER_START)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getInt32(4, true)).toBe(1) // SerializationVersion
    expect(view.getInt32(8, true)).toBe(0) // FileType = Connectivity
    expect(Array.from(bytes.slice(12, 16))).toEqual([0x21, 0x21, 0x45, 0x53]) // "!!ES"
    expect(Array.from(bytes.slice(16, 20))).toEqual(HEADER_END)
    expect(bytes.length).toBe(20)
  })

  it('round-trips every connector type through V1', () => {
    const all: Connector[] = [
      makeAxleConnector({ x: 1, y: 2, z: 3 }, AxleT.Axle, 20),
      { connType: PhysicalT.Ball, subType: 0, matrix: makeAxleConnector({ x: 4, y: 5, z: 6 }, AxleT.Bar, 4).matrix, flex: [1.5, -2.25] },
      makeHoleConnector({ x: 0, y: 24, z: 0 }, 10, HoleT.Brick),
      makeStudConnector({ x: 0, y: 0, z: 0 }, 10),
      { connType: PhysicalT.Fixed, subType: 0, matrix: makeAxleConnector({ x: 0, y: 0, z: 0 }, AxleT.Bar, 4).matrix, axes: 7, tag: 'grip' },
      {
        connType: PhysicalT.Hinge,
        subType: 0,
        matrix: makeAxleConnector({ x: 0, y: 0, z: 0 }, AxleT.Bar, 4).matrix,
        flipLimMax: 90,
        flipLimMin: -90,
        limMax: 45,
        limMin: -45,
        isOriented: true,
        tag: 'door',
      },
      { connType: PhysicalT.Rail, subType: 0, matrix: makeAxleConnector({ x: 0, y: 0, z: 0 }, AxleT.Bar, 4).matrix, length: 40 },
      {
        connType: PhysicalT.Slider,
        subType: 0,
        matrix: makeAxleConnector({ x: 0, y: 0, z: 0 }, AxleT.Bar, 4).matrix,
        isStartCapped: true,
        isEndCapped: false,
        length: 24,
        isCylindrical: true,
      },
    ]
    all[0] = { ...all[0], fileName: 'part.conn' }

    const back = parseConnBinary(writeConnBinary(all, 'v1'))
    expect(back).toHaveLength(all.length)

    for (let i = 0; i < all.length; i++) {
      const a = all[i]
      const b = back[i]
      expect(b.connType).toBe(a.connType)
      expect(b.subType).toBe(a.subType)
      expect(Array.from(b.matrix)).toEqual(Array.from(a.matrix))
      expect(b.fileName).toBe(a.fileName)
    }

    // Axle field check.
    const axle = back[0] as Extract<Connector, { connType: PhysicalT.Axle }>
    expect(axle.length).toBeCloseTo(20, 5)
    expect(axle.fileName).toBe('part.conn')

    // Ball flex check.
    const ball = back[1] as Extract<Connector, { connType: PhysicalT.Ball }>
    expect(ball.flex).toEqual([1.5, -2.25])

    // Grid check.
    const stud = back[3] as Extract<Connector, { connType: PhysicalT.Stud }>
    expect(stud.height).toBe(2)
    expect(stud.cells[1][1]).toEqual({ altitude: 10, occupiedArea: 4 })

    // Fixed/Hinge tag check.
    const fixed = back[4] as Extract<Connector, { connType: PhysicalT.Fixed }>
    expect(fixed.tag).toBe('grip')
    const hinge = back[5] as Extract<Connector, { connType: PhysicalT.Hinge }>
    expect(hinge.tag).toBe('door')
  })

  it('maps V0 subtypes to V1 flag values in the binary', () => {
    const axle = makeAxleConnector({ x: 0, y: 0, z: 0 }, AxleT.Axle, 20) // subtype 7
    const stud = makeStudConnector({ x: 0, y: 0, z: 0 }, 10) // type 3
    const bytes = writeConnBinary([axle, stud], 'v1')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    // Record 1 starts at 20 (after the 20-byte header).
    expect(view.getInt32(20, true)).toBe(0x10) // ConnectivityType.Axle
    expect(view.getInt32(24, true)).toBe(0x4000) // AxleType.Axle

    // Record 2: 20 + (4 type + 4 subtype + 48 matrix + 8 axle payload + 1 fileName) = 20 + 65
    expect(view.getInt32(85, true)).toBe(0x2000) // ConnectivityType.Stud
  })

  it('reads V0 files (backward compatibility)', () => {
    const stud = makeStudConnector({ x: 0, y: 0, z: 0 }, 10)
    const v0 = writeConnBinary([stud], 'v0')
    const back = parseConnBinary(v0)
    expect(back).toHaveLength(1)
    expect(back[0].connType).toBe(PhysicalT.Stud)
    expect((back[0] as Extract<Connector, { connType: PhysicalT.Stud }>).cells[1][1].altitude).toBe(10)
  })

  it('reads Studio V1 records whose grids use 32-bit cells', () => {
    // Build a V1 file by hand with a 1×1 hole grid using Int32 cells.
    const parts: number[] = [...HEADER_START]
    const i32 = (v: number) => {
      parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
    }
    const f32 = (v: number) => {
      const a = new Uint8Array(4)
      new DataView(a.buffer).setFloat32(0, v, true)
      for (const b of a) parts.push(b)
    }
    const i16 = (v: number) => {
      parts.push(v & 0xff, (v >> 8) & 0xff)
    }
    i32(1)
    i32(0)
    parts.push(0x21, 0x21, 0x45, 0x53) // "!!ES"
    parts.push(0x21, 0x21, 0x44, 0x53) // "!!DS"
    // One Hole record (type 0x400, subtype Brick 0x40).
    i32(0x400)
    i32(0x40)
    for (let i = 0; i < 12; i++) f32(i === 0 || i === 4 || i === 8 ? 1 : 0)
    i16(2) // height
    i16(2) // width
    // 9 cells, Int32 altitude + Int32 occupiedArea (center = 20:4).
    for (let i = 0; i < 9; i++) {
      const isCenter = i === 4
      i32(isCenter ? 20 : 0)
      i32(isCenter ? 4 : 0)
    }
    // FileName: bool false
    parts.push(0)

    const back = parseConnBinary(new Uint8Array(parts))
    expect(back).toHaveLength(1)
    const hole = back[0] as Extract<Connector, { connType: PhysicalT.Hole }>
    expect(hole.connType).toBe(PhysicalT.Hole)
    expect(hole.subType).toBe(HoleT.Brick)
    expect(hole.height).toBe(2)
    expect(hole.cells[1][1]).toEqual({ altitude: 20, occupiedArea: 4 })
  })
})
