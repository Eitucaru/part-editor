import { describe, it, expect } from 'vitest'
import { buildDocumentGeometry } from './geometry-builder'
import { MemoryLdrawProvider } from './file-provider'
import { parseLDraw } from '../core'
import { getColorRgbLinear } from './ldraw-colors'

function rgbTimes(code: number, count: number): number[] {
  const rgb = getColorRgbLinear(code)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(rgb[0], rgb[1], rgb[2])
  return out
}

describe('buildDocumentGeometry — direct geometry', () => {
  it('flattens a triangle with source metadata', async () => {
    const { document } = parseLDraw('3 16 0 0 0 1 0 0 0 1 0')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    // Y is flipped (LDraw -Y up → scene +Y up) and winding is reversed.
    expect(built.direct.facePositions).toEqual([0, 0, 0, 0, -1, 0, 1, 0, 0])
    expect(built.direct.faceColors).toEqual(rgbTimes(16, 3))
    expect(built.direct.faceLineIndices).toEqual([1, 1, 1])
    expect(built.direct.faceVertexIndices).toEqual([0, 2, 1])
  })

  it('splits quads into two triangles preserving vertex indices', async () => {
    const { document } = parseLDraw('4 4 0 0 0 1 0 0 1 1 0 0 1 0')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.direct.facePositions).toHaveLength(18) // 6 vertices × 3
    expect(built.direct.faceVertexIndices).toEqual([0, 2, 1, 0, 3, 2])
  })

  it('collects edge lines with endpoint indices', async () => {
    const { document } = parseLDraw('2 24 0 0 0 0 1 0')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.direct.edgePositions).toEqual([0, 0, 0, 0, -1, 0])
    expect(built.direct.edgeVertexIndices).toEqual([0, 1])
  })
})

describe('buildDocumentGeometry — sub-files', () => {
  it('builds a part hierarchy with local coordinates and inherited colors', async () => {
    const provider = new MemoryLdrawProvider({ 'sub.dat': '3 16 1 0 0 0 1 0 0 0 1' })
    const { document } = parseLDraw('1 4 10 20 30 1 0 0 0 1 0 0 0 1 sub.dat')
    const built = await buildDocumentGeometry(document, provider)

    expect(built.parts).toHaveLength(1)
    const part = built.parts[0]
    expect(part.lineNumber).toBe(1)
    expect(part.file).toBe('sub.dat')
    expect(part.position).toEqual({ x: 10, y: -20, z: 30 })
    // Child geometry stays in local coordinates (no transform baked), Y-flipped.
    expect(part.direct.facePositions).toEqual([1, 0, 0, 0, 0, 1, 0, -1, 0])
    // Color 16 inside the child inherits the parent's color 4.
    expect(part.direct.faceColors).toEqual(rgbTimes(4, 3))
  })

  it('reports missing files without failing', async () => {
    const { document } = parseLDraw('1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing.dat')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.missingFiles).toEqual(['missing.dat'])
    expect(built.parts).toEqual([])
  })

  it('resolves MPD internal models without a provider', async () => {
    const text = [
      '0 FILE main.ldr',
      '0 Name: main.ldr',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr',
      '0 NOFILE',
      '0 FILE sub.ldr',
      '0 Name: sub.ldr',
      '3 16 0 0 0 2 0 0 0 2 0',
      '0 NOFILE',
    ].join('\n')
    const { document } = parseLDraw(text)
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.parts).toHaveLength(1)
    expect(built.parts[0].direct.facePositions).toEqual([0, 0, 0, 0, -2, 0, 2, 0, 0])
    expect(built.missingFiles).toEqual([])
  })
})

describe('buildDocumentGeometry — BFC winding', () => {
  it('reverses winding for CERTIFY CW files', async () => {
    const { document } = parseLDraw('0 BFC CERTIFY CW\n3 16 0 0 0 1 0 0 0 1 0')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.direct.faceVertexIndices).toEqual([0, 1, 2])
  })

  it('inverts the winding of an INVERTNEXT sub-file', async () => {
    const provider = new MemoryLdrawProvider({ 'sub.dat': '3 16 0 0 0 1 0 0 0 1 0' })
    const { document } = parseLDraw('0 BFC INVERTNEXT\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.dat')
    const built = await buildDocumentGeometry(document, provider)
    expect(built.parts).toHaveLength(1)
    expect(built.parts[0].direct.faceVertexIndices).toEqual([0, 1, 2])
  })

  it('combines a mirrored matrix with INVERTNEXT', async () => {
    const provider = new MemoryLdrawProvider({ 'sub.dat': '3 16 0 0 0 1 0 0 0 1 0' })
    // Mirrored matrix (determinant < 0) plus INVERTNEXT: the winding sign
    // flips once for the directive; mirroring is handled by the scene matrix.
    const text = [
      '0 BFC INVERTNEXT',
      '1 16 0 0 0 -1 0 0 0 1 0 0 0 1 sub.dat',
    ].join('\n')
    const { document } = parseLDraw(text)
    const built = await buildDocumentGeometry(document, provider)
    expect(built.parts[0].direct.faceVertexIndices).toEqual([0, 1, 2])
  })

  it('tracks color codes through the geometry', async () => {
    const { document } = parseLDraw('3 4 0 0 0 1 0 0 0 1 0')
    const built = await buildDocumentGeometry(document, new MemoryLdrawProvider())
    expect(built.direct.faceColorCodes).toEqual([4, 4, 4])
  })
})
