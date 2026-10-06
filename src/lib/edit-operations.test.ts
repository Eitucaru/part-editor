import { describe, it, expect } from 'vitest'
import { makeSubfileCommand, serializeCommandLike, setSubfileTransform, setVertexPosition } from './edit-operations'
import { parseLDraw } from '../core'
import type { QuadLine, SubfileLine, TriangleLine } from '../core'

describe('makeSubfileCommand', () => {
  it('builds an identity-placed reference', () => {
    const cmd = makeSubfileCommand('stud.dat')
    expect(cmd.kind).toBe('subfile')
    expect(cmd.file).toBe('stud.dat')
    expect(cmd.color).toBe(16)
    expect(cmd.inverted).toBe(false)
  })
})

describe('setSubfileTransform', () => {
  it('updates position, matrix, and the mirrored flag', () => {
    const cmd = makeSubfileCommand('x.dat')
    const updated = setSubfileTransform(cmd, { x: 1, y: 2, z: 3 }, { a: -1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    expect(updated.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(updated.matrix.a).toBe(-1)
    expect(updated.inverted).toBe(true)
  })
})

describe('setVertexPosition', () => {
  it('moves a triangle vertex', () => {
    const { document } = parseLDraw('3 16 0 0 0 1 0 0 0 1 0')
    const tri = document.models[0].commands[0] as TriangleLine
    const updated = setVertexPosition(tri, 2, { x: 5, y: 5, z: 5 }) as TriangleLine
    expect(updated.vertices[2]).toEqual({ x: 5, y: 5, z: 5 })
    expect(updated.vertices[0]).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('moves a quad vertex', () => {
    const { document } = parseLDraw('4 4 0 0 0 1 0 0 1 1 0 0 1 0')
    const quad = document.models[0].commands[0] as QuadLine
    const updated = setVertexPosition(quad, 3, { x: 9, y: 9, z: 9 }) as QuadLine
    expect(updated.vertices[3]).toEqual({ x: 9, y: 9, z: 9 })
  })
})

describe('serializeCommandLike', () => {
  it('matches compact style', () => {
    const cmd = makeSubfileCommand('stud.dat')
    expect(serializeCommandLike(cmd, '2 24 0 0 0 0 1 0')).toBe('1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat')
  })

  it('matches pretty style', () => {
    const cmd = makeSubfileCommand('stud.dat')
    expect(serializeCommandLike(cmd, '2 24   0 0 0   0 1 0')).toBe('1 16   0 0 0   1 0 0   0 1 0   0 0 1 stud.dat')
  })
})

describe('subfile round-trip through the serializer', () => {
  it('produces parseable output', () => {
    const cmd = makeSubfileCommand('stud.dat', 4, { x: 10, y: 20, z: 30 })
    const text = serializeCommandLike(cmd, '1 16 0 0 0 1 0 0 0 1 0 0 0 1 x.dat')
    const reparsed = parseLDraw(text).document.models[0].commands[0] as SubfileLine
    expect(reparsed.color).toBe(4)
    expect(reparsed.position).toEqual({ x: 10, y: 20, z: 30 })
  })
})
