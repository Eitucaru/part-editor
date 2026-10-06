/**
 * Branching edit history.
 *
 * History is a tree of snapshots, not a flat stack. Each node stores a full
 * document snapshot plus the label of the action that produced it. Undo walks
 * toward the root; redo walks to the most recent child; `select` jumps to any
 * node (the "divert" operation). Committing from a non-leaf node adds a new
 * child alongside the existing ones, so alternative futures are preserved as
 * branches instead of being thrown away.
 *
 * This module is pure and dependency-free: callers own when to commit (the
 * store coalesces text-editor keystrokes into a single entry).
 */

export interface HistoryEntry {
  id: string
  /** Short human-readable action label ("Move part", "Edit text", …). */
  label: string
  /** Full document source at this point (the canonical snapshot). */
  snapshot: string
  /** Active file index captured with the snapshot. */
  activeFileIndex: number
  parentId: string | null
  /** Child ids, oldest first. The last child is the most recent branch. */
  children: string[]
  timestamp: number
}

export interface HistoryState {
  entries: Record<string, HistoryEntry>
  currentId: string
  rootId: string
}

let counter = 0

function nextId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

/** Create a history seeded with the initial document snapshot. */
export function createHistory(snapshot: string, activeFileIndex: number): HistoryState {
  const id = nextId()
  const entry: HistoryEntry = {
    id,
    label: 'Initial',
    snapshot,
    activeFileIndex,
    parentId: null,
    children: [],
    timestamp: Date.now(),
  }
  return { entries: { [id]: entry }, currentId: id, rootId: id }
}

/**
 * Record a new action as a child of the current node. If the current node
 * already has children (an undone future), the new entry becomes a sibling
 * branch and the old children are preserved.
 */
export function commitHistory(state: HistoryState, label: string, snapshot: string, activeFileIndex: number): HistoryState {
  const parent = state.entries[state.currentId]
  const id = nextId()
  const entry: HistoryEntry = {
    id,
    label,
    snapshot,
    activeFileIndex,
    parentId: parent.id,
    children: [],
    timestamp: Date.now(),
  }
  const entries: Record<string, HistoryEntry> = {
    ...state.entries,
    [id]: entry,
    [parent.id]: { ...parent, children: [...parent.children, id] },
  }
  return { entries, currentId: id, rootId: state.rootId }
}

/** Move one step toward the root. Returns null when already at the root. */
export function undoHistory(state: HistoryState): HistoryState | null {
  const current = state.entries[state.currentId]
  if (!current.parentId) return null
  return { ...state, currentId: current.parentId }
}

/** Move to the most recent child (branch). Returns null at a leaf. */
export function redoHistory(state: HistoryState): HistoryState | null {
  const current = state.entries[state.currentId]
  if (current.children.length === 0) return null
  return { ...state, currentId: current.children[current.children.length - 1] }
}

/** Jump to a specific node (the "divert" operation). */
export function selectHistory(state: HistoryState, id: string): HistoryState | null {
  if (!state.entries[id]) return null
  return { ...state, currentId: id }
}

export function currentEntry(state: HistoryState): HistoryEntry {
  return state.entries[state.currentId]
}

export function canUndo(state: HistoryState): boolean {
  return state.entries[state.currentId].parentId !== null
}

export function canRedo(state: HistoryState): boolean {
  return state.entries[state.currentId].children.length > 0
}

/** The linear path from the root to the current node (oldest first). */
export function historyPath(state: HistoryState): HistoryEntry[] {
  const path: HistoryEntry[] = []
  let id: string | null = state.currentId
  while (id !== null) {
    const entry: HistoryEntry = state.entries[id]
    path.unshift(entry)
    id = entry.parentId
  }
  return path
}
