import { useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { MenuBar } from './components/MenuBar'
import { EditorPane } from './components/EditorPane'
import { ViewportPane } from './components/ViewportPane'
import { SettingsModal } from './components/SettingsModal'
import { LibraryModal } from './components/LibraryModal'
import { CreditsModal } from './components/CreditsModal'
import { FileTabs } from './components/FileTabs'
import { useEditorStore } from './store/editorStore'
import { formatLDraw, minifyLDraw } from './core'
import { writeConnBinary } from './lib/conn'
import { BUILT_WITH_LABEL } from './lib/credits'
import { DEFAULT_WORKSPACE } from './lib/sample'
import { serverLibrary } from './lib/file-provider'

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadBytes(filename: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes)
  const blob = new Blob([copy.buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const libraryOpen = useEditorStore((state) => state.libraryDialogOpen)
  const setLibraryOpen = useEditorStore((state) => state.setLibraryDialogOpen)
  const setCode = useEditorStore((state) => state.setCode)
  const formatDocument = useEditorStore((state) => state.formatDocument)
  const code = useEditorStore((state) => state.code)

  // Re-attach a previously granted library folder. Browsers only restore file
  // permissions silently while they are still granted, so this never prompts;
  // the library dialog offers a reconnect button when a click is needed.
  useEffect(() => {
    void useEditorStore.getState().restoreLibrary()
  }, [])

  // `?part=<slug>` opens a published part from the online library, as the
  // site draws it (the "View in Part Editor" link on a part page).
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('part')
    const library = serverLibrary()
    if (!slug || !library) return
    void library.loadPart(slug).then((bundle) => {
      const store = useEditorStore.getState()
      const text = bundle?.files[bundle.root]
      if (!bundle || text === undefined) {
        store.setLibraryError(`The part "${slug}" could not be opened from the online library.`)
        store.setLibraryDialogOpen(true)
        return
      }
      store.setCode(text, bundle.root, `Open part ${bundle.part.slug}`)
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        useEditorStore.getState().undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        useEditorStore.getState().redo()
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        useEditorStore.getState().redo()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        useEditorStore.getState().deleteSelected()
      } else if (event.key === 'Escape') {
        useEditorStore.getState().selectPart(null)
        useEditorStore.getState().selectVertex(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <div className="app-menubar">
        <MenuBar
          onNew={() => setCode(DEFAULT_WORKSPACE, undefined, 'New file')}
          onImport={(text, fileName) => useEditorStore.getState().importFile(text, fileName)}
          onExport={() => download('part.dat', minifyLDraw(code).text)}
          onExportFormatted={() => download('part.dat', formatLDraw(code, { mode: 'pretty' }).text)}
          onExportConn={() => {
            const state = useEditorStore.getState()
            const name = state.fileNames[state.activeFileIndex] ?? 'part'
            const base = name.replace(/\.(dat|ldr|mpd)$/i, '') || 'part'
            const bytes = writeConnBinary(state.connectors.map((e) => e.connector))
            downloadBytes(`${base}.conn`, bytes)
          }}
          onLibrary={() => setLibraryOpen(true)}
          onFormat={() => formatDocument('pretty')}
          onMinify={() => formatDocument('minified')}
          onSettings={() => setSettingsOpen(true)}
        />
        <button
          className="built-with-button"
          onClick={() => setCreditsOpen(true)}
          title="View credits"
        >
          Built with {BUILT_WITH_LABEL}
        </button>
      </div>

      <main className="app-main">
        <PanelGroup direction="horizontal" autoSaveId="part-editor-layout-v2" className="app-panels">
          <Panel defaultSize={38} minSize={20} className="app-editor-panel">
            <div className="editor-container">
              <FileTabs />
              <div className="editor-body">
                <EditorPane />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel minSize={20} className="app-viewport-panel">
            <ViewportPane />
          </Panel>
        </PanelGroup>
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LibraryModal isOpen={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <CreditsModal isOpen={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  )
}
