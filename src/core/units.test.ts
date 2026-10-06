import { describe, it, expect } from 'vitest'
import { convertLength, fromLdu, toLdu } from './units'

describe('units', () => {
  it('converts studs to LDU', () => {
    expect(toLdu(1, 'stud')).toBe(20)
    expect(toLdu(2, 'stud')).toBe(40)
  })

  it('converts LDU back to studs', () => {
    expect(fromLdu(20, 'stud')).toBe(1)
  })

  it('converts millimetres to LDU', () => {
    expect(toLdu(1, 'mm')).toBe(2.5)
    expect(toLdu(8, 'mm')).toBe(20)
  })

  it('converts between units', () => {
    expect(convertLength(1, 'stud', 'mm')).toBe(8)
    expect(convertLength(8, 'mm', 'stud')).toBe(1)
    expect(convertLength(1, 'inch', 'stud')).toBe(3.2)
  })
})
