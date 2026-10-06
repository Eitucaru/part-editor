/**
 * Persistence for granted library folder handles.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable, so it can be stored in
 * IndexedDB and re-used after a reload. The *permission* is not restored with
 * it: on the next visit the handle comes back with `prompt` and the user has to
 * click once to re-grant read access.
 *
 * Chromium-only. Every function degrades to a no-op elsewhere.
 */

import type { DirectoryHandleLike } from './library-fs'

const DB_NAME = 'part-editor-library'
const DB_VERSION = 1
const STORE = 'handles'

export type LibrarySlot = 'ldraw'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function runTransaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(STORE, mode)
    } catch {
      resolve()
      return
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
    try {
      action(transaction.objectStore(STORE))
    } catch {
      resolve()
    }
  })
}

/** Remember a granted handle so the folder can be re-attached after a reload. */
export async function saveLibraryHandle(slot: LibrarySlot, handle: DirectoryHandleLike): Promise<void> {
  const db = await openDb()
  if (!db) return
  await runTransaction(db, 'readwrite', (store) => {
    store.put(handle, slot)
  })
  db.close()
}

/** Load every remembered handle. Missing/denied entries are simply omitted. */
export async function loadLibraryHandles(): Promise<Partial<Record<LibrarySlot, DirectoryHandleLike>>> {
  const db = await openDb()
  if (!db) return {}
  const out: Partial<Record<LibrarySlot, DirectoryHandleLike>> = {}

  await new Promise<void>((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(STORE, 'readonly')
    } catch {
      resolve()
      return
    }
    const request = transaction.objectStore(STORE).getAllKeys()
    request.onsuccess = () => {
      const keys = request.result
      for (const slot of ['ldraw'] as LibrarySlot[]) {
        if (!keys.includes(slot)) continue
        const get = transaction.objectStore(STORE).get(slot)
        get.onsuccess = () => {
          const value = get.result as DirectoryHandleLike | undefined
          if (value && value.kind === 'directory') out[slot] = value
        }
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
  })

  db.close()
  return out
}

/** Forget the remembered folders (called when the user disconnects). */
export async function clearLibraryHandles(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await runTransaction(db, 'readwrite', (store) => {
    store.clear()
  })
  db.close()
}
