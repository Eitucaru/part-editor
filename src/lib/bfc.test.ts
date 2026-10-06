import { describe, it, expect } from 'vitest'
import { parseLDraw } from '../core'
import { isInvertNext, modelCertified, modelWinding } from './bfc'

describe('bfc — modelWinding', () => {
  it('reports CCW certification', () => {
    const { document } = parseLDraw('0 BFC CERTIFY CCW\n3 16 0 0 0 1 0 0 0 1 0')
    expect(modelWinding(document.models[0])).toBe('ccw')
    expect(modelCertified(document.models[0])).toBe(true)
  })

  it('reports CW certification', () => {
    const { document } = parseLDraw('0 BFC CERTIFY CW\n3 16 0 0 0 1 0 0 0 1 0')
    expect(modelWinding(document.models[0])).toBe('cw')
  })

  it('reports none when uncertified', () => {
    const { document } = parseLDraw('3 16 0 0 0 1 0 0 0 1 0')
    expect(modelWinding(document.models[0])).toBe('none')
    expect(modelCertified(document.models[0])).toBe(false)
  })

  it('last CERTIFY wins', () => {
    const { document } = parseLDraw('0 BFC CERTIFY CCW\n0 BFC CERTIFY CW')
    expect(modelWinding(document.models[0])).toBe('cw')
  })
})

describe('bfc — INVERTNEXT', () => {
  it('detects the directive', () => {
    const { document } = parseLDraw('0 BFC INVERTNEXT\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 x.dat')
    const [invert, sub] = document.models[0].commands
    expect(isInvertNext(invert as never)).toBe(true)
    expect(isInvertNext(sub as never)).toBe(false)
  })

  it('ignores other BFC statements', () => {
    const { document } = parseLDraw('0 BFC CERTIFY CCW')
    expect(isInvertNext(document.models[0].commands[0] as never)).toBe(false)
  })
})
