import { describe, it, expect } from 'vitest'
import { formatLDraw, minifyLDraw, serializeLDraw } from './serializer'
import { parseLDraw } from './parser'

const SOURCE = [
  '0 Name: test.dat',
  '0 Author: Test',
  '',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
  '2 24 0 0 0 0 1 0',
  '0 BFC CERTIFY CCW',
  '3 16 0 0 0 1 0 0 0 1 0',
].join('\n')

describe('serializeLDraw — pretty', () => {
  it('uses 3-space group separators and blank-line separation', () => {
    const { text } = formatLDraw(SOURCE, { mode: 'pretty', finalNewline: false })
    expect(text).toBe(
      [
        '0 Name: test.dat',
        '0 Author: Test',
        '1 16   0 0 0   1 0 0   0 1 0   0 0 1 stud.dat',
        '2 24   0 0 0   0 1 0',
        '',
        '0 BFC CERTIFY CCW',
        '3 16   0 0 0   1 0 0   0 1 0',
      ].join('\n'),
    )
  })

  it('appends a trailing newline by default', () => {
    const { text } = formatLDraw('0 Name: x\n', { mode: 'pretty' })
    expect(text).toBe('0 Name: x\n')
  })
})

describe('serializeLDraw — compact', () => {
  it('uses single spaces and no inserted blank lines', () => {
    const { text } = formatLDraw(SOURCE, { mode: 'compact', finalNewline: false })
    expect(text).toBe(
      [
        '0 Name: test.dat',
        '0 Author: Test',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
        '2 24 0 0 0 0 1 0',
        '0 BFC CERTIFY CCW',
        '3 16 0 0 0 1 0 0 0 1 0',
      ].join('\n'),
    )
  })
})

describe('serializeLDraw — minified', () => {
  it('reduces number precision', () => {
    const input = '3 16 0.12345 0 0 1 0 0 0 1 0\n'
    const { text } = minifyLDraw(input, { finalNewline: false })
    expect(text).toBe('3 16 0.123 0 0 1 0 0 0 1 0')
  })

  it('collapses whitespace and blank lines', () => {
    const input = '1 16   0   0   0   1   0   0   0   1   0   0   0   1   x.dat\n\n\n2 24 0 0 0 0 1 0\n'
    const { text } = minifyLDraw(input, { finalNewline: false })
    expect(text).toBe('1 16 0 0 0 1 0 0 0 1 0 0 0 1 x.dat\n2 24 0 0 0 0 1 0')
  })
})

describe('round-tripping', () => {
  it('is lossless across parse → serialize', () => {
    const { document } = parseLDraw(SOURCE)
    const out = serializeLDraw(document, { mode: 'pretty', finalNewline: false })
    const reparsed = parseLDraw(out).document

    const original = document.models[0].commands[2]
    const roundTripped = reparsed.models[0].commands[2]

    expect(roundTripped.kind).toBe(original.kind)
    if (original.kind === 'subfile' && roundTripped.kind === 'subfile') {
      expect(roundTripped.file).toBe(original.file)
      expect(roundTripped.color).toBe(original.color)
      expect(roundTripped.position).toEqual(original.position)
      expect(roundTripped.matrix).toEqual(original.matrix)
      expect(roundTripped.inverted).toBe(original.inverted)
    }
  })

  it('is idempotent for pretty mode', () => {
    const once = formatLDraw(SOURCE, { mode: 'pretty', finalNewline: false }).text
    const twice = formatLDraw(once, { mode: 'pretty', finalNewline: false }).text
    expect(twice).toBe(once)
  })

  it('is idempotent for minified mode', () => {
    const once = minifyLDraw(SOURCE, { finalNewline: false }).text
    const twice = minifyLDraw(once, { finalNewline: false }).text
    expect(twice).toBe(once)
  })
})

describe('serializeLDraw — MPD', () => {
  it('re-emits FILE/NOFILE wrappers', () => {
    const text = [
      '0 FILE a.ldr',
      '0 Name: a.ldr',
      '2 24 0 0 0 0 1 0',
      '0 NOFILE',
      '',
      '0 FILE b.ldr',
      '0 Name: b.ldr',
      '3 16 0 0 0 1 0 0 0 1 0',
      '0 NOFILE',
    ].join('\n')
    const { text: out } = formatLDraw(text, { mode: 'compact', finalNewline: false })
    expect(out).toBe(
      [
        '0 FILE a.ldr',
        '0 Name: a.ldr',
        '2 24 0 0 0 0 1 0',
        '0 NOFILE',
        '0 FILE b.ldr',
        '0 Name: b.ldr',
        '3 16 0 0 0 1 0 0 0 1 0',
        '0 NOFILE',
      ].join('\n'),
    )
  })
})
