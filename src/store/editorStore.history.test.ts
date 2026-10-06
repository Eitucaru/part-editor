import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory, currentEntry } from '../lib/history'
import { DEFAULT_WORKSPACE } from '../lib/sample'
import { useEditorStore } from './editorStore'

function resetStore() {
  const code = DEFAULT_WORKSPACE
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
    history: createHistory(code, activeFileIndex),
    historyPending: false,
    selectedLine: null,
    selectedVertex: null,
    tool: 'select',
    drawVariant: null,
  })
}

describe('editorStore — history', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records a single entry for a burst of text edits', () => {
    const store = useEditorStore.getState()
    const block = store.activeCode

    store.setActiveCode(block + 'a')
    store.setActiveCode(useEditorStore.getState().activeCode + 'b')
    store.setActiveCode(useEditorStore.getState().activeCode + 'c')

    // While typing, no new history entry is committed yet.
    expect(useEditorStore.getState().historyPending).toBe(true)
    expect(Object.keys(useEditorStore.getState().history.entries)).toHaveLength(1)

    vi.advanceTimersByTime(900)
    expect(useEditorStore.getState().historyPending).toBe(false)
    expect(Object.keys(useEditorStore.getState().history.entries)).toHaveLength(2)
    expect(currentEntry(useEditorStore.getState().history).label).toBe('Edit text')
  })

  it('does not commit when a text burst ends with no net change', () => {
    const store = useEditorStore.getState()
    const original = store.activeCode
    store.setActiveCode(original + 'x')
    // Revert to the original text within the same burst.
    store.setActiveCode(original)
    expect(useEditorStore.getState().historyPending).toBe(true)

    vi.advanceTimersByTime(900)
    expect(Object.keys(useEditorStore.getState().history.entries)).toHaveLength(1)
    expect(useEditorStore.getState().historyPending).toBe(false)
  })

  it('keeps branches when a new action follows an undo', () => {
    const store = useEditorStore.getState()
    const codeA = store.code

    store.formatDocument('pretty')
    const prettyId = currentEntry(useEditorStore.getState().history).id
    useEditorStore.getState().undo()
    expect(currentEntry(useEditorStore.getState().history).label).toBe('Initial')

    store.formatDocument('minified')
    const state = useEditorStore.getState()
    expect(currentEntry(state.history).label).toBe('Compress document')
    const initial = state.history.entries[state.history.rootId]
    expect(initial.children.length).toBe(2)
    expect(initial.children).toContain(prettyId)
    expect(state.code).not.toBe(codeA)
  })
})
