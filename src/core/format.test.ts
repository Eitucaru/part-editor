import { describe, it, expect } from 'vitest'
import { formatNumber, parseColor, parseNumber } from './format'

describe('formatNumber', () => {
  it('formats integers without a decimal point', () => {
    expect(formatNumber(1)).toBe('1')
    expect(formatNumber(-2)).toBe('-2')
  })

  it('strips trailing zeros', () => {
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatNumber(1.0)).toBe('1')
    expect(formatNumber(0.5)).toBe('0.5')
  })

  it('normalizes negative zero', () => {
    expect(formatNumber(-0)).toBe('0')
    // A value that rounds to zero must not keep a negative sign.
    expect(formatNumber(-0.00004, 4)).toBe('0')
  })

  it('rounds to the requested precision', () => {
    expect(formatNumber(1.23456, 4)).toBe('1.2346')
    expect(formatNumber(2 / 3, 4)).toBe('0.6667')
  })

  it('handles floating point noise', () => {
    expect(formatNumber(0.1 + 0.2, 4)).toBe('0.3')
  })

  it('returns 0 for non-finite input', () => {
    expect(formatNumber(NaN)).toBe('0')
    expect(formatNumber(Infinity)).toBe('0')
  })
})

describe('parseNumber', () => {
  it('parses valid numbers', () => {
    expect(parseNumber('1')).toBe(1)
    expect(parseNumber('-0.5')).toBe(-0.5)
    expect(parseNumber('1e3')).toBe(1000)
  })

  it('rejects incomplete or invalid tokens', () => {
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('.')).toBeNull()
    expect(parseNumber('-.')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('parseColor', () => {
  it('parses decimal and hexadecimal colors', () => {
    expect(parseColor('16')).toBe(16)
    expect(parseColor('0x2FFFFFF')).toBe(0x2ffffff)
    expect(parseColor('24')).toBe(24)
  })

  it('rejects non-numeric colors', () => {
    expect(parseColor('main-color')).toBeNull()
  })
})
