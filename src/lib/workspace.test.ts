import { describe, it, expect } from 'vitest'
import { parseLDraw } from '../core'
import { appendToModelBlock, getFileNames, getModelBlock, isFileReferenced, matchFileName, mergeModelBlocks, removeModelBlock, replaceModelBlock, toMpd } from './workspace'

const MPD = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat',
  '0 NOFILE',
  '',
  '0 FILE brick.dat',
  '0 Brick',
  '2 24 0 0 0 0 1 0',
  '0 NOFILE',
].join('\n')

describe('toMpd', () => {
  it('wraps a single file', () => {
    const out = toMpd('0 Part\n2 24 0 0 0 0 1 0', 'part.dat')
    expect(out).toBe('0 FILE part.dat\n0 Part\n2 24 0 0 0 0 1 0\n0 NOFILE')
  })

  it('keeps an existing MPD', () => {
    expect(toMpd(MPD)).toBe(MPD)
  })
})

describe('block helpers', () => {
  it('extracts a file block', () => {
    expect(getModelBlock(MPD, 'main.ldr')).toBe('0 Name: main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat')
    expect(getModelBlock(MPD, 'brick.dat')).toBe('0 Brick\n2 24 0 0 0 0 1 0')
  })

  it('replaces a file block', () => {
    const out = replaceModelBlock(MPD, 'brick.dat', '0 New Brick\n3 16 0 0 0 1 0 0 0 1 0')
    expect(getModelBlock(out, 'brick.dat')).toBe('0 New Brick\n3 16 0 0 0 1 0 0 0 1 0')
    expect(getModelBlock(out, 'main.ldr')).toBe('0 Name: main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat')
  })

  it('appends to a file block with the correct global line number', () => {
    const { code, lineNumber } = appendToModelBlock(MPD, 'brick.dat', '3 16 0 0 0 0 0 1 1 0 0')
    expect(getModelBlock(code, 'brick.dat')).toBe('0 Brick\n2 24 0 0 0 0 1 0\n3 16 0 0 0 0 0 1 1 0 0')
    // The new line is inserted before the block's `0 NOFILE` (global line 9).
    expect(lineNumber).toBe(9)
  })

  it('removes a file block', () => {
    const out = removeModelBlock(MPD, 'brick.dat')
    const { document } = parseLDraw(out)
    expect(getFileNames(document)).toEqual(['main.ldr'])
    expect(getModelBlock(out, 'main.ldr')).toBe('0 Name: main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat')
  })

  it('detects file references by basename', () => {
    const { document } = parseLDraw(MPD)
    expect(isFileReferenced(document, 'brick.dat')).toBe(true)
    expect(isFileReferenced(document, 'p\\brick.dat')).toBe(true)
    expect(isFileReferenced(document, 'other.dat')).toBe(false)
  })

  it('merges imported blocks, replacing same-name files', () => {
    const incoming = [
      '0 FILE plate.dat',
      '0 Plate',
      '2 24 1 0 0 0 1 0',
      '0 NOFILE',
      '',
      '0 FILE brick.dat',
      '0 Updated Brick',
      '3 16 0 0 0 1 0 0 0 1 0',
      '0 NOFILE',
    ].join('\n')
    const out = mergeModelBlocks(MPD, incoming)
    const { document } = parseLDraw(out)
    expect(getFileNames(document)).toEqual(['main.ldr', 'brick.dat', 'plate.dat'])
    expect(getModelBlock(out, 'brick.dat')).toBe('0 Updated Brick\n3 16 0 0 0 1 0 0 0 1 0')
    expect(getModelBlock(out, 'plate.dat')).toBe('0 Plate\n2 24 1 0 0 0 1 0')
    expect(getModelBlock(out, 'main.ldr')).toBe('0 Name: main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat')
  })
})

describe('getFileNames / matchFileName', () => {
  it('lists named models and matches by basename', () => {
    const { document } = parseLDraw(MPD)
    expect(getFileNames(document)).toEqual(['main.ldr', 'brick.dat'])
    expect(matchFileName(getFileNames(document), 'brick.dat')).toBe(1)
    expect(matchFileName(getFileNames(document), 'other.dat')).toBe(-1)
  })
})
