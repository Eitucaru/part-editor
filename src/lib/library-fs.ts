/**
 * Local LDraw library access.
 *
 * The editor normally reads its parts from a web server (`/ldraw`), which
 * only exists while the Vite dev server is running.
 * On a static host (GitHub Pages, a file share, …) there is no such endpoint,
 * so the library has to come from the user's own disk instead.
 *
 * Two mechanisms sit behind one interface:
 *
 * 1. **File System Access API** (`showDirectoryPicker`) — Chromium only. Yields
 *    a directory *handle* that can be navigated lazily and persisted in
 *    IndexedDB, so a folder only has to be granted once.
 * 2. **`<input type="file" webkitdirectory>` / folder drop** — every browser.
 *    Yields a flat list of `File` objects keyed by relative path. Nothing is
 *    persisted; the folder is re-picked each session.
 */

/* ------------------------------------------------------------------------ *
 * Minimal structural types
 *
 * The File System Access API is not fully described by the TypeScript DOM lib
 * (notably `showDirectoryPicker` and async directory iteration), so the pieces
 * we rely on are declared here instead of depending on lib version.
 * ------------------------------------------------------------------------ */

export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

export interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  getDirectoryHandle(name: string): Promise<DirectoryHandleLike>
  getFileHandle(name: string): Promise<FileHandleLike>
  entries?(): AsyncIterable<[string, FileHandleLike | DirectoryHandleLike]>
  values?(): AsyncIterable<FileHandleLike | DirectoryHandleLike>
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

/** A read-only view of a library root folder. */
export interface LibraryFs {
  /** Root folder name, shown in the UI. */
  readonly label: string
  /** Read a library-relative path (`parts/3005.dat`). Case-insensitive. */
  read(relPath: string): Promise<string | null>
  /** Top-level folder names — used to sanity-check which folder was picked. */
  topLevelDirs(): Promise<string[]>
}

/** `C:\x\y` / `./y` / `/y` → `y`. */
export function normalizeRel(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/* ------------------------------------------------------------------------ *
 * Directory handle backed source (Chromium)
 * ------------------------------------------------------------------------ */

interface DirListing {
  files: string[]
  dirs: string[]
}

/**
 * Reads through a directory handle, resolving each path segment eagerly and
 * falling back to a case-insensitive match from the parent's cached listing.
 * LDraw references are written with canonical casing, but files on disk are
 * frequently `.DAT` / `Sub.Dat`, so the fallback matters.
 */
export class HandleLibraryFs implements LibraryFs {
  private listings = new WeakMap<object, DirListing>()

  constructor(private root: DirectoryHandleLike) {}

  get label(): string {
    return this.root.name
  }

  /** Cached `{files, dirs}` for a directory handle. */
  private async list(dir: DirectoryHandleLike): Promise<DirListing | null> {
    const cached = this.listings.get(dir)
    if (cached) return cached

    const files: string[] = []
    const dirs: string[] = []
    try {
      if (dir.entries) {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory') dirs.push(name)
          else files.push(name)
        }
      } else if (dir.values) {
        for await (const handle of dir.values()) {
          if (handle.kind === 'directory') dirs.push(handle.name)
          else files.push(handle.name)
        }
      } else {
        return null
      }
    } catch {
      return null
    }

    const listing: DirListing = { files, dirs }
    this.listings.set(dir, listing)
    return listing
  }

  /** Resolve a folder by path segments, tolerating a different casing on disk. */
  private async dir(segments: string[]): Promise<DirectoryHandleLike | null> {
    let current = this.root
    for (const segment of segments) {
      let next: DirectoryHandleLike | null = null
      try {
        next = await current.getDirectoryHandle(segment)
      } catch {
        const listing = await this.list(current)
        const match = listing?.dirs.find((name) => name.toLowerCase() === segment.toLowerCase())
        if (!match) return null
        try {
          next = await current.getDirectoryHandle(match)
        } catch {
          return null
        }
      }
      current = next
    }
    return current
  }

  async read(relPath: string): Promise<string | null> {
    const segments = normalizeRel(relPath).split('/').filter(Boolean)
    if (segments.length === 0) return null

    const parent = await this.dir(segments.slice(0, -1))
    if (!parent) return null

    const name = segments[segments.length - 1]
    let fileHandle: FileHandleLike | null = null
    try {
      fileHandle = await parent.getFileHandle(name)
    } catch {
      const listing = await this.list(parent)
      const match = listing?.files.find((file) => file.toLowerCase() === name.toLowerCase())
      if (match) {
        try {
          fileHandle = await parent.getFileHandle(match)
        } catch {
          fileHandle = null
        }
      }
    }
    if (!fileHandle) return null

    try {
      return await (await fileHandle.getFile()).text()
    } catch {
      return null
    }
  }

  async topLevelDirs(): Promise<string[]> {
    const listing = await this.list(this.root)
    return listing ? [...listing.dirs] : []
  }
}

/* ------------------------------------------------------------------------ *
 * File list backed source (all browsers)
 * ------------------------------------------------------------------------ */

/** `ldraw/parts/3005.dat` → `parts/3005.dat` (drop the picked root folder). */
function stripRootFolder(path: string): string {
  const clean = normalizeRel(path)
  const slash = clean.indexOf('/')
  return slash === -1 ? clean : clean.slice(slash + 1)
}

/** Build `{path, file}` entries from a `webkitdirectory` selection or drop. */
export function fileEntries(files: File[]): Array<{ path: string; file: File }> {
  return files.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    return { path: relative && relative.length > 0 ? relative : file.name, file }
  })
}

/** Folder name of the first entry, used as the library label. */
export function rootFolderName(entries: Array<{ path: string }>): string {
  const first = normalizeRel(entries[0]?.path ?? '')
  const slash = first.indexOf('/')
  return slash === -1 ? 'folder' : first.slice(0, slash)
}

/** A library backed by an in-memory path → `File` map. */
export class FileMapLibraryFs implements LibraryFs {
  private files = new Map<string, File>()
  private dirs = new Set<string>()

  readonly label: string

  constructor(entries: Array<{ path: string; file: File }>, label?: string) {
    this.label = label ?? rootFolderName(entries)
    for (const entry of entries) {
      const rel = stripRootFolder(entry.path)
      if (rel.length === 0) continue
      this.files.set(rel.toLowerCase(), entry.file)
      const segments = rel.split('/')
      for (let depth = 1; depth < segments.length; depth += 1) {
        this.dirs.add(segments.slice(0, depth).join('/').toLowerCase())
      }
    }
  }

  async read(relPath: string): Promise<string | null> {
    const file = this.files.get(normalizeRel(relPath).toLowerCase())
    if (!file) return null
    try {
      return await file.text()
    } catch {
      return null
    }
  }

  async topLevelDirs(): Promise<string[]> {
    return [...new Set([...this.dirs].filter((dir) => !dir.includes('/')))]
  }
}

/* ------------------------------------------------------------------------ *
 * Picking a folder
 * ------------------------------------------------------------------------ */

type PickerWindow = {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<unknown>
}

/** Whether the browser can hand out persistent directory handles. */
export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function'
}

/**
 * Prompt for a folder. Returns `null` when unsupported, when the user cancels,
 * *or* when the browser refuses the chosen folder.
 *
 * Those last two cases cannot be told apart: per the spec a user agent rejects
 * with `AbortError` both when the user dismisses the dialog and when it "deems
 * the selected directory to be too sensitive or dangerous". Chrome does exactly
 * that for protected locations such as `C:\Program Files` and `C:\Windows`, so
 * callers must always offer `pickFolderFileList()` as an alternative rather than
 * treating `null` as "the user said no".
 */
export async function pickDirectoryHandle(id = 'ldraw-library'): Promise<DirectoryHandleLike | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker
  if (typeof picker !== 'function') return null
  try {
    const handle = await picker.call(window, { id, mode: 'read' })
    return handle as DirectoryHandleLike
  } catch {
    return null
  }
}

/**
 * Prompt for a folder using a hidden `<input webkitdirectory>` (works in every
 * browser, but returns plain files that cannot be persisted). Resolves with an
 * empty array when the user cancels.
 */
export function pickFolderFileList(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.style.display = 'none'
    const picker = input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }
    picker.webkitdirectory = true
    picker.directory = true

    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    // Chrome 113+ fires `cancel` when the dialog is dismissed; older browsers
    // never settle, but the input is detached and harmless.
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    input.click()
  })
}

/* ------------------------------------------------------------------------ *
 * Dropping a folder
 * ------------------------------------------------------------------------ */

export interface DroppedFolder {
  handle: DirectoryHandleLike | null
  files: File[]
  label: string
}

interface LegacyEntry {
  isDirectory: boolean
  isFile: boolean
  name: string
  createReader?(): { readEntries(callback: (entries: LegacyEntry[]) => void, onError?: (error: unknown) => void): void }
  file?(callback: (file: File) => void, onError?: (error: unknown) => void): void
}

function readLegacyEntry(entry: LegacyEntry, path: string): Promise<Array<{ path: string; file: File }>> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!(
        (file) => resolve([{ path, file }]),
        () => resolve([]),
      )
    })
  }
  if (!entry.isDirectory || !entry.createReader) return Promise.resolve([])

  const reader = entry.createReader()
  return new Promise((resolve) => {
    const collected: Array<{ path: string; file: File }> = []
    const readBatch = () => {
      reader.readEntries(
        async (batch) => {
          if (batch.length === 0) {
            resolve(collected)
            return
          }
          for (const child of batch) {
            const childPath = `${path}/${child.name}`
            collected.push(...(await readLegacyEntry(child, childPath)))
          }
          readBatch()
        },
        () => resolve(collected),
      )
    }
    readBatch()
  })
}

/**
 * Read a folder dropped onto the page. Prefers the handle-based path
 * (Chromium) and falls back to the legacy entries API, which Firefox and
 * Safari expose for reading.
 */
export async function folderFromDrop(event: DragEvent): Promise<DroppedFolder | null> {
  const items = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === 'file')
  const first = items[0]
  if (!first) return null

  let droppedHandle: DirectoryHandleLike | null = null

  const withHandle = first as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }
  if (typeof withHandle.getAsFileSystemHandle === 'function') {
    try {
      const handle = (await withHandle.getAsFileSystemHandle()) as DirectoryHandleLike | null
      if (handle && handle.kind === 'directory') {
        droppedHandle = handle
        // A handle for a protected folder is still handed over, but nothing can
        // be read through it. Probe before trusting it.
        const dirs = await new HandleLibraryFs(handle).topLevelDirs()
        if (dirs.length > 0) return { handle, files: [], label: handle.name }
      }
    } catch {
      // Fall through to the legacy path.
    }
  }

  const withEntry = first as DataTransferItem & { webkitGetAsEntry?: () => unknown }
  const entry = withEntry.webkitGetAsEntry?.() as LegacyEntry | null
  if (entry && entry.isDirectory) {
    const entries = await readLegacyEntry(entry, entry.name)
    if (entries.length > 0) return { handle: null, files: entries.map((e) => e.file), label: entry.name }
  }

  // Nothing readable through either API, but a handle is still better than
  // nothing at all: the dialog reports what it could not read.
  return droppedHandle ? { handle: droppedHandle, files: [], label: droppedHandle.name } : null
}

/* ------------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------------ */

/** Query read access to a stored handle (`'unsupported'` outside Chromium). */
export async function queryPermission(
  handle: DirectoryHandleLike,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState | 'unsupported'> {
  if (typeof handle.queryPermission !== 'function') return 'unsupported'
  try {
    return await handle.queryPermission({ mode })
  } catch {
    return 'unsupported'
  }
}

/** Re-request read access. Must be called from a user gesture. */
export async function requestPermission(
  handle: DirectoryHandleLike,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState | 'unsupported'> {
  if (typeof handle.requestPermission !== 'function') return 'unsupported'
  try {
    return await handle.requestPermission({ mode })
  } catch {
    return 'denied'
  }
}

/** True when the handle still points at something we can read. */
export async function canRead(handle: DirectoryHandleLike): Promise<boolean> {
  const state = await queryPermission(handle, 'read')
  return state === 'granted' || state === 'unsupported'
}
