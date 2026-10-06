import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory } from '../lib/history'
import { DEFAULT_WORKSPACE } from '../lib/sample'
import { useEditorStore } from './editorStore'

/** Two self-contained references (no library deps) side by side in main. */
const TWO_SELF_CONTAINED = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '0 Author: Part Editor',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.dat',
  '1 16 20 0 0 1 0 0 0 1 0 0 0 1 a.dat',
  '0 NOFILE',
  '',
  '0 FILE a.dat',
  '0 A',
  '2 24 0 0 0 4 0 0',
  '3 16 0 0 0 4 0 0 0 4 0',
  '0 NOFILE',
].join('\n')

function resetStore(code = DEFAULT_WORKSPACE) {
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
    selectedLines: [],
    groups: [],
    tool: 'select',
    drawVariant: null,
    connectors: [],
  })
}

describe('editorStore — mergeSelected', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore(TWO_SELF_CONTAINED)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bakes every selected reference into the main model', async () => {
    const doc = useEditorStore.getState().document
    const refs = doc.models[0].commands.filter((cmd) => cmd.kind === 'subfile').map((cmd) => cmd.lineNumber)
    expect(refs).toHaveLength(2)
    useEditorStore.setState({ selectedLines: refs, selectedLine: refs[0] })

    await useEditorStore.getState().mergeSelected()
    vi.advanceTimersByTime(900)

    const state = useEditorStore.getState()
    const main = getModelBlock(state.code, 'main.ldr')
    expect(main).not.toContain('1 16')
    expect(main).toContain('3 16')
    // The source block stays in the workspace; only references are inlined.
    expect(state.code).toContain('0 FILE a.dat')
    expect(state.selectedLines).toEqual([])
  })

  it('preserves type-2 edge outlines in the baked geometry', async () => {
    const doc = useEditorStore.getState().document
    const ref = doc.models[0].commands.find((cmd) => cmd.kind === 'subfile')!
    useEditorStore.setState({ selectedLines: [ref.lineNumber], selectedLine: ref.lineNumber })

    await useEditorStore.getState().mergeSelected()
    vi.advanceTimersByTime(900)

    const main = getModelBlock(useEditorStore.getState().code, 'main.ldr')
    expect(main).toContain('2 24')
  })

  it('leaves non-reference lines in the selection untouched', async () => {
    const doc = useEditorStore.getState().document
    const refs = doc.models[0].commands.filter((cmd) => cmd.kind === 'subfile')
    const first = refs[0].lineNumber
    useEditorStore.setState({ selectedLines: [first, 999999], selectedLine: first })

    await useEditorStore.getState().mergeSelected()
    vi.advanceTimersByTime(900)

    const main = getModelBlock(useEditorStore.getState().code, 'main.ldr')
    // The first reference is baked away; the second, unselected reference
    // (position 20) stays, and the bogus line number is ignored.
    expect(main).toContain('3 16')
    expect(main).toContain('1 16 20 0 0 1 0 0 0 1 0 0 0 1 a.dat')
    expect(main).not.toContain('1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.dat')
  })
})

describe('editorStore — setActiveFile selects the part', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('focusing a subfile tab highlights its reference in the main model', () => {
    const doc = useEditorStore.getState().document
    const brickRef = doc.models[0].commands.find((cmd) => cmd.kind === 'subfile' && cmd.file === 'brick_1x1.dat')!

    useEditorStore.getState().setActiveFile(1) // brick_1x1.dat

    const state = useEditorStore.getState()
    expect(state.fileNames[state.activeFileIndex]).toBe('brick_1x1.dat')
    expect(state.selectedLine).toBe(brickRef.lineNumber)
    expect(state.selectedLines).toEqual([brickRef.lineNumber])
  })

  it('focusing the main model clears the part selection', () => {
    useEditorStore.getState().setActiveFile(1)
    useEditorStore.getState().setActiveFile(0) // main.ldr

    const state = useEditorStore.getState()
    expect(state.selectedLine).toBeNull()
    expect(state.selectedLines).toEqual([])
  })
})
