import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory } from '../lib/history'
import { DEFAULT_SETTINGS } from '../lib/types'
import { useEditorStore } from './editorStore'

/** Two triangles sharing the corner (0,0,0). */
const TWO_TRIS = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '0 Author: Part Editor',
  '3 16 0 0 0 10 0 0 0 10 0',
  '3 16 0 0 0 0 10 0 0 0 10',
  '0 NOFILE',
].join('\n')

function resetStore(code = TWO_TRIS) {
  const { document, errors } = parseLDraw(code)
  const fileNames = getFileNames(document)
  const activeFileIndex = 0
  const name = fileNames[activeFileIndex] ?? ''
  const activeCode = name !== '' ? getModelBlock(code, name) : code
  useEditorStore.setState({
    code,
    document,
    errors,
    fileNames,
    activeFileIndex,
    activeCode,
    previewActiveCode: null,
    settings: { ...DEFAULT_SETTINGS },
    history: createHistory(code, activeFileIndex),
    historyPending: false,
    selectedLine: null,
    selectedVertex: null,
    selectedVertices: [],
    selectedLines: [],
    groups: [],
    tool: 'vertex',
    drawVariant: null,
    connectors: [],
  })
}

describe('editorStore — vertex editing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('selectVertices records the multi-selection', () => {
    useEditorStore.getState().selectVertices([
      { lineNumber: 4, vertexIndex: 0 },
      { lineNumber: 5, vertexIndex: 0 },
    ])

    const state = useEditorStore.getState()
    expect(state.selectedVertices).toEqual([
      { lineNumber: 4, vertexIndex: 0 },
      { lineNumber: 5, vertexIndex: 0 },
    ])
    expect(state.selectedVertex).toEqual({ lineNumber: 5, vertexIndex: 0 })
    expect(state.selectedLine).toBeNull()
  })

  it('moveVertices moves a welded corner across both triangles', () => {
    useEditorStore.getState().moveVertices([
      { lineNumber: 4, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
      { lineNumber: 5, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
    ])
    vi.advanceTimersByTime(900)

    const main = getModelBlock(useEditorStore.getState().code, 'main.ldr')
    expect(main).toContain('3 16 5 5 5 10 0 0 0 10 0')
    expect(main).toContain('3 16 5 5 5 0 10 0 0 0 10')
  })

  it('moveVertices groups multiple edits on one line into a single replacement', () => {
    useEditorStore.getState().moveVertices([
      { lineNumber: 4, vertexIndex: 1, position: { x: 20, y: 0, z: 0 } },
      { lineNumber: 4, vertexIndex: 2, position: { x: 0, y: 20, z: 0 } },
    ])
    vi.advanceTimersByTime(900)

    const main = getModelBlock(useEditorStore.getState().code, 'main.ldr')
    expect(main).toContain('3 16 0 0 0 20 0 0 0 20 0')
  })

  it('previewVertices updates the editor text live without committing', () => {
    useEditorStore.getState().previewVertices([
      { lineNumber: 4, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
      { lineNumber: 5, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
    ])

    const state = useEditorStore.getState()
    expect(state.previewActiveCode).toContain('3 16 5 5 5 10 0 0 0 10 0')
    expect(state.previewActiveCode).toContain('3 16 5 5 5 0 10 0 0 0 10')
    // The committed document is untouched until moveVertices runs.
    expect(getModelBlock(state.code, 'main.ldr')).toContain('3 16 0 0 0 10 0 0 0 10 0')
  })

  it('moveVertices commits the preview and clears it', () => {
    useEditorStore.getState().previewVertices([
      { lineNumber: 4, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
      { lineNumber: 5, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
    ])
    useEditorStore.getState().moveVertices([
      { lineNumber: 4, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
      { lineNumber: 5, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
    ])
    vi.advanceTimersByTime(900)

    const state = useEditorStore.getState()
    expect(state.previewActiveCode).toBeNull()
    const main = getModelBlock(state.code, 'main.ldr')
    expect(main).toContain('3 16 5 5 5 10 0 0 0 10 0')
  })

  it('previewVertices is a no-op when live sync is disabled', () => {
    useEditorStore.getState().setSettings({ liveSync: false })
    useEditorStore.getState().previewVertices([
      { lineNumber: 4, vertexIndex: 0, position: { x: 5, y: 5, z: 5 } },
    ])

    expect(useEditorStore.getState().previewActiveCode).toBeNull()
  })
})
