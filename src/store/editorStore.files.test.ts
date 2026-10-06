import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory } from '../lib/history'
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

describe('editorStore — openSubfile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('switches to an existing workspace file', () => {
    useEditorStore.getState().openSubfile('brick_1x1.dat')

    const state = useEditorStore.getState()
    expect(state.fileNames[state.activeFileIndex]).toBe('brick_1x1.dat')
    expect(state.activeCode).toContain('0 Name: brick_1x1.dat')
  })

  it('creates a local override block for an external subfile', () => {
    useEditorStore.getState().openSubfile('stud.dat')

    const state = useEditorStore.getState()
    expect(state.fileNames).toContain('stud.dat')
    expect(state.fileNames[state.activeFileIndex]).toBe('stud.dat')
    expect(state.code).toContain('0 FILE stud.dat')
    expect(state.activeCode).toContain('0 Name: stud.dat')
  })

  it('editing a subfile updates the parent document', () => {
    useEditorStore.getState().openSubfile('stud.dat')

    // Append a triangle to the stud override; the parent reference resolves
    // against this block, so the whole document must now contain the line.
    const state = useEditorStore.getState()
    const edited = `${state.activeCode}\n3 16 0 0 0 0 4 0 0 0 4`
    useEditorStore.getState().setActiveCode(edited)
    vi.advanceTimersByTime(900)

    const after = useEditorStore.getState()
    expect(after.code).toContain('3 16 0 0 0 0 4 0 0 0 4')
    expect(after.activeCode).toContain('3 16 0 0 0 0 4 0 0 0 4')
  })
})

describe('editorStore — removeFile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes a tab and removes its block', () => {
    useEditorStore.getState().removeFile(1)

    const state = useEditorStore.getState()
    expect(state.fileNames).toEqual(['main.ldr'])
    expect(state.activeFileIndex).toBe(0)
    expect(state.code).not.toContain('0 FILE brick_1x1.dat')
  })

  it('keeps the active tab when a later file is closed', () => {
    useEditorStore.getState().openSubfile('stud.dat') // appends a third file
    useEditorStore.getState().setActiveFile(1)
    useEditorStore.getState().removeFile(2)

    const state = useEditorStore.getState()
    expect(state.fileNames).toEqual(['main.ldr', 'brick_1x1.dat'])
    expect(state.fileNames[state.activeFileIndex]).toBe('brick_1x1.dat')
  })
})

describe('editorStore — deleteSelected orphans', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes a subfile tab when its last reference is deleted', () => {
    const doc = useEditorStore.getState().document
    const ref = doc.models[0].commands.find((cmd) => cmd.kind === 'subfile' && cmd.file === 'brick_1x1.dat')
    useEditorStore.setState({ selectedLine: ref!.lineNumber })

    useEditorStore.getState().deleteSelected()

    const state = useEditorStore.getState()
    expect(state.fileNames).toEqual(['main.ldr'])
    expect(state.code).not.toContain('0 FILE brick_1x1.dat')
    expect(state.activeCode).not.toContain('0 Name: brick_1x1.dat')
  })
})

describe('editorStore — import/add reference in main', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('addFile references the new part from the main model', () => {
    useEditorStore.getState().addFile('my_part')

    const state = useEditorStore.getState()
    expect(state.fileNames).toContain('my_part.dat')
    expect(getModelBlock(state.code, 'main.ldr')).toContain('1 16 0 0 0 1 0 0 0 1 0 0 0 1 my_part.dat')
  })

  it('importFile adds the imported part and references it from main.ldr', () => {
    useEditorStore.getState().importFile('0 Name: wheel.dat\n2 24 0 0 0 0 1 0', 'wheel.dat')

    const state = useEditorStore.getState()
    expect(state.fileNames).toContain('wheel.dat')
    expect(getModelBlock(state.code, 'main.ldr')).toContain('1 16 0 0 0 1 0 0 0 1 0 0 0 1 wheel.dat')
    expect(state.fileNames[state.activeFileIndex]).toBe('wheel.dat')
  })

  it('importFile does not duplicate a reference that already exists', () => {
    useEditorStore.getState().importFile('0 Name: brick_1x1.dat\n2 24 0 0 0 0 1 0', 'brick_1x1.dat')

    const state = useEditorStore.getState()
    const main = getModelBlock(state.code, 'main.ldr')
    const count = main.split('\n').filter((line) => line.includes('brick_1x1.dat')).length
    expect(count).toBe(1)
  })
})

describe('editorStore — drawing targets the main model', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('insertPart lands in main.ldr even when a subfile tab is focused', () => {
    useEditorStore.getState().setActiveFile(1) // focus brick_1x1.dat
    useEditorStore.getState().insertPart('3001.dat', { x: 0, y: 0, z: 0 })

    const state = useEditorStore.getState()
    expect(getModelBlock(state.code, 'main.ldr')).toContain('3001.dat')
    expect(getModelBlock(state.code, 'brick_1x1.dat')).not.toContain('3001.dat')
  })
})
