import { describe, it, expect } from 'vitest'
import { parseLDraw, parseLine } from './parser'
import type { LineLine, OptionalLineLine, QuadLine, SubfileLine, TriangleLine } from './types'

describe('parseLine — subfile (type 1)', () => {
  it('parses a standard reference', () => {
    const cmd = parseLine('1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat', 1)
    expect(cmd.kind).toBe('subfile')
    const sub = cmd as SubfileLine
    expect(sub.color).toBe(16)
    expect(sub.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(sub.matrix).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    expect(sub.file).toBe('stud.dat')
    expect(sub.inverted).toBe(false)
  })

  it('flags mirrored matrices as inverted', () => {
    const cmd = parseLine('1 16 0 0 0 -1 0 0 0 1 0 0 0 1 stud.dat', 1)
    const sub = cmd as SubfileLine
    expect(sub.inverted).toBe(true)
  })

  it('preserves spaces in the file name', () => {
    const cmd = parseLine('1 16 0 0 0 1 0 0 0 1 0 0 0 1 My Part File.dat', 1)
    const sub = cmd as SubfileLine
    expect(sub.file).toBe('My Part File.dat')
  })

  it('parses hexadecimal colors', () => {
    const cmd = parseLine('1 0x2FFFFFF 0 0 0 1 0 0 0 1 0 0 0 1 x.dat', 1)
    const sub = cmd as SubfileLine
    expect(sub.color).toBe(0x2ffffff)
  })

  it('falls back to raw for incomplete lines', () => {
    const cmd = parseLine('1 16 0 0 0', 1)
    expect(cmd.kind).toBe('raw')
  })
})

describe('parseLine — edge (type 2)', () => {
  it('parses endpoints', () => {
    const cmd = parseLine('2 24 0 0 0 0 1 0', 1)
    expect(cmd.kind).toBe('line')
    const line = cmd as LineLine
    expect(line.from).toEqual({ x: 0, y: 0, z: 0 })
    expect(line.to).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('falls back to raw on wrong token count', () => {
    expect(parseLine('2 24 0 0 0 0 1', 1).kind).toBe('raw')
  })
})

describe('parseLine — triangle (type 3)', () => {
  it('parses three vertices', () => {
    const cmd = parseLine('3 16 0 0 0 1 0 0 0 1 0', 1)
    expect(cmd.kind).toBe('triangle')
    const tri = cmd as TriangleLine
    expect(tri.vertices).toHaveLength(3)
    expect(tri.vertices[2]).toEqual({ x: 0, y: 1, z: 0 })
    expect(tri.uv).toBeUndefined()
  })

  it('parses optional UV coordinates', () => {
    const cmd = parseLine('3 16 0 0 0 1 0 0 0 1 0 0.1 0.2 0.3 0.4 0.5 0.6', 1)
    const tri = cmd as TriangleLine
    expect(tri.uv).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
  })
})

describe('parseLine — quad (type 4)', () => {
  it('parses four vertices', () => {
    const cmd = parseLine('4 4 0 0 0 1 0 0 1 1 0 0 1 0', 1)
    expect(cmd.kind).toBe('quad')
    const quad = cmd as QuadLine
    expect(quad.vertices).toHaveLength(4)
  })
})

describe('parseLine — optional line (type 5)', () => {
  it('parses four vertices', () => {
    const cmd = parseLine('5 24 0 0 0 1 0 0 1 1 0 0 1 0', 1)
    expect(cmd.kind).toBe('optional-line')
    const opt = cmd as OptionalLineLine
    expect(opt.vertices).toHaveLength(4)
  })
})

describe('parseLine — comments and meta (type 0)', () => {
  it('extracts the keyword and rest', () => {
    const cmd = parseLine('0 BFC CERTIFY CCW', 1)
    expect(cmd.kind).toBe('comment')
    if (cmd.kind !== 'comment') return
    expect(cmd.keyword).toBe('BFC')
    expect(cmd.rest).toBe('CERTIFY CCW')
    expect(cmd.text).toBe('BFC CERTIFY CCW')
  })

  it('handles a bare 0 line', () => {
    const cmd = parseLine('0', 1)
    expect(cmd.kind).toBe('comment')
    if (cmd.kind !== 'comment') return
    expect(cmd.text).toBe('')
    expect(cmd.keyword).toBe('')
  })
})

describe('parseLine — malformed input', () => {
  it('treats unknown line types as raw', () => {
    expect(parseLine('9 16 0 0 0', 1).kind).toBe('raw')
    expect(parseLine('', 1).kind).toBe('raw')
  })
})

describe('parseLine — leading whitespace', () => {
  it('parses indented geometry lines', () => {
    const cmd = parseLine('  1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat', 1)
    expect(cmd.kind).toBe('subfile')
    expect((cmd as SubfileLine).file).toBe('stud.dat')
  })

  it('parses indented comment lines', () => {
    const cmd = parseLine('  0 BFC CERTIFY CCW', 1)
    expect(cmd.kind).toBe('comment')
    if (cmd.kind !== 'comment') return
    expect(cmd.keyword).toBe('BFC')
    expect(cmd.rest).toBe('CERTIFY CCW')
  })

  it('splits MPD blocks with indented FILE headers', () => {
    const text = '  0 FILE part.dat\n  0 Name: part.dat\n  1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat\n  0 NOFILE\n'
    const { document } = parseLDraw(text)
    expect(document.isMpd).toBe(true)
    expect(document.models).toHaveLength(1)
    expect(document.models[0].name).toBe('part.dat')
    expect(document.models[0].commands[0].kind).toBe('comment')
    expect(document.models[0].commands[1].kind).toBe('subfile')
  })
})

describe('parseLDraw — MPD splitting', () => {
  const mpd = [
    '0 FILE main.ldr',
    '0 Name: main.ldr',
    '1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.dat',
    '0 NOFILE',
    '',
    '0 FILE sub.dat',
    '0 Name: sub.dat',
    '2 24 0 0 0 0 1 0',
    '0 NOFILE',
  ].join('\n')

  it('splits models on FILE/NOFILE', () => {
    const { document, errors } = parseLDraw(mpd)
    expect(errors).toHaveLength(0)
    expect(document.isMpd).toBe(true)
    expect(document.models).toHaveLength(2)
    expect(document.models[0].name).toBe('main.ldr')
    expect(document.models[0].commands).toHaveLength(2)
    expect(document.models[1].name).toBe('sub.dat')
    expect(document.models[1].commands).toHaveLength(2)
  })
})

describe('parseLDraw — robustness', () => {
  it('strips a UTF-8 BOM and accepts CRLF', () => {
    const text = '\uFEFF0 Name: x\r\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.dat\r\n'
    const { document, errors } = parseLDraw(text)
    expect(errors).toHaveLength(0)
    expect(document.models).toHaveLength(1)
    expect(document.models[0].commands).toHaveLength(2)
  })

  it('extracts the description from a Description meta', () => {
    const { document } = parseLDraw('0 Brick 2 x 4\n0 Description: Test Brick\n2 24 0 0 0 0 1 0\n')
    expect(document.models[0].description).toBe('Test Brick')
  })

  it('reports malformed lines when not tolerant', () => {
    const { errors } = parseLDraw('3 16 0 0 0 1 0 0\n', { tolerant: false })
    expect(errors).toHaveLength(1)
  })
})
