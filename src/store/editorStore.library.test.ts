import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editorStore'
import { defaultLdrawProvider } from '../lib/file-provider'

/** Minimal stand-in for a `File` as produced by a folder selection. */
function fakeFile(path: string, text: string): File {
  return {
    name: path.split('/').pop() ?? path,
    webkitRelativePath: path,
    text: async () => text,
  } as unknown as File
}

describe('editorStore — LDraw library source', () => {
  beforeEach(async () => {
    await useEditorStore.getState().detachLibrary()
  })

  it('starts out on the server-provided library', () => {
    const library = useEditorStore.getState().library
    expect(library.mode).toBe('server')
    expect(library.ldrawName).toBeNull()
    expect(library.topDirs).toEqual([])
  })

  it('swaps the file provider when a folder is attached', async () => {
    await useEditorStore.getState().attachLdrawFiles([
      fakeFile('ldraw/parts/3005.dat', 'brick from disk'),
      fakeFile('ldraw/p/4-4cyli.dat', 'cylinder from disk'),
    ])

    const library = useEditorStore.getState().library
    expect(library.mode).toBe('local')
    expect(library.ldrawName).toBe('ldraw')
    expect(library.revision).toBeGreaterThan(0)
    expect(library.topDirs.sort()).toEqual(['p', 'parts'])

    // Reads now come from the picked folder, through the search paths.
    expect(await defaultLdrawProvider.load('3005.dat')).toBe('brick from disk')
    expect(await defaultLdrawProvider.load('4-4cyli.dat')).toBe('cylinder from disk')
  })

  it('ignores an empty selection instead of clearing the library', async () => {
    await useEditorStore.getState().attachLdrawFiles([fakeFile('ldraw/parts/3005.dat', 'brick')])
    const before = useEditorStore.getState().library

    await useEditorStore.getState().attachLdrawFiles([])

    const after = useEditorStore.getState().library
    expect(after.mode).toBe('local')
    expect(after.revision).toBe(before.revision)
    expect(await defaultLdrawProvider.load('3005.dat')).toBe('brick')
  })

  it('goes back to the server library on detach', async () => {
    await useEditorStore.getState().attachLdrawFiles([fakeFile('ldraw/parts/3005.dat', 'brick')])
    const attached = useEditorStore.getState().library.revision

    await useEditorStore.getState().detachLibrary()

    const library = useEditorStore.getState().library
    expect(library.mode).toBe('server')
    expect(library.ldrawName).toBeNull()
    // The revision still moves so views rebuild against the new source.
    expect(library.revision).toBe(attached + 1)
    // No folder attached, so nothing resolves locally any more.
    expect(await defaultLdrawProvider.load('3005.dat')).toBeNull()
  })

  it('reports folder and permission errors without wedging the busy flag', () => {
    const store = useEditorStore.getState()
    store.setLibraryBusy(true)
    expect(useEditorStore.getState().library.busy).toBe(true)

    store.setLibraryError('Could not read that folder.')
    expect(useEditorStore.getState().library).toMatchObject({
      busy: false,
      error: 'Could not read that folder.',
    })
  })
})
