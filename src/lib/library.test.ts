import { describe, expect, it } from 'vitest'
import { FileMapLibraryFs, HandleLibraryFs, folderFromDrop, normalizeRel } from './library-fs'
import type { DirectoryHandleLike, FileHandleLike } from './library-fs'
import { DirectoryLdrawProvider } from './file-provider'

/** Minimal stand-in for a `File` (only `text()` is used by the library code). */
function fakeFile(text: string): File {
  return { text: async () => text } as unknown as File
}

/** A `FileMapLibraryFs` built from `{ 'parts/3005.dat': '…' }` style paths. */
function fileMap(files: Record<string, string>, root = 'ldraw'): FileMapLibraryFs {
  return new FileMapLibraryFs(
    Object.entries(files).map(([path, text]) => ({ path: `${root}/${path}`, file: fakeFile(text) })),
    root,
  )
}

/* --------------------------- fake directory handle --------------------------- */

type FakeTree = { [name: string]: FakeTree | string }

function fakeDirectory(tree: FakeTree, name = 'ldraw'): DirectoryHandleLike {
  const handle: DirectoryHandleLike = {
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string): Promise<DirectoryHandleLike> {
      const value = tree[child]
      if (value === undefined || typeof value === 'string') throw new Error('NotFoundError')
      return fakeDirectory(value, child)
    },
    async getFileHandle(child: string): Promise<FileHandleLike> {
      const value = tree[child]
      if (typeof value !== 'string') throw new Error('NotFoundError')
      return { kind: 'file', name: child, getFile: async () => fakeFile(value) }
    },
    async *entries(): AsyncIterable<[string, FileHandleLike | DirectoryHandleLike]> {
      for (const [key, value] of Object.entries(tree)) {
        const entry: FileHandleLike | DirectoryHandleLike =
          typeof value === 'string'
            ? { kind: 'file', name: key, getFile: async () => fakeFile(value) }
            : fakeDirectory(value, key)
        yield [key, entry]
      }
    },
  }
  return handle
}

describe('normalizeRel', () => {
  it('normalizes separators and strips leading/trailing slashes', () => {
    expect(normalizeRel('\\parts\\3005.dat')).toBe('parts/3005.dat')
    expect(normalizeRel('./p/4-4cyli.dat')).toBe('p/4-4cyli.dat')
    expect(normalizeRel('/parts/s/1-4cyli.dat/')).toBe('parts/s/1-4cyli.dat')
  })
})

describe('FileMapLibraryFs', () => {
  it('reads relative to the picked root folder, case-insensitively', async () => {
    const fs = fileMap({ 'parts/3005.DAT': 'brick', 'p/4-4cyli.dat': 'cyl' })
    expect(fs.label).toBe('ldraw')
    expect(await fs.read('parts/3005.dat')).toBe('brick')
  })

  it('returns null for a missing file', async () => {
    const fs = fileMap({ 'parts/3005.dat': 'brick' })
    expect(await fs.read('parts/9999.dat')).toBeNull()
  })

  it('reports the top-level folders for the picked root', async () => {
    const fs = fileMap({ 'parts/3005.dat': 'a', 'p/4-4cyli.dat': 'b', 'parts/s/1.dat': 'c' })
    expect((await fs.topLevelDirs()).sort()).toEqual(['p', 'parts'])
  })
})

describe('HandleLibraryFs', () => {
  it('reads a nested file through directory handles', async () => {
    const fs = new HandleLibraryFs(fakeDirectory({ parts: { '3005.dat': 'brick' } }))
    expect(fs.label).toBe('ldraw')
    expect(await fs.read('parts/3005.dat')).toBe('brick')
  })

  it('falls back to a case-insensitive match on disk', async () => {
    const fs = new HandleLibraryFs(fakeDirectory({ PARTS: { '3005.DAT': 'brick' } }))
    expect(await fs.read('parts/3005.dat')).toBe('brick')
  })

  it('returns null when the folder or file is absent', async () => {
    const fs = new HandleLibraryFs(fakeDirectory({ parts: { '3005.dat': 'brick' } }))
    expect(await fs.read('p/4-4cyli.dat')).toBeNull()
    expect(await fs.read('parts/9999.dat')).toBeNull()
  })

  it('lists the top-level folders', async () => {
    const fs = new HandleLibraryFs(fakeDirectory({ parts: {}, p: {}, 'LDConfig.ldr': 'x' }))
    expect((await fs.topLevelDirs()).sort()).toEqual(['p', 'parts'])
  })
})

describe('folderFromDrop', () => {
  /** A drop event carrying a single item with the given capabilities. */
  function dropEvent(item: Record<string, unknown>): DragEvent {
    return { dataTransfer: { items: [{ kind: 'file', ...item }] } } as unknown as DragEvent
  }

  /** A folder that can be read through the legacy entries API only. */
  function legacyFolder(name: string) {
    let batches = 0
    return {
      isDirectory: true,
      isFile: false,
      name,
      createReader: () => ({
        readEntries: (callback: (entries: unknown[]) => void) => {
          batches += 1
          callback(
            batches === 1
              ? [
                  {
                    isDirectory: false,
                    isFile: true,
                    name: '3005.dat',
                    file: (cb: (file: File) => void) => cb(fakeFile('brick')),
                  },
                ]
              : [],
          )
        },
      }),
    }
  }

  it('prefers a directory handle that can actually be read', async () => {
    const handle = fakeDirectory({ parts: { '3005.dat': 'brick' } })
    const dropped = await folderFromDrop(dropEvent({ getAsFileSystemHandle: async () => handle }))
    expect(dropped?.handle).toBe(handle)
    expect(dropped?.label).toBe('ldraw')
    expect(dropped?.files).toEqual([])
  })

  it('falls back to plain files when the handle reads as empty', async () => {
    // A protected location yields a handle that enumerates to nothing.
    const handle = fakeDirectory({})
    const entry = legacyFolder('ldraw')
    const dropped = await folderFromDrop(
      dropEvent({ getAsFileSystemHandle: async () => handle, webkitGetAsEntry: () => entry }),
    )
    expect(dropped?.handle).toBeNull()
    expect(dropped?.label).toBe('ldraw')
    expect(dropped?.files).toHaveLength(1)
  })

  it('keeps the handle when neither path can read anything', async () => {
    const handle = fakeDirectory({})
    const dropped = await folderFromDrop(dropEvent({ getAsFileSystemHandle: async () => handle }))
    expect(dropped?.handle).toBe(handle)
  })

  it('ignores a dropped file instead of a folder', async () => {
    const dropped = await folderFromDrop(
      dropEvent({ getAsFileSystemHandle: async () => ({ kind: 'file', name: '3005.dat' }) }),
    )
    expect(dropped).toBeNull()
  })
})

describe('DirectoryLdrawProvider', () => {
  const library = fileMap({
    'parts/3005.dat': 'part brick',
    'p/48/4-4cyli.dat': 'hi-res cylinder',
    'p/4-4cyli.dat': 'lo-res cylinder',
    'parts/s/1-4cyli.dat': 'sub part',
  })
  it('resolves .dat files through the LDraw search path', async () => {
    const provider = new DirectoryLdrawProvider(library)
    expect(await provider.load('3005.dat')).toBe('part brick')
    // Sub-parts are resolved from `parts/s/`.
    expect(await provider.load('s/1-4cyli.dat')).toBe('sub part')
  })

  it('prefers the p/48 primitive over the lo-res one', async () => {
    const provider = new DirectoryLdrawProvider(library)
    expect(await provider.load('4-4cyli.dat')).toBe('hi-res cylinder')
  })

  it('caches a miss so a second lookup does not retry', async () => {
    const provider = new DirectoryLdrawProvider(library)
    expect(await provider.load('9999.dat')).toBeNull()
    expect(await provider.load('9999.dat')).toBeNull()
  })
})
