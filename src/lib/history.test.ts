import { describe, it, expect } from 'vitest'
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  currentEntry,
  historyPath,
  redoHistory,
  selectHistory,
  undoHistory,
} from './history'

describe('history — basics', () => {
  it('starts at a root with no undo/redo', () => {
    const h = createHistory('snap0', 0)
    expect(currentEntry(h).label).toBe('Initial')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(historyPath(h).map((e) => e.label)).toEqual(['Initial'])
  })

  it('commits, undoes, and redoes linearly', () => {
    let h = createHistory('snap0', 0)
    h = commitHistory(h, 'A', 'snap1', 0)
    h = commitHistory(h, 'B', 'snap2', 0)
    expect(historyPath(h).map((e) => e.label)).toEqual(['Initial', 'A', 'B'])

    h = undoHistory(h)!
    expect(currentEntry(h).label).toBe('A')
    expect(currentEntry(h).snapshot).toBe('snap1')

    h = redoHistory(h)!
    expect(currentEntry(h).label).toBe('B')
    expect(currentEntry(h).snapshot).toBe('snap2')
  })

  it('preserves branches when diverting after an undo', () => {
    let h = createHistory('s0', 0)
    h = commitHistory(h, 'A', 's1', 0)
    h = commitHistory(h, 'B', 's2', 0)
    h = undoHistory(h)! // back to A
    h = commitHistory(h, 'C', 's3', 0) // diverge

    expect(currentEntry(h).label).toBe('C')
    const a = historyPath(h).find((e) => e.label === 'A')!
    expect(a.children.length).toBe(2)
    expect(a.children.map((id) => h.entries[id].label).sort()).toEqual(['B', 'C'])
  })

  it('select jumps to any node', () => {
    let h = createHistory('s0', 0)
    h = commitHistory(h, 'A', 's1', 0)
    const aId = currentEntry(h).id
    h = commitHistory(h, 'B', 's2', 0)
    h = selectHistory(h, aId)!
    expect(currentEntry(h).label).toBe('A')
  })
})

describe('history — coalescing helper (snapshot equality)', () => {
  it('commit adds a child and advances the current id', () => {
    const h0 = createHistory('s0', 0)
    const h1 = commitHistory(h0, 'Edit text', 's1', 0)
    expect(currentEntry(h1).snapshot).toBe('s1')
    expect(currentEntry(h1).parentId).toBe(h0.rootId)
    expect(canUndo(h1)).toBe(true)
  })
})
