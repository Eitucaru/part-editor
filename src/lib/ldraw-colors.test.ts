import { describe, it, expect } from 'vitest'
import { getColorHex, getColorRgbLinear } from './ldraw-colors'

describe('getColorHex', () => {
  it('maps standard palette colors', () => {
    expect(getColorHex(0)).toBe(0x05131d)
    expect(getColorHex(4)).toBe(0xc91a09)
    expect(getColorHex(15)).toBe(0xffffff)
  })

  it('decodes custom 0x2RRGGBB colors', () => {
    expect(getColorHex(0x2ffffff)).toBe(0xffffff)
    expect(getColorHex(0x2ff0000)).toBe(0xff0000)
  })

  it('falls back to a default for unknown codes', () => {
    expect(getColorHex(999999)).toBe(0xcccccc)
  })
})

describe('getColorRgbLinear', () => {
  it('returns linear components in 0..1', () => {
    const white = getColorRgbLinear(15)
    expect(white[0]).toBeCloseTo(1)
    expect(white[1]).toBeCloseTo(1)
    expect(white[2]).toBeCloseTo(1)

    const black = getColorRgbLinear(24)
    expect(black[0]).toBeCloseTo(0)
    expect(black[1]).toBeCloseTo(0)
    expect(black[2]).toBeCloseTo(0)
  })
})
