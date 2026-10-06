import { describe, it, expect } from 'vitest'
import { mergeReference } from './merge'
import { MemoryLdrawProvider } from './file-provider'
import { getModelBlock } from './workspace'
import { parseLDraw } from '../core'

const MPD = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick.dat',
  '0 NOFILE',
  '',
  '0 FILE brick.dat',
  '0 Brick',
  '3 16 0 0 0 4 0 0 0 4 0',
  '0 NOFILE',
].join('\n')

describe('mergeReference', () => {
  it('inlines a referenced workspace file, replacing the reference', async () => {
    const provider = new MemoryLdrawProvider({})
    const { document } = parseLDraw(MPD)
    const ref = document.models[0].commands.find((c) => c.kind === 'subfile')
    const out = await mergeReference(MPD, ref!.lineNumber, provider)

    expect(out).not.toBeNull()
    const main = getModelBlock(out!, 'main.ldr')
    expect(main).not.toContain('1 16')
    expect(main).toContain('3 16')
    // The brick block itself remains in the workspace (only the reference is inlined).
    expect(out).toContain('0 FILE brick.dat')
  })
})
