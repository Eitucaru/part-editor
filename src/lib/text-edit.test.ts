import { describe, it, expect } from 'vitest'
import { appendLine, getLine, insertLine, removeLine, replaceLine } from './text-edit'

const CODE = 'line 1\nline 2\nline 3'

describe('replaceLine', () => {
  it('replaces a line in place', () => {
    expect(replaceLine(CODE, 2, 'CHANGED')).toBe('line 1\nCHANGED\nline 3')
  })

  it('ignores out-of-range line numbers', () => {
    expect(replaceLine(CODE, 99, 'x')).toBe(CODE)
  })
})

describe('insertLine', () => {
  it('inserts before a line', () => {
    expect(insertLine(CODE, 2, 'NEW')).toBe('line 1\nNEW\nline 2\nline 3')
  })

  it('appends when beyond the end', () => {
    expect(insertLine(CODE, 99, 'END')).toBe('line 1\nline 2\nline 3\nEND')
  })
})

describe('removeLine', () => {
  it('removes a line', () => {
    expect(removeLine(CODE, 2)).toBe('line 1\nline 3')
  })
})

describe('appendLine', () => {
  it('appends and reports the new line number', () => {
    const result = appendLine(CODE, 'line 4')
    expect(result.code).toBe('line 1\nline 2\nline 3\nline 4')
    expect(result.lineNumber).toBe(4)
  })

  it('handles an empty document', () => {
    const result = appendLine('', 'first')
    expect(result.code).toBe('first')
    expect(result.lineNumber).toBe(1)
  })
})

describe('getLine', () => {
  it('returns a line by 1-based index', () => {
    expect(getLine(CODE, 1)).toBe('line 1')
    expect(getLine(CODE, 3)).toBe('line 3')
    expect(getLine(CODE, 99)).toBe('')
  })
})
