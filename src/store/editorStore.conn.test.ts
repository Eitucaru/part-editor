import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLDraw } from '../core'
import { getFileNames, getModelBlock } from '../lib/workspace'
import { createHistory } from '../lib/history'
import { DEFAULT_WORKSPACE } from '../lib/sample'
import { makeStudConnector, PhysicalT, writeConnText } from '../lib/conn'
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

describe('editorStore — connectors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('addConnector appends a PE_CONN line and derives a connector entry', () => {
    const connector = makeStudConnector({ x: 10, y: -24, z: 10 }, 10, 0)
    useEditorStore.getState().addConnector(connector)

    const state = useEditorStore.getState()
    expect(state.code).toContain(`0 PE_CONN ${writeConnText(connector)}`)
    expect(state.connectors).toHaveLength(1)
    expect(state.connectors[0].connector.connType).toBe(PhysicalT.Stud)
  })

  it('removeConnector deletes the line and clears the derived entry', () => {
    const connector = makeStudConnector({ x: 10, y: -24, z: 10 }, 10, 0)
    useEditorStore.getState().addConnector(connector)
    const lineNumber = useEditorStore.getState().connectors[0].lineNumber

    useEditorStore.getState().removeConnector(lineNumber)

    const state = useEditorStore.getState()
    expect(state.connectors).toHaveLength(0)
    expect(state.code).not.toContain('PE_CONN')
  })
})
