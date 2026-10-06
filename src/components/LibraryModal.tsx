import { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { folderFromDrop, pickDirectoryHandle, pickFolderFileList, supportsDirectoryPicker } from '../lib/library-fs'
import { libraryApiUrl } from '../lib/file-provider'

interface LibraryModalProps {
  isOpen: boolean
  onClose: () => void
}

/** `handle` remembers the folder; `files` reads it for this session only. */
type PickMode = 'handle' | 'files'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** The dev server serves the library itself; a packaged build cannot. */
const devServer = import.meta.env.DEV
/** A build configured with an online library reads from it when no folder is attached. */
const libraryApi = libraryApiUrl()

const muted: React.CSSProperties = {
  color: 'var(--color-text-muted, #9aa0a6)',
  fontSize: 12,
  lineHeight: 1.45,
}

const button: React.CSSProperties = {
  background: 'var(--color-accent-menu)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
}

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
}

/**
 * Attaches an LDraw library folder that lives on the user's own disk.
 *
 * A static host (GitHub Pages, a file share…) cannot serve `/ldraw`, and a web
 * page cannot read the disk on its own, so the folder has to be handed over
 * explicitly: either through the File System Access API, or with a plain
 * `webkitdirectory` folder selection. Nothing is ever uploaded.
 */
export function LibraryModal({ isOpen, onClose }: LibraryModalProps) {
  const library = useEditorStore((state) => state.library)
  const [dragging, setDragging] = useState(false)
  const [hasPicker] = useState(() => supportsDirectoryPicker())

  useEffect(() => {
    if (!isOpen) setDragging(false)
  }, [isOpen])

  if (!isOpen) return null

  const looksLikeLibrary = library.topDirs.some((dir) => {
    const name = dir.toLowerCase()
    return name === 'parts' || name === 'p'
  })

  const attachFromFolder = async (mode: PickMode) => {
    const store = useEditorStore.getState()
    store.setLibraryBusy(true)
    try {
      if (mode === 'handle') {
        const handle = await pickDirectoryHandle('ldraw-library')
        if (!handle) {
          // Unsupported, cancelled, or refused because the folder is protected.
          store.setLibraryBusy(false)
          return
        }
        await store.attachLdrawHandle(handle)
        return
      }

      const files = await pickFolderFileList()
      if (files.length === 0) {
        store.setLibraryBusy(false)
        return
      }
      await store.attachLdrawFiles(files)
    } catch (error) {
      store.setLibraryError(errorMessage(error, 'Could not read that folder.'))
    }
  }

  const attachFromDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const store = useEditorStore.getState()
    store.setLibraryBusy(true)
    try {
      const dropped = await folderFromDrop(event.nativeEvent)
      if (!dropped) {
        store.setLibraryError('Drop a folder, not individual files.')
        return
      }
      if (dropped.handle) await store.attachLdrawHandle(dropped.handle)
      else await store.attachLdrawFiles(dropped.files)
    } catch (error) {
      store.setLibraryError(errorMessage(error, 'Could not read that folder.'))
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-panel)',
          color: 'var(--color-text)',
          padding: 20,
          borderRadius: 8,
          width: 460,
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>LDraw Library</h3>
        <p style={{ ...muted, marginTop: 0 }}>
          {libraryApi
            ? 'Parts and primitives come from the online library, or from a folder on this computer. Nothing is uploaded.'
            : 'Parts and primitives are read from a folder on this computer. Nothing is uploaded.'}
        </p>

        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: 10,
            marginBottom: 12,
          }}
        >
          {library.mode === 'local' ? (
            <>
              <div style={{ fontSize: 13 }}>
                Using <strong>{library.ldrawName}</strong>
              </div>
              {!looksLikeLibrary && (
                <div style={{ ...muted, marginTop: 6, color: 'var(--color-warning, #e3c11a)' }}>
                  {library.topDirs.length === 0
                    ? 'Nothing could be read from this folder. If it sits in a protected location such as Program Files, use Read folder once instead.'
                    : 'No parts or p folder found here. Pick the LDraw root folder that contains them.'}
                </div>
              )}
            </>
          ) : libraryApi ? (
            <>
              <div style={{ fontSize: 13 }}>
                Using the online library at <strong>{new URL(libraryApi).host}</strong>
              </div>
              <div style={muted}>
                Parts are fetched as they are needed and kept by your browser. Attach a folder to use your own copy
                instead.
              </div>
            </>
          ) : devServer ? (
            <>
              <div style={{ fontSize: 13 }}>Using the development server</div>
              <div style={muted}>
                Parts are served from the folder this machine has configured. Attach a folder to read a different copy
                instead.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13 }}>No folder attached</div>
              <div style={muted}>The viewport stays empty until a folder is attached.</div>
            </>
          )}
        </div>

        {library.pendingPermission && (
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              {library.ldrawName} was used previously. Allow access again to reuse it.
            </div>
            <button style={button} onClick={() => void useEditorStore.getState().reconnectLibrary()}>
              Allow access
            </button>
          </div>
        )}

        <div style={{ fontSize: 13, marginBottom: 4 }}>LDraw library</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            style={{ ...button, opacity: library.busy ? 0.5 : 1 }}
            disabled={library.busy}
            onClick={() => void attachFromFolder('handle')}
          >
            Select folder…
          </button>
          <button
            style={{ ...secondaryButton, opacity: library.busy ? 0.5 : 1 }}
            disabled={library.busy}
            onClick={() => void attachFromFolder('files')}
          >
            Read folder once…
          </button>
        </div>

        <p style={{ ...muted, marginTop: 0, marginBottom: 12 }}>
          Select folder remembers it for next time (Chrome and Edge). Read folder once works in every browser, and in
          protected locations such as Program Files, but has to be repeated after a reload.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => void attachFromDrop(event)}
          style={{
            border: `1px dashed ${dragging ? 'var(--color-accent-menu)' : 'var(--color-border)'}`,
            borderRadius: 4,
            padding: 16,
            textAlign: 'center',
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13 }}>Drop the ldraw folder here</div>
          <div style={muted}>The folder that contains parts and p.</div>
        </div>

        {!hasPicker && (
          <p style={{ ...muted, marginTop: 0 }}>
            This browser cannot remember a folder, so use Read folder once.
          </p>
        )}

        {library.busy && <p style={{ ...muted, marginTop: 0 }}>Reading folder…</p>}

        {library.error && (
          <p style={{ ...muted, marginTop: 0, color: 'var(--color-danger, #ff6b6b)' }}>{library.error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button
            style={{ ...secondaryButton, opacity: library.mode === 'local' ? 1 : 0.5 }}
            disabled={library.mode !== 'local'}
            onClick={() => void useEditorStore.getState().detachLibrary()}
          >
            Disconnect
          </button>
          <button style={secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
