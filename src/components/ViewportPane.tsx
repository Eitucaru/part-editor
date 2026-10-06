import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { LDrawScene } from '../render/ldraw-scene'
import { ViewportToolbar } from './ViewportToolbar'
import { Toolbar } from './Toolbar'
import { ContextMenu, useContextMenu } from './ContextMenu'
import { SchematicPane } from './SchematicPane'
import { libraryApiUrl } from '../lib/file-provider'

/** The interactive 3D viewport, with tools and selection bound to the store. */
export function ViewportPane() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<LDrawScene | null>(null)
  const { menu, open, close } = useContextMenu()

  const document = useEditorStore((state) => state.document)
  const settings = useEditorStore((state) => state.settings)
  const tool = useEditorStore((state) => state.tool)
  const drawVariant = useEditorStore((state) => state.drawVariant)
  const selectedLine = useEditorStore((state) => state.selectedLine)
  const selectedLines = useEditorStore((state) => state.selectedLines)
  const selectedVertices = useEditorStore((state) => state.selectedVertices)
  const groups = useEditorStore((state) => state.groups)
  const selectedVertex = useEditorStore((state) => state.selectedVertex)
  const activeFileName = useEditorStore((state) => state.fileNames[state.activeFileIndex] ?? '')
  const frameRequest = useEditorStore((state) => state.frameRequest)
  const libraryRevision = useEditorStore((state) => state.library.revision)
  const libraryMode = useEditorStore((state) => state.library.mode)
  const setLibraryDialogOpen = useEditorStore((state) => state.setLibraryDialogOpen)
  const pendingFrameRef = useRef(false)

  // A packaged build without an online library has no `/ldraw` endpoint, so
  // the viewport stays empty until a folder is attached. Say so instead of
  // showing nothing (the dev server, which does serve the library, never
  // shows this).
  const needsLibrary = !import.meta.env.DEV && libraryMode === 'server' && !libraryApiUrl()

  useEffect(() => {
    if (!containerRef.current) return
    const store = useEditorStore.getState()
    const scene = new LDrawScene(containerRef.current, store.settings, {
      onSelectPart: (selection) => useEditorStore.getState().selectPart(selection),
      onToggleSelect: (selection) => useEditorStore.getState().toggleSelect(selection.lineNumber),
      onSelectVertices: (selections) => useEditorStore.getState().selectVertices(selections),
      onTransformPart: (lineNumber, position, matrix) => useEditorStore.getState().transformPart(lineNumber, position, matrix),
      onMoveVertices: (entries) => useEditorStore.getState().moveVertices(entries),
      onPreviewVertices: (entries) => useEditorStore.getState().previewVertices(entries),
      onPreviewTransformPart: (lineNumber, position, matrix) => useEditorStore.getState().previewTransformPart(lineNumber, position, matrix),
      onApplyGeometry: (lines, label) => useEditorStore.getState().applyGeometryLines(lines, label),
      onAddConnector: (connector) => useEditorStore.getState().addConnector(connector),
    })
    sceneRef.current = scene

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        scene.resize(width, height)
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setSettings(settings)
  }, [settings])

  useEffect(() => {
    sceneRef.current?.setTool(tool)
  }, [tool])

  useEffect(() => {
    sceneRef.current?.setDrawVariant(drawVariant)
  }, [drawVariant])

  useEffect(() => {
    sceneRef.current?.setSelectedLine(selectedLine)
  }, [selectedLine])

  useEffect(() => {
    sceneRef.current?.setSelectedLines(selectedLine, selectedLines)
  }, [selectedLine, selectedLines])

  useEffect(() => {
    sceneRef.current?.setSelectedVertices(selectedVertices)
  }, [selectedVertices])

  useEffect(() => {
    if (frameRequest > 0) pendingFrameRef.current = true
  }, [frameRequest])

  // Universal "incremental movement": arrow keys nudge the selected part(s) or
  // vertices by the settings' move-increment (never while typing in an input).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const tag = window.document.activeElement?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      const map: Record<string, ['x' | 'y' | 'z', 1 | -1]> = {
        ArrowRight: ['x', 1],
        ArrowLeft: ['x', -1],
        ArrowUp: ['y', 1],
        ArrowDown: ['y', -1],
      }
      const mapped = map[event.key]
      if (!mapped) return
      event.preventDefault()
      sceneRef.current?.nudgeSelection(mapped[0], mapped[1])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      sceneRef.current?.update(document, activeFileName).then(() => {
        if (pendingFrameRef.current) {
          pendingFrameRef.current = false
          sceneRef.current?.frameView()
        }
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [document, activeFileName, tool, libraryRevision])

  const openViewportMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    const hasSelection = selectedLine !== null || selectedVertex !== null
    const inGroup = selectedLine != null && groups.some((g) => g.lines.includes(selectedLine))
    open(event.clientX, event.clientY, [
      {
        label: 'Delete Part',
        action: () => useEditorStore.getState().deleteSelected(),
        disabled: selectedLine === null,
        danger: true,
        shortcut: 'Del',
      },
      {
        label: 'Merge Part',
        action: () => useEditorStore.getState().mergeSelected(),
        disabled: selectedLine === null,
      },
      {
        label: 'Group Selection',
        action: () => useEditorStore.getState().groupSelection(),
        disabled: selectedLines.length < 2,
        separatorBefore: true,
      },
      {
        label: 'Ungroup',
        action: () => {
          if (selectedLine != null) useEditorStore.getState().ungroup(selectedLine)
        },
        disabled: !inGroup,
      },
      {
        label: 'Deselect',
        action: () => {
          useEditorStore.getState().selectPart(null)
          useEditorStore.getState().selectVertex(null)
        },
        disabled: !hasSelection,
        shortcut: 'Esc',
        separatorBefore: true,
      },
      {
        label: 'Fit View',
        action: () => sceneRef.current?.frameView(),
        separatorBefore: true,
      },
    ])
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onContextMenu={openViewportMenu}>
      <Toolbar />
      <ViewportToolbar onFit={() => sceneRef.current?.frameView()} />
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {needsLibrary && (
        <div className="viewport-hint">
          <div className="viewport-hint-title">No LDraw library attached</div>
          <div className="viewport-hint-body">Parts are read from a folder on this computer. Nothing is uploaded.</div>
          <button className="viewport-hint-button" onClick={() => setLibraryDialogOpen(true)}>
            Select LDraw folder…
          </button>
        </div>
      )}
      <SchematicPane getScene={() => sceneRef.current} />
      {menu && <ContextMenu menu={menu} onClose={close} />}
    </div>
  )
}
