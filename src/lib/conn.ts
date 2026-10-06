import type { Vec3 } from '../core'

/**
 * BrickLink Studio `.conn` connectivity codec.
 *
 * `.conn` files are flat binary streams of connector records; each record is a
 * 52-byte common header (ConnType Int16, SubType Int16, 12×Single transform)
 * followed by type-specific data. All values are little-endian (C# BinaryWriter).
 *
 * The transform is stored column-major (3×4) with FIVE fields negated to bridge
 * LDraw (right-handed) and Unity (left-handed) coordinate systems. On read we
 * negate those fields back; on write we negate them again.
 *
 * The same records are also embedded in `.dat` files as `0 PE_CONN <text>`
 * lines using a space-delimited text form (see `parseConnText` / `writeConnText`).
 * This is how connectors live inside a part while it is being edited.
 */

export enum PhysicalT {
  Axle = 0,
  Ball = 1,
  Hole = 2,
  Stud = 3,
  Fixed = 4,
  Gear = 5,
  Hinge = 6,
  Rail = 7,
  Slider = 8,
}

export const AxleT = {
  TechnicPinSocket: 2,
  TechnicPin: 3,
  TechnicPinWOHole: 5,
  AxleSocket: 6,
  Axle: 7,
  AxleWidthGuard: 9,
  RoundHole: 10,
  BarForRoundHole: 11,
  Clip: 12,
  Bar: 13,
  PinSocket: 14,
  BarWithPinSocket: 15,
  Pin: 17,
} as const

export const HoleT = {
  Brick: 0,
  Plate: 1,
  TechPinSocket: 2,
  Bar: 3,
  RoundHole: 4,
} as const

/**
 * Studio 2.0 "V1" format flags. Studio 2.0 writes a versioned file (see the
 * `!!HS` header below); its record type/subtype tags are single-bit flags, not
 * the small sequential V0 numbers above. Internally we keep V0 numbers and
 * convert at the V1 read/write boundary.
 */
export const ConnectivityTypeV1 = {
  Axle: 0x10,
  Ball: 0x80,
  Hole: 0x400,
  Stud: 0x2000,
  Fixed: 0x8000,
  Hinge: 0x40000,
  Rail: 0x200000,
  Slider: 0x1000000,
} as const

const AxleTypeV1: Record<number, number> = {
  2: 0x40, // TechnicPinSocket
  3: 0x100, // TechnicPin
  5: 0x400, // TechnicPinWOHole
  6: 0x1000, // AxleSocket
  7: 0x4000, // Axle
  9: 0x10000, // AxleWithGuard
  10: 0x40000, // RoundHole
  11: 0x100000, // BarForRoundHole
  12: 0x400000, // Clip
  13: 0x1000000, // Bar
  14: 0x4000000, // PinSocket
  15: 0x10000000, // BarWithPinSocket
  17: 0x40000000, // Pin
}

const AxleTypeV0: Record<number, number> = {}
for (const [k, v] of Object.entries(AxleTypeV1)) AxleTypeV0[v] = Number(k)

const HoleTypeV1: Record<number, number> = {
  0: 0x40, // Brick
  1: 0x1000, // Plate
  2: 0x40000, // TechPinSocket
  3: 0x1000000, // Bar
}

const HoleTypeV0: Record<number, number> = {}
for (const [k, v] of Object.entries(HoleTypeV1)) HoleTypeV0[v] = Number(k)

const CONN_TYPE_TO_V1: Record<number, number> = {
  [PhysicalT.Axle]: ConnectivityTypeV1.Axle,
  [PhysicalT.Ball]: ConnectivityTypeV1.Ball,
  [PhysicalT.Hole]: ConnectivityTypeV1.Hole,
  [PhysicalT.Stud]: ConnectivityTypeV1.Stud,
  [PhysicalT.Fixed]: ConnectivityTypeV1.Fixed,
  [PhysicalT.Hinge]: ConnectivityTypeV1.Hinge,
  [PhysicalT.Rail]: ConnectivityTypeV1.Rail,
  [PhysicalT.Slider]: ConnectivityTypeV1.Slider,
}

const CONN_TYPE_FROM_V1: Record<number, number> = {}
for (const [k, v] of Object.entries(CONN_TYPE_TO_V1)) CONN_TYPE_FROM_V1[v] = Number(k)

/** One grid cell of a Stud/Hole connector. */
export interface MatrixItem {
  altitude: number
  occupiedArea: number
}

/**
 * 12 floats, column-major 3×4: indices 0–8 are the 3×3 rotation/scale, 9–11 are
 * the translation. These are the TRUE values (negated fields already restored).
 */
export type ConnMatrix = [number, number, number, number, number, number, number, number, number, number, number, number]

export type Connector = {
  fileName?: string
} & (
  | {
      connType: PhysicalT.Axle
      subType: number
      matrix: ConnMatrix
      isStartCapped: boolean
      isEndCapped: boolean
      length: number
      isGrabbing: boolean
      isRequireGrabbing: boolean
    }
  | { connType: PhysicalT.Ball; subType: number; matrix: ConnMatrix; flex?: number[] }
  | { connType: PhysicalT.Hole; subType: number; matrix: ConnMatrix; height: number; width: number; cells: MatrixItem[][] }
  | { connType: PhysicalT.Stud; subType: number; matrix: ConnMatrix; height: number; width: number; cells: MatrixItem[][] }
  | { connType: PhysicalT.Fixed; subType: number; matrix: ConnMatrix; axes: number; tag: string }
  | {
      connType: PhysicalT.Hinge
      subType: number
      matrix: ConnMatrix
      flipLimMax: number
      flipLimMin: number
      limMax: number
      limMin: number
      isOriented: boolean
      tag: string
    }
  | { connType: PhysicalT.Rail; subType: number; matrix: ConnMatrix; length: number }
  | {
      connType: PhysicalT.Slider
      subType: number
      matrix: ConnMatrix
      isStartCapped: boolean
      isEndCapped: boolean
      length: number
      isCylindrical: boolean
    }
)

export function identityMatrix(): ConnMatrix {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
}

/** Translation part of a connector transform (LDraw space). */
export function connPosition(m: ConnMatrix): Vec3 {
  return { x: m[9], y: m[10], z: m[11] }
}

/** "Up" axis: matrix × (0,1,0) (LDraw space). */
export function connDirection(m: ConnMatrix): Vec3 {
  return { x: m[3], y: m[4], z: m[5] }
}

/** "Front" axis: matrix × (0,0,1) (LDraw space). */
export function connFront(m: ConnMatrix): Vec3 {
  return { x: m[6], y: m[7], z: m[8] }
}

/** Set the translation of a transform, returning a copy. */
export function withPosition(m: ConnMatrix, p: Vec3): ConnMatrix {
  const out = [...m] as ConnMatrix
  out[9] = p.x
  out[10] = p.y
  out[11] = p.z
  return out
}

/** Indices of the matrix fields negated on disk (Unity↔LDraw bridge). */
const NEGATED = new Set([2, 5, 6, 7, 11])

/** Negate a stored field, normalizing -0 to +0. */
const neg = (v: number): number => (v === 0 ? 0 : -v)

function round6(n: number): string {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? '0.000000' : r.toFixed(6)
}

function round3(n: number): string {
  const r = Math.round(n * 1e3) / 1e3
  return Object.is(r, -0) ? '0.000' : r.toFixed(3)
}

/* ------------------------------ binary codec ------------------------------ */

/** Studio 2.0 "V1" magic command bytes. */
const V1_HEADER_START = [0x21, 0x21, 0x48, 0x53] // "!!HS"
const V1_HEADER_END = [0x21, 0x21, 0x44, 0x53] // "!!DS"

function hasPrefix(bytes: Uint8Array, at: number, prefix: number[]): boolean {
  if (at + prefix.length > bytes.length) return false
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix[i]) return false
  return true
}

/** Find the `!!DS` (data start) command, returning the position just after it. */
function scanForDataStart(bytes: Uint8Array, from: number): number {
  for (let i = from; i + V1_HEADER_END.length <= bytes.length; i++) {
    if (hasPrefix(bytes, i, V1_HEADER_END)) return i + V1_HEADER_END.length
  }
  return from
}

/** C# `BinaryWriter.Write7BitEncodedInt` (LEB128) — length prefix for strings. */
function write7BitInt(out: number[], v: number): void {
  let value = v >>> 0
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  out.push(value)
}

/** C# `BinaryReader.Read7BitEncodedInt`. */
function read7BitInt(view: DataView, state: { pos: number }): number {
  let result = 0
  let shift = 0
  for (;;) {
    const b = view.getUint8(state.pos++)
    result |= (b & 0x7f) << shift
    shift += 7
    if ((b & 0x80) === 0) return result >>> 0
    if (shift > 35) throw new Error('Bad 7-bit encoded integer')
  }
}

/** C# `BinaryWriter.Write(string)`: 7-bit byte count + UTF-8 bytes. */
function unityString(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s)
  const prefix: number[] = []
  write7BitInt(prefix, utf8.length)
  const out = new Uint8Array(prefix.length + utf8.length)
  out.set(prefix, 0)
  out.set(utf8, prefix.length)
  return out
}

/** C# `BinaryReader.ReadString()`. */
function readUnityString(view: DataView, state: { pos: number }): string {
  const length = read7BitInt(view, state)
  const bytes = new Uint8Array(view.buffer, view.byteOffset + state.pos, length)
  state.pos += length
  return new TextDecoder('utf-8').decode(bytes)
}

function toV0SubType(connType: number, subType: number): number {
  if (connType === PhysicalT.Axle) return AxleTypeV0[subType] ?? subType
  if (connType === PhysicalT.Hole) return HoleTypeV0[subType] ?? subType
  return subType
}

function toV1SubType(connType: number, subType: number): number {
  if (connType === PhysicalT.Axle) return AxleTypeV1[subType] ?? subType
  if (connType === PhysicalT.Hole) return HoleTypeV1[subType] ?? subType
  return subType
}

interface ReadCtx {
  view: DataView
  pos: number
  version: number
}

export function parseConnBinary(bytes: Uint8Array): Connector[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  let version = 0
  if (bytes.length >= 8 && hasPrefix(bytes, 0, V1_HEADER_START)) {
    pos = 4
    version = view.getInt32(pos, true)
    pos += 4
    pos += 4 // Int32 FileType (0 = connectivity)
    pos = scanForDataStart(bytes, pos)
  }
  return parseConnRecords({ view, pos, version })
}

/** Parse a flat record stream (no header) at a given position/version. */
export function parseConnRecords(ctx: ReadCtx): Connector[] {
  const { view } = ctx
  const state = { pos: ctx.pos }
  const out: Connector[] = []
  const version = ctx.version
  const bytesLen = view.byteLength

  const i16 = () => {
    const v = view.getInt16(state.pos, true)
    state.pos += 2
    return v
  }
  const i32 = () => {
    const v = view.getInt32(state.pos, true)
    state.pos += 4
    return v
  }
  const f32 = () => {
    const v = view.getFloat32(state.pos, true)
    state.pos += 4
    return v
  }
  const bool = () => {
    const v = view.getUint8(state.pos) !== 0
    state.pos += 1
    return v
  }
  const readMatrix = (): ConnMatrix => {
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as ConnMatrix
    for (let i = 0; i < 12; i++) m[i] = NEGATED.has(i) ? neg(f32()) : f32()
    return m
  }
  const readType = () => (version >= 1 ? i32() : i16())
  const readSubType = (connType: number) => {
    const raw = version >= 1 ? i32() : i16()
    return version >= 1 ? toV0SubType(connType, raw) : raw
  }
  const readCell = (): MatrixItem => ({
    altitude: version >= 1 ? i32() : i16(),
    occupiedArea: version >= 1 ? i32() : i16(),
  })
  const readFileName = () => (version >= 1 && bool() ? readUnityString(view, state) : undefined)

  while (state.pos + 4 <= bytesLen) {
    const rawType = readType()
    const connType = version >= 1 ? (CONN_TYPE_FROM_V1[rawType] ?? rawType) : rawType
    const subType = readSubType(connType)
    const matrix = readMatrix()

    switch (connType) {
      case PhysicalT.Axle:
        out.push({
          connType: PhysicalT.Axle,
          subType,
          matrix,
          isStartCapped: bool(),
          isEndCapped: bool(),
          length: f32(),
          isGrabbing: bool(),
          isRequireGrabbing: bool(),
          fileName: readFileName(),
        })
        break
      case PhysicalT.Ball: {
        let flex: number[] | undefined
        if (version >= 1 && bool()) {
          const count = i16()
          flex = []
          for (let i = 0; i < count; i++) flex.push(f32())
        }
        out.push({ connType: PhysicalT.Ball, subType, matrix, flex, fileName: readFileName() })
        break
      }
      case PhysicalT.Hole:
      case PhysicalT.Stud: {
        const height = i16()
        const width = i16()
        const cells: MatrixItem[][] = []
        for (let i = 0; i <= height; i++) {
          const row: MatrixItem[] = []
          for (let j = 0; j <= width; j++) row.push(readCell())
          cells.push(row)
        }
        out.push(
          connType === PhysicalT.Hole
            ? { connType: PhysicalT.Hole, subType, matrix, height, width, cells, fileName: readFileName() }
            : { connType: PhysicalT.Stud, subType, matrix, height, width, cells, fileName: readFileName() },
        )
        break
      }
      case PhysicalT.Fixed: {
        const axes = i16()
        const tag = version >= 1 && bool() ? readUnityString(view, state) : ''
        out.push({ connType: PhysicalT.Fixed, subType, matrix, axes, tag, fileName: readFileName() })
        break
      }
      case PhysicalT.Hinge: {
        const hinge = {
          connType: PhysicalT.Hinge as const,
          subType,
          matrix,
          flipLimMax: f32(),
          flipLimMin: f32(),
          limMax: f32(),
          limMin: f32(),
          isOriented: bool(),
          tag: version >= 1 && bool() ? readUnityString(view, state) : '',
        }
        out.push({ ...hinge, fileName: readFileName() })
        break
      }
      case PhysicalT.Rail:
        out.push({ connType: PhysicalT.Rail, subType, matrix, length: f32(), fileName: readFileName() })
        break
      case PhysicalT.Slider:
        out.push({
          connType: PhysicalT.Slider,
          subType,
          matrix,
          isStartCapped: bool(),
          isEndCapped: bool(),
          length: f32(),
          isCylindrical: bool(),
          fileName: readFileName(),
        })
        break
      default:
        // Unknown type (e.g. Gear / reserved): cannot know its size, stop.
        return out
    }
  }
  return out
}

class ByteWriter {
  private parts: Uint8Array[] = []

  i16(v: number): void {
    this.parts.push(int16(v))
  }

  i32(v: number): void {
    this.parts.push(int32(v))
  }

  f32(v: number): void {
    this.parts.push(float32(v))
  }

  bool(v: boolean): void {
    this.parts.push(new Uint8Array([v ? 1 : 0]))
  }

  raw(bytes: Uint8Array): void {
    this.parts.push(bytes)
  }

  str(s: string): void {
    this.parts.push(unityString(s))
  }

  result(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const p of this.parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }
}

/**
 * Serialize connectors to `.conn` binary.
 *
 * `'v1'` (default) writes Studio 2.0's versioned format (`!!HS` header, 32-bit
 * flag type/subtype, optional per-record file name). `'v0'` writes the
 * header-less Part Designer format (16-bit type/subtype, no file name).
 */
export function writeConnBinary(connectors: Connector[], version: 'v0' | 'v1' = 'v1'): Uint8Array {
  const w = new ByteWriter()
  if (version === 'v1') {
    w.raw(new Uint8Array(V1_HEADER_START))
    w.i32(1) // SerializationVersion
    w.i32(0) // FileType = Connectivity
    w.raw(new Uint8Array([0x21, 0x21, 0x45, 0x53])) // "!!ES"
    w.raw(new Uint8Array(V1_HEADER_END)) // "!!DS" (no extension headers)
  }
  writeConnRecords(connectors, version, w)
  return w.result()
}

function writeConnRecords(connectors: Connector[], version: 'v0' | 'v1', w: ByteWriter): void {
  const writeMatrix = (m: ConnMatrix) => {
    for (let i = 0; i < 12; i++) w.f32(NEGATED.has(i) ? -m[i] : m[i])
  }
  const writeType = (connType: number) => {
    if (version === 'v1') w.i32(CONN_TYPE_TO_V1[connType] ?? connType)
    else w.i16(connType)
  }
  const writeSubType = (connType: number, subType: number) => {
    if (version === 'v1') w.i32(toV1SubType(connType, subType))
    else w.i16(subType)
  }
  const writeCell = (cell: MatrixItem) => {
    if (version === 'v1') {
      w.i32(cell.altitude)
      w.i32(cell.occupiedArea)
    } else {
      w.i16(cell.altitude)
      w.i16(cell.occupiedArea)
    }
  }
  const writeFileName = (fileName: string | undefined) => {
    if (version === 'v1') {
      const has = !!fileName
      w.bool(has)
      if (has) w.str(fileName!)
    }
  }

  for (const c of connectors) {
    writeType(c.connType)
    writeSubType(c.connType, c.subType)
    writeMatrix(c.matrix)
    switch (c.connType) {
      case PhysicalT.Axle:
        w.bool(c.isStartCapped)
        w.bool(c.isEndCapped)
        w.f32(c.length)
        w.bool(c.isGrabbing)
        w.bool(c.isRequireGrabbing)
        writeFileName(c.fileName)
        break
      case PhysicalT.Ball:
        if (version === 'v1') {
          if (c.flex && c.flex.length > 0) {
            w.bool(true)
            w.i16(c.flex.length)
            for (const f of c.flex) w.f32(f)
          } else {
            w.bool(false)
          }
        }
        writeFileName(c.fileName)
        break
      case PhysicalT.Hole:
      case PhysicalT.Stud:
        w.i16(c.height)
        w.i16(c.width)
        for (let i = 0; i <= c.height; i++) {
          for (let j = 0; j <= c.width; j++) {
            writeCell(c.cells[i]?.[j] ?? { altitude: 0, occupiedArea: 0 })
          }
        }
        writeFileName(c.fileName)
        break
      case PhysicalT.Fixed:
        w.i16(c.axes)
        if (version === 'v1') {
          const has = !!c.tag
          w.bool(has)
          if (has) w.str(c.tag)
        }
        writeFileName(c.fileName)
        break
      case PhysicalT.Hinge:
        w.f32(c.flipLimMax)
        w.f32(c.flipLimMin)
        w.f32(c.limMax)
        w.f32(c.limMin)
        w.bool(c.isOriented)
        if (version === 'v1') {
          const has = !!c.tag
          w.bool(has)
          if (has) w.str(c.tag)
        }
        writeFileName(c.fileName)
        break
      case PhysicalT.Rail:
        w.f32(c.length)
        writeFileName(c.fileName)
        break
      case PhysicalT.Slider:
        w.bool(c.isStartCapped)
        w.bool(c.isEndCapped)
        w.f32(c.length)
        w.bool(c.isCylindrical)
        writeFileName(c.fileName)
        break
    }
  }
}

function int16(v: number): Uint8Array {
  const a = new Uint8Array(2)
  new DataView(a.buffer).setInt16(0, v, true)
  return a
}

function int32(v: number): Uint8Array {
  const a = new Uint8Array(4)
  new DataView(a.buffer).setInt32(0, v, true)
  return a
}

function float32(v: number): Uint8Array {
  const a = new Uint8Array(4)
  new DataView(a.buffer).setFloat32(0, v, true)
  return a
}

/* ------------------------------- text codec ------------------------------- */

/** Parse a `0 PE_CONN <text>` line (space-delimited) into a connector. */
export function parseConnText(line: string): Connector | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens.length < 14) return null
  const connType = Number(tokens[0])
  const subType = Number(tokens[1])
  if (!Number.isFinite(connType) || !Number.isFinite(subType)) return null

  const matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as ConnMatrix
  for (let i = 0; i < 12; i++) {
    const raw = Number(tokens[2 + i])
    if (!Number.isFinite(raw)) return null
    matrix[i] = NEGATED.has(i) ? neg(raw) : raw
  }
  const rest = tokens.slice(14)
  const num = (i: number) => Number(rest[i])

  switch (connType) {
    case PhysicalT.Axle:
      return {
        connType: PhysicalT.Axle,
        subType,
        matrix,
        isStartCapped: num(0) === 1,
        isEndCapped: num(1) === 1,
        length: (num(2) || 0) * 25,
        isGrabbing: num(3) === 1,
        isRequireGrabbing: num(4) === 1,
      }
    case PhysicalT.Ball:
      return { connType: PhysicalT.Ball, subType, matrix }
    case PhysicalT.Hole:
    case PhysicalT.Stud: {
      const height = Math.round(num(0) || 0)
      const width = Math.round(num(1) || 0)
      const grid = rest[2] ?? ''
      const items = grid.split(',').map((s) => {
        const [a, o] = s.split(':')
        return { altitude: Number(a) || 0, occupiedArea: Number(o) || 0 }
      })
      const cells: MatrixItem[][] = []
      for (let i = 0; i <= height; i++) {
        const row: MatrixItem[] = []
        for (let j = 0; j <= width; j++) row.push(items[i * (width + 1) + j] ?? { altitude: 0, occupiedArea: 0 })
        cells.push(row)
      }
      return connType === PhysicalT.Hole
        ? { connType: PhysicalT.Hole, subType, matrix, height, width, cells }
        : { connType: PhysicalT.Stud, subType, matrix, height, width, cells }
    }
    case PhysicalT.Fixed:
      return { connType: PhysicalT.Fixed, subType, matrix, axes: Math.round(num(0) || 0), tag: rest[1] ?? '' }
    case PhysicalT.Hinge:
      return {
        connType: PhysicalT.Hinge,
        subType,
        matrix,
        flipLimMax: num(0) || 0,
        flipLimMin: num(1) || 0,
        limMax: num(2) || 0,
        limMin: num(3) || 0,
        isOriented: num(4) === 1,
        tag: rest[5] ?? '',
      }
    case PhysicalT.Rail:
      return { connType: PhysicalT.Rail, subType, matrix, length: num(0) || 0 }
    case PhysicalT.Slider:
      return {
        connType: PhysicalT.Slider,
        subType,
        matrix,
        isStartCapped: num(0) === 1,
        isEndCapped: num(1) === 1,
        length: (num(2) || 0) * 25,
        isCylindrical: num(3) === 1,
      }
    default:
      return null
  }
}

/** Serialize a connector to the `0 PE_CONN <text>` text form (without the `0 PE_CONN ` prefix). */
export function writeConnText(c: Connector): string {
  const m = c.matrix
  const stored = m.map((v, i) => (NEGATED.has(i) ? -v : v))
  const matrixText = stored.map(round6).join(' ')
  const b = (v: boolean) => (v ? '1' : '0')
  const head = `${c.connType} ${c.subType} ${matrixText}`

  switch (c.connType) {
    case PhysicalT.Axle:
      return `${head} ${b(c.isStartCapped)} ${b(c.isEndCapped)} ${round6(c.length / 25)} ${b(c.isGrabbing)} ${b(c.isRequireGrabbing)}`
    case PhysicalT.Ball:
      return head
    case PhysicalT.Hole:
    case PhysicalT.Stud: {
      const cells: string[] = []
      for (let i = 0; i <= c.height; i++) {
        for (let j = 0; j <= c.width; j++) {
          const cell = c.cells[i]?.[j] ?? { altitude: 0, occupiedArea: 0 }
          cells.push(`${cell.altitude}:${cell.occupiedArea}`)
        }
      }
      return `${head} ${c.height} ${c.width} ${cells.join(',')}`
    }
    case PhysicalT.Fixed:
      return c.tag ? `${head} ${c.axes} ${c.tag}` : `${head} ${c.axes}`
    case PhysicalT.Hinge:
      return `${head} ${round3(c.flipLimMax)} ${round3(c.flipLimMin)} ${round3(c.limMax)} ${round3(c.limMin)} ${b(c.isOriented)}${c.tag ? ` ${c.tag}` : ''}`
    case PhysicalT.Rail:
      return `${head} ${round6(c.length)}`
    case PhysicalT.Slider:
      return `${head} ${b(c.isStartCapped)} ${b(c.isEndCapped)} ${round6(c.length / 25)} ${b(c.isCylindrical)}`
  }
}

/* ----------------------------- factory helpers ----------------------------- */

/**
 * Editor color for a connector. Studs are red, holes
 * cyan, and axle-type connectors are blue (male/odd subtype) or yellow
 * (female/even subtype).
 */
export function connectorColor(c: Connector): number {
  switch (c.connType) {
    case PhysicalT.Stud:
      return 0xff2222
    case PhysicalT.Hole:
      return 0x00cccc
    case PhysicalT.Axle:
    case PhysicalT.Slider:
    case PhysicalT.Hinge:
    case PhysicalT.Ball:
    case PhysicalT.Fixed:
      return c.subType % 2 === 1 ? 0x2244ff : 0xffcc00
    default:
      return 0xcccccc
  }
}

const AXLE_NAMES: Record<number, string> = {
  [AxleT.TechnicPinSocket]: 'Technic Pin Socket',
  [AxleT.TechnicPin]: 'Technic Pin',
  [AxleT.TechnicPinWOHole]: 'Technic Pin (no hole)',
  [AxleT.AxleSocket]: 'Axle Socket',
  [AxleT.Axle]: 'Axle',
  [AxleT.AxleWidthGuard]: 'Axle Guard',
  [AxleT.RoundHole]: 'Round Hole',
  [AxleT.BarForRoundHole]: 'Bar for Round Hole',
  [AxleT.Clip]: 'Clip',
  [AxleT.Bar]: 'Bar',
  [AxleT.PinSocket]: 'Pin Socket',
  [AxleT.BarWithPinSocket]: 'Bar with Pin Socket',
  [AxleT.Pin]: 'Pin',
}

const HOLE_NAMES: Record<number, string> = {
  [HoleT.Brick]: 'Brick Bottom',
  [HoleT.Plate]: 'Plate Bottom',
  [HoleT.TechPinSocket]: 'Tech Pin Socket Bottom',
  [HoleT.Bar]: 'Bar Bottom',
  [HoleT.RoundHole]: 'Round Hole Bottom',
}

/** A short human-readable label for a connector. */
export function connectorLabel(c: Connector): string {
  switch (c.connType) {
    case PhysicalT.Stud:
      return 'Stud'
    case PhysicalT.Hole:
      return HOLE_NAMES[c.subType] ?? 'Bottom Hole'
    case PhysicalT.Axle:
      return AXLE_NAMES[c.subType] ?? 'Axle'
    case PhysicalT.Ball:
      return 'Ball'
    case PhysicalT.Fixed:
      return 'Fixed'
    case PhysicalT.Hinge:
      return 'Hinge'
    case PhysicalT.Rail:
      return 'Rail'
    case PhysicalT.Slider:
      return 'Slider'
    default:
      return `Connector ${(c as { connType: number }).connType}`
  }
}

/** Build the 3×3 grid cells for a single 1×1 stud/hole connector. */
function singleCellGrid(center: MatrixItem): MatrixItem[][] {
  return [
    [{ altitude: 3, occupiedArea: 1 }, { altitude: 0, occupiedArea: 4 }, { altitude: 3, occupiedArea: 1 }],
    [{ altitude: 0, occupiedArea: 4 }, center, { altitude: 0, occupiedArea: 4 }],
    [{ altitude: 3, occupiedArea: 1 }, { altitude: 0, occupiedArea: 4 }, { altitude: 3, occupiedArea: 1 }],
  ]
}

/** A 1×1 stud connector (grid origin at the cell's top-left, so offset -10 LDU). */
export function makeStudConnector(position: Vec3, altitude = 10, subType: number = 0): Connector {
  return {
    connType: PhysicalT.Stud,
    subType,
    matrix: withPosition(identityMatrix(), { x: position.x - 10, y: position.y, z: position.z - 10 }),
    height: 2,
    width: 2,
    cells: singleCellGrid({ altitude, occupiedArea: 4 }),
  }
}

/** A 1×1 anti-stud (hole) connector. */
export function makeHoleConnector(position: Vec3, altitude = 10, subType: number = HoleT.Brick): Connector {
  return {
    connType: PhysicalT.Hole,
    subType,
    matrix: withPosition(identityMatrix(), { x: position.x - 10, y: position.y, z: position.z - 10 }),
    height: 2,
    width: 2,
    cells: singleCellGrid({ altitude, occupiedArea: 4 }),
  }
}

/** An axle-type connector (also used for pins, clips, bars, round holes). */
export function makeAxleConnector(position: Vec3, subType: number, length: number): Connector {
  return {
    connType: PhysicalT.Axle,
    subType,
    matrix: withPosition(identityMatrix(), position),
    isStartCapped: false,
    isEndCapped: subType === AxleT.RoundHole,
    length,
    isGrabbing: false,
    isRequireGrabbing: false,
  }
}

/**
 * A Stud connector whose grid covers a dragged region of whole studs. Cell
 * spacing is 10 LDU (half a stud); a W×H region produces a (2W+1)×(2H+1)
 * grid where odd×odd cells are studs, even×even are corners, the rest edges.
 */
export function makeStudGridConnector(
  loX: number,
  loZ: number,
  hiX: number,
  hiZ: number,
  y: number,
  altitude = 10,
  subType: number = 0,
): Connector {
  const { height, width, cells } = buildRegionGrid(loX, loZ, hiX, hiZ, altitude)
  return {
    connType: PhysicalT.Stud,
    subType,
    matrix: withPosition(identityMatrix(), { x: loX - 10, y, z: loZ - 10 }),
    height,
    width,
    cells,
  }
}

/** An anti-stud (Hole) connector covering a dragged region of whole cells. */
export function makeHoleGridConnector(
  loX: number,
  loZ: number,
  hiX: number,
  hiZ: number,
  y: number,
  altitude = 10,
  subType: number = HoleT.Brick,
): Connector {
  const { height, width, cells } = buildRegionGrid(loX, loZ, hiX, hiZ, altitude)
  return {
    connType: PhysicalT.Hole,
    subType,
    matrix: withPosition(identityMatrix(), { x: loX - 10, y, z: loZ - 10 }),
    height,
    width,
    cells,
  }
}

/** Build the (2W+1)×(2H+1) grid for a W×H dragged region of whole cells. */
function buildRegionGrid(loX: number, loZ: number, hiX: number, hiZ: number, altitude: number) {
  const studsX = Math.max(1, Math.round((hiX - loX) / 20) + 1)
  const studsZ = Math.max(1, Math.round((hiZ - loZ) / 20) + 1)
  const height = 2 * studsX
  const width = 2 * studsZ
  const cells: MatrixItem[][] = []
  for (let i = 0; i <= height; i++) {
    const row: MatrixItem[] = []
    for (let j = 0; j <= width; j++) {
      if (i % 2 === 1 && j % 2 === 1) row.push({ altitude, occupiedArea: 4 })
      else if (i % 2 === 0 && j % 2 === 0) row.push({ altitude: 3, occupiedArea: 1 })
      else row.push({ altitude: 0, occupiedArea: 4 })
    }
    cells.push(row)
  }
  return { height, width, cells }
}
