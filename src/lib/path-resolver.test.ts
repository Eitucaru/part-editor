import { describe, it, expect } from 'vitest'
import { resolveCandidates } from './path-resolver'

describe('resolveCandidates', () => {
  it('prefers high-resolution primitives first', () => {
    const candidates = resolveCandidates('stud.dat')
    expect(candidates[0]).toBe('p/48/stud.dat')
    expect(candidates[1]).toBe('p/stud.dat')
    expect(candidates[2]).toBe('p/8/stud.dat')
    expect(candidates[3]).toBe('parts/stud.dat')
  })

  it('routes s/ prefixed names into parts/s', () => {
    expect(resolveCandidates('s/3069b.dat')).toEqual([
      'parts/s/3069b.dat',
      'UnOfficial/parts/s/3069b.dat',
    ])
  })

  it('normalizes backslashes', () => {
    const candidates = resolveCandidates('parts\\3001.dat')
    expect(candidates).toContain('parts/3001.dat')
  })
})
