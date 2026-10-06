import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory } from '../lib/history'
import { DEFAULT_PART } from '../lib/sample'
import { useEditorStore } from './editorStore'

/** Two identical brick references side by side in the main model. */
const GROUP_WORKSPACE = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '0 Author: Part Editor',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick_1x1.dat',
  '1 16 20 0 0 1 0 0 0 1 0 0 0 1 brick_1x1.dat',
  '0 NOFILE',
  '',
  '0 FILE brick_1x1.dat',
  ...DEFAULT_PART.split('\n'),
  '0 NOFILE',
].join('\n')

function resetStore(code = GROUP_WORKSPACE) {
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

/** Line numbers of the two brick references in the main model. */
function refLines(): number[] {
  const doc = useEditorStore.getState().document
  return doc.models[0].commands.filter((cmd) => cmd.kind === 'subfile').map((cmd) => cmd.lineNumber)
}

describe('editorStore — grouping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('toggleSelect adds and removes lines from the multi-selection', () => {
    const [a, b] = refLines()

    useEditorStore.getState().toggleSelect(a)
    expect(useEditorStore.getState().selectedLines).toEqual([a])

    useEditorStore.getState().toggleSelect(b)
    expect(useEditorStore.getState().selectedLines).toEqual([a, b])

    useEditorStore.getState().toggleSelect(a)
    expect(useEditorStore.getState().selectedLines).toEqual([b])
  })

  it('groupSelection creates a group from two or more selected lines', () => {
    const [a, b] = refLines()
    useEditorStore.setState({ selectedLines: [a, b], selectedLine: a })

    useEditorStore.getState().groupSelection()

    const groups = useEditorStore.getState().groups
    expect(groups).toHaveLength(1)
    expect(groups[0].lines).toEqual([a, b])
  })

  it('groupSelection is a no-op for a single selected line', () => {
    const [a] = refLines()
    useEditorStore.setState({ selectedLines: [a], selectedLine: a })

    useEditorStore.getState().groupSelection()

    expect(useEditorStore.getState().groups).toEqual([])
  })

  it('selectPart selects the whole group when a member is clicked', () => {
    const [a, b] = refLines()
    useEditorStore.getState().groupSelection() // needs selection first
    useEditorStore.setState({ selectedLines: [a, b] })
    useEditorStore.getState().groupSelection()

    useEditorStore.getState().selectPart({ lineNumber: a, file: 'main.ldr' })

    expect(useEditorStore.getState().selectedLine).toBe(a)
    expect(useEditorStore.getState().selectedLines).toEqual([a, b])
  })

  it('transformPart move translates every member of a group', () => {
    const [a, b] = refLines()
    useEditorStore.setState({ selectedLines: [a, b], selectedLine: a, tool: 'move' })

    useEditorStore.getState().transformPart(a, { x: 10, y: 0, z: 0 }, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    vi.advanceTimersByTime(900)

    const doc = useEditorStore.getState().document
    const subs = doc.models[0].commands.filter((cmd) => cmd.kind === 'subfile')
    const positions = subs.map((cmd) => (cmd.kind === 'subfile' ? cmd.position : { x: -1, y: -1, z: -1 }))
    expect(positions.map((p) => p.x).sort((m, n) => m - n)).toEqual([10, 30])
  })

  it('select-tool drag also translates every member of a group', () => {
    const [a, b] = refLines()
    useEditorStore.setState({ selectedLines: [a, b], selectedLine: a, tool: 'select' })

    useEditorStore.getState().transformPart(a, { x: 10, y: 0, z: 0 }, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 })
    vi.advanceTimersByTime(900)

    const doc = useEditorStore.getState().document
    const subs = doc.models[0].commands.filter((cmd) => cmd.kind === 'subfile')
    const positions = subs.map((cmd) => (cmd.kind === 'subfile' ? cmd.position : { x: -1, y: -1, z: -1 }))
    expect(positions.map((p) => p.x).sort((m, n) => m - n)).toEqual([10, 30])
  })

  it('ungroup dissolves the group but keeps the clicked line selected', () => {
    const [a, b] = refLines()
    useEditorStore.setState({ selectedLines: [a, b], selectedLine: a })
    useEditorStore.getState().groupSelection()

    useEditorStore.getState().ungroup(a)

    expect(useEditorStore.getState().groups).toEqual([])
    expect(useEditorStore.getState().selectedLine).toBe(a)
    expect(useEditorStore.getState().selectedLines).toEqual([a])
  })
})
