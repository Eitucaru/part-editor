import { create } from 'zustand'
import { parseLDraw, formatLDraw, getLineType } from '../core'
import type { FormatMode, LDrawCommand, LDrawDocument, LDrawParseError, Mat3, Vec3 } from '../core'
import { makeSubfileCommand, serializeCommandLike, setSubfileTransform, setVertexPosition } from '../lib/edit-operations'
import { getLine, removeLine, replaceLine, insertLines } from '../lib/text-edit'
import { appendToModelBlock, fileBase, getFileNames, getModelBlock, isFileReferenced, matchFileName, mergeModelBlocks, removeModelBlock, replaceModelBlock, toMpd } from '../lib/workspace'
import { DirectoryLdrawProvider, defaultLdrawProvider, setLdrawProvider } from '../lib/file-provider'
import { FileMapLibraryFs, HandleLibraryFs, fileEntries, queryPermission, requestPermission } from '../lib/library-fs'
import type { DirectoryHandleLike, LibraryFs } from '../lib/library-fs'
import { clearLibraryHandles, loadLibraryHandles, saveLibraryHandle } from '../lib/library-vault'
import { bakeReference } from '../lib/merge'
import { createHistory, commitHistory, undoHistory, redoHistory, selectHistory } from '../lib/history'
import type { HistoryState } from '../lib/history'
import { parseConnText, writeConnText } from '../lib/conn'
import type { Connector } from '../lib/conn'
import type { EditorSettings } from '../lib/types'
import { DEFAULT_SETTINGS } from '../lib/types'
import { DEFAULT_WORKSPACE } from '../lib/sample'
import type { ActiveDrawVariant } from '../lib/tools'

export type ToolType = 'select' | 'move' | 'rotate' | 'scale' | 'vertex' | 'draw'

export interface VertexSelection {
  lineNumber: number
  vertexIndex: number
}

export interface PartSelection {
  /** Global line number of the selected type-1 line. */
  lineNumber: number
  /** Referenced file of the selected part (may be a workspace file). */
  file: string
}

/** A group of part references that move together. */
export interface PartGroup {
  id: string
  /** Global line numbers (in the main model) of the grouped type-1 lines. */
  lines: number[]
}

/** Where the LDraw geometry library is coming from. */
export interface LibraryState {
  /** `server` = the dev/preview mount; `local` = a folder on the user's disk. */
  mode: 'server' | 'local'
  /** Folder name of the attached LDraw library, when local. */
  ldrawName: string | null
  /** Bumped whenever the source changes so views rebuild their geometry. */
  revision: number
  busy: boolean
  error: string | null
  /**
   * A previously granted folder is remembered but needs one click to re-grant
   * read access — browsers never restore file permissions silently.
   */
  pendingPermission: boolean
  /** Top-level folders of the attached root (used to flag a wrong pick). */
  topDirs: string[]
}

const EMPTY_LIBRARY: LibraryState = {
  mode: 'server',
  ldrawName: null,
  revision: 0,
  busy: false,
  error: null,
  pendingPermission: false,
  topDirs: [],
}

/* --------------------- LDraw library source --------------------- */

/**
 * The library (parts and primitives) normally comes from the Vite server. On a
 * static host there is no such endpoint, so the user hands over a folder from
 * their own disk instead. This reference holds the current local source and is
 * mirrored into the active file provider.
 */
let ldrawSource: LibraryFs | null = null

/** Point the shared file provider at the local source, or back at HTTP. */
function syncLibraryProvider(): void {
  setLdrawProvider(ldrawSource ? new DirectoryLdrawProvider(ldrawSource) : null)
}

/** Build the library state after the local sources changed. */
async function libraryStateAfterAttach(previous: LibraryState): Promise<LibraryState> {
  const source = ldrawSource
  const topDirs = source ? await source.topLevelDirs() : []
  return {
    mode: source ? 'local' : 'server',
    ldrawName: source?.label ?? null,
    revision: previous.revision + 1,
    busy: false,
    error: null,
    pendingPermission: false,
    topDirs,
  }
}

function derive(code: string, activeFileIndex: number) {
  const { document, errors } = parseLDraw(code)
  const fileNames = getFileNames(document)
  const name = fileNames[activeFileIndex] ?? fileNames[0] ?? ''
  const activeCode = name !== '' ? getModelBlock(code, name) : code
  const connectors = connectorsIn(document, name)
  return { document, errors, fileNames, activeCode, connectors }
}

/** A connector record plus the global line number of its `0 PE_CONN` line. */
export interface ConnectorEntry {
  connector: Connector
  lineNumber: number
}

/** Extract connectors from a model's `0 PE_CONN` lines. */
function connectorsIn(document: LDrawDocument, name: string): ConnectorEntry[] {
  const model = name !== '' ? document.models.find((m) => m.name === name) : document.models[0]
  if (!model) return []
  const out: ConnectorEntry[] = []
  for (const cmd of model.commands) {
    if (cmd.kind === 'comment' && cmd.keyword === 'PE_CONN') {
      const connector = parseConnText(cmd.rest)
      if (connector) out.push({ connector, lineNumber: cmd.lineNumber })
    }
  }
  return out
}

/** Add a type-1 reference to `file` in the main model when not already present. */
function referenceInMain(code: string, file: string): string {
  const { document } = parseLDraw(code)
  const mainName = document.models[0]?.name?.trim() ?? ''
  if (mainName !== '' && fileBase(mainName) === fileBase(file)) return code
  if (isFileReferenced(document, file)) return code
  const cmd = makeSubfileCommand(file, 16, { x: 0, y: 0, z: 0 })
  const lineText = serializeCommandLike(cmd, '1 16 0 0 0 1 0 0 0 1 0 0 0 1 x.dat')
  return appendToModelBlock(code, mainName, lineText).code
}

function findCommand(model: LDrawDocument['models'][number], lineNumber: number): LDrawCommand | undefined {
  return model.commands.find((cmd) => cmd.lineNumber === lineNumber)
}

/** Find a command by its global line number across all models of a document. */
function findCommandByLine(document: LDrawDocument, lineNumber: number): LDrawCommand | undefined {
  for (const model of document.models) {
    const cmd = model.commands.find((c) => c.lineNumber === lineNumber)
    if (cmd) return cmd
  }
  return undefined
}

/** Keep a block's leading meta/comment lines (header) up to the first geometry line. */
function extractHeaderLines(block: string): string[] {
  const header: string[] = []
  for (const line of block.split(/\r\n|\r|\n/)) {
    const type = getLineType(line)
    if (type !== null && type !== 0) break
    header.push(line)
  }
  return header
}

/** Apply a single-command edit to the source text and re-derive derived state. */
function applyCommandEdit(
  code: string,
  lineNumber: number,
  updated: LDrawCommand,
  activeFileIndex: number,
): { code: string; document: LDrawDocument; errors: LDrawParseError[]; fileNames: string[]; activeCode: string } {
  const referenceLine = getLine(code, lineNumber)
  const lineText = serializeCommandLike(updated, referenceLine)
  const newCode = replaceLine(code, lineNumber, lineText)
  return { code: newCode, ...derive(newCode, activeFileIndex) }
}

interface EditorStore {
  code: string
  document: LDrawDocument
  errors: LDrawParseError[]
  settings: EditorSettings
  tool: ToolType
  drawVariant: ActiveDrawVariant | null
  selectedLine: number | null
  selectedVertex: VertexSelection | null
  /** All visually-selected vertices (multi-select in vertex mode). */
  selectedVertices: VertexSelection[]
  /** All visually-selected part line numbers (multi-select / group members). */
  selectedLines: number[]
  /** Groups of part references that move together. */
  groups: PartGroup[]
  activeFileIndex: number
  fileNames: string[]
  activeCode: string
  /** Live-preview block text shown in the editor during a drag (not committed). */
  previewActiveCode: string | null
  /** Parsed connectivity records (`0 PE_CONN` lines) of the active file. */
  connectors: ConnectorEntry[]
  /** Increments whenever the view should re-frame (e.g. after inserting a part). */
  frameRequest: number
  /** Branching edit history (tree of document snapshots). */
  history: HistoryState
  /** True while a burst of text-editor keystrokes is being coalesced. */
  historyPending: boolean
  /** Whether the 2D schematic companion window is open (bottom-right overlay). */
  schematicOpen: boolean
  /** Where the LDraw geometry library is coming from. */
  library: LibraryState
  /** Whether the LDraw Library dialog is open. */
  libraryDialogOpen: boolean

  setCode: (text: string, fileName?: string, label?: string) => void
  setSchematicOpen: (open: boolean) => void
  setSettings: (patch: Partial<EditorSettings>) => void
  formatDocument: (mode: FormatMode) => void
  setTool: (tool: ToolType) => void
  setDrawVariant: (variant: ActiveDrawVariant | null) => void
  selectPart: (selection: PartSelection | null) => void
  toggleSelect: (lineNumber: number) => void
  groupSelection: () => void
  ungroup: (lineNumber: number) => void
  selectVertex: (selection: VertexSelection | null) => void
  selectVertices: (selections: VertexSelection[]) => void
  transformPart: (lineNumber: number, position: Vec3, matrix: Mat3) => void
  moveVertices: (entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>) => void
  /** Live text previews (no history) while a drag is in progress. */
  previewVertices: (entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>) => void
  previewTransformPart: (lineNumber: number, position: Vec3, matrix: Mat3) => void
  clearPreview: () => void
  insertPart: (file: string, position?: Vec3, matrix?: Mat3) => void
  deleteSelected: () => void
  mergeSelected: () => Promise<void>
  setActiveFile: (index: number) => void
  setActiveCode: (text: string) => void
  addFile: (name: string) => void
  importFile: (text: string, fileName?: string) => void
  removeFile: (index: number) => void
  openSubfile: (name: string) => void
  applyGeometryLines: (lines: string[], label?: string) => void
  addConnector: (connector: Connector) => void
  removeConnector: (lineNumber: number) => void
  undo: () => void
  redo: () => void
  selectHistory: (id: string) => void

  /** Attach a folder picked with the File System Access API as the LDraw library. */
  attachLdrawHandle: (handle: DirectoryHandleLike) => Promise<void>
  /** Attach a folder selected through `<input webkitdirectory>` (all browsers). */
  attachLdrawFiles: (files: File[]) => Promise<void>
  /** Forget the local folder and go back to the server-provided library. */
  detachLibrary: () => Promise<void>
  /** Re-attach a remembered folder when its permission is still granted. */
  restoreLibrary: () => Promise<void>
  /** Re-grant read access to the remembered folder (needs a user gesture). */
  reconnectLibrary: () => Promise<void>
  setLibraryBusy: (busy: boolean) => void
  setLibraryError: (message: string | null) => void
  setLibraryDialogOpen: (open: boolean) => void
}

/**
 * Compute the document text produced by moving the given vertices (mirrors the
 * committed `moveVertices` edit, without writing history).
 */
function computeVertexEditCode(
  state: EditorStore,
  entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>,
): { code: string; changed: boolean } {
  // Group edits by global line number so a line is replaced exactly once.
  const byLine = new Map<number, Array<{ vertexIndex: number; position: Vec3 }>>()
  for (const e of entries) {
    const list = byLine.get(e.lineNumber) ?? []
    list.push({ vertexIndex: e.vertexIndex, position: e.position })
    byLine.set(e.lineNumber, list)
  }
  let code = state.code
  let changed = false
  for (const [line, edits] of byLine) {
    const cmd = findCommandByLine(state.document, line)
    if (!cmd) continue
    let updated = cmd
    for (const e of edits) updated = setVertexPosition(updated, e.vertexIndex, e.position)
    if (updated === cmd) continue
    code = applyCommandEdit(code, line, updated, state.activeFileIndex).code
    changed = true
  }
  return { code, changed }
}

/**
 * Compute the document text produced by transforming a part (mirrors the
 * committed `transformPart` edit, without writing history). Move/select tools
 * translate every selected line together; rotate/scale act on the primary part.
 */
function computeTransformCode(
  state: EditorStore,
  lineNumber: number,
  position: Vec3,
  matrix: Mat3,
): { code: string; changed: boolean; label: string } {
  const cmd = findCommand(state.document.models[0], lineNumber)
  if (!cmd || cmd.kind !== 'subfile') return { code: state.code, changed: false, label: '' }

  const members = (state.tool === 'move' || state.tool === 'select') && state.selectedLines.length > 1 ? state.selectedLines : [lineNumber]
  if (members.length > 1) {
    const delta = {
      x: position.x - cmd.position.x,
      y: position.y - cmd.position.y,
      z: position.z - cmd.position.z,
    }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return { code: state.code, changed: false, label: 'Move group' }
    let code = state.code
    for (const line of members) {
      const member = findCommand(state.document.models[0], line)
      if (!member || member.kind !== 'subfile') continue
      const updated = setSubfileTransform(
        member,
        { x: member.position.x + delta.x, y: member.position.y + delta.y, z: member.position.z + delta.z },
        member.matrix,
      )
      code = applyCommandEdit(code, line, updated, state.activeFileIndex).code
    }
    return { code, changed: true, label: 'Move group' }
  }

  const { code } = applyCommandEdit(state.code, lineNumber, setSubfileTransform(cmd, position, matrix), state.activeFileIndex)
  const label = state.tool === 'rotate' ? 'Rotate part' : state.tool === 'scale' ? 'Scale part' : 'Move part'
  return { code, changed: true, label }
}

const initial = derive(DEFAULT_WORKSPACE, 0)
const initialHistory = createHistory(DEFAULT_WORKSPACE, 0)

export const useEditorStore = create<EditorStore>((set, get) => ({
  code: DEFAULT_WORKSPACE,
  document: initial.document,
  errors: initial.errors,
  settings: DEFAULT_SETTINGS,
  tool: 'select',
  drawVariant: null,
  selectedLine: null,
  selectedVertex: null,
  selectedVertices: [],
  selectedLines: [],
  groups: [],
  activeFileIndex: 0,
  fileNames: initial.fileNames,
  activeCode: initial.activeCode,
  previewActiveCode: null,
  connectors: initial.connectors,
  frameRequest: 0,
  history: initialHistory,
  historyPending: false,
  schematicOpen: false,
  library: EMPTY_LIBRARY,
  libraryDialogOpen: false,

  setSchematicOpen: (open) => set({ schematicOpen: open }),

  setCode: (text, fileName, label = 'Replace document') => {
    const code = toMpd(text, fileName ?? 'model.dat')
    flushTextHistory()
    set({
      ...commitHistoryEntry(label, code, 0),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      selectedLines: [],
      frameRequest: get().frameRequest + 1,
    })
  },

  setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

  formatDocument: (mode) => {
    flushTextHistory()
    const state = get()
    const name = state.fileNames[state.activeFileIndex] ?? ''
    const active = name !== '' ? getModelBlock(state.code, name) : state.code
    const { text } = formatLDraw(active, { mode })
    const code = name !== '' ? replaceModelBlock(state.code, name, text) : text
    if (code === state.code) return
    set(commitHistoryEntry(mode === 'minified' ? 'Compress document' : 'Format document', code, state.activeFileIndex))
  },

  setTool: (tool) => set((state) => ({
    tool,
    drawVariant: tool === 'draw' ? state.drawVariant : null,
    selectedVertex: tool === 'vertex' ? state.selectedVertex : null,
    selectedVertices: tool === 'vertex' ? state.selectedVertices : [],
    // The schematic companion opens by default when entering vertex mode.
    schematicOpen: tool === 'vertex' ? true : state.schematicOpen,
  })),

  setDrawVariant: (variant) => set({ drawVariant: variant, tool: variant ? 'draw' : 'select', selectedLine: null, selectedVertex: null, selectedVertices: [], selectedLines: [] }),

  selectPart: (selection) => {
    if (!selection) {
      set({ selectedLine: null, selectedVertex: null, selectedVertices: [], selectedLines: [] })
      return
    }
    const state = get()
    const fileIndex = matchFileName(state.fileNames, selection.file)
    // Selecting a group member selects the whole group.
    const group = state.groups.find((g) => g.lines.includes(selection.lineNumber))
    const next: Partial<EditorStore> = {
      selectedLine: selection.lineNumber,
      selectedLines: group ? [...group.lines] : [selection.lineNumber],
      selectedVertex: null,
      selectedVertices: [],
    }
    if (fileIndex >= 0 && fileIndex !== state.activeFileIndex) {
      next.activeFileIndex = fileIndex
      next.activeCode = getModelBlock(state.code, state.fileNames[fileIndex] ?? '')
    }
    set(next)
  },

  toggleSelect: (lineNumber) => {
    const state = get()
    const has = state.selectedLines.includes(lineNumber)
    const selectedLines = has ? state.selectedLines.filter((l) => l !== lineNumber) : [...state.selectedLines, lineNumber]
    set({ selectedLines, selectedLine: lineNumber, selectedVertex: null, selectedVertices: [] })
  },

  groupSelection: () => {
    const state = get()
    const lines = [...new Set(state.selectedLines)].filter((l) => l != null)
    if (lines.length < 2) return
    const duplicate = state.groups.some((g) => g.lines.length === lines.length && lines.every((l) => g.lines.includes(l)))
    if (duplicate) return
    set({ groups: [...state.groups, { id: `group-${Date.now()}-${state.groups.length}`, lines }] })
  },

  ungroup: (lineNumber) => {
    set((state) => ({
      groups: state.groups.filter((g) => !g.lines.includes(lineNumber)),
      selectedLines: [lineNumber],
      selectedLine: lineNumber,
    }))
  },

  selectVertex: (selection) => set({ selectedVertex: selection, selectedVertices: selection ? [selection] : [], selectedLine: selection ? null : get().selectedLine, selectedLines: selection ? [] : get().selectedLines }),

  selectVertices: (selections) => set({
    selectedVertices: selections,
    selectedVertex: selections.length > 0 ? selections[selections.length - 1] : null,
    selectedLine: null,
    selectedLines: [],
  }),

  transformPart: (lineNumber, position, matrix) => {
    flushTextHistory()
    const state = get()
    const { code, changed, label } = computeTransformCode(state, lineNumber, position, matrix)
    if (!changed) {
      set({ previewActiveCode: null })
      return
    }
    set({ ...commitHistoryEntry(label, code, state.activeFileIndex), previewActiveCode: null })
  },

  previewTransformPart: (lineNumber, position, matrix) => {
    const state = get()
    if (!state.settings.liveSync) return
    const { code, changed } = computeTransformCode(state, lineNumber, position, matrix)
    if (!changed) return
    const name = state.fileNames[state.activeFileIndex] ?? ''
    set({ previewActiveCode: name !== '' ? getModelBlock(code, name) : code })
  },

  moveVertices: (entries) => {
    flushTextHistory()
    const state = get()
    const { code, changed } = computeVertexEditCode(state, entries)
    if (!changed) {
      set({ previewActiveCode: null })
      return
    }
    set({ ...commitHistoryEntry('Move vertices', code, state.activeFileIndex), previewActiveCode: null })
  },

  previewVertices: (entries) => {
    const state = get()
    if (!state.settings.liveSync) return
    const { code, changed } = computeVertexEditCode(state, entries)
    if (!changed) return
    const name = state.fileNames[state.activeFileIndex] ?? ''
    set({ previewActiveCode: name !== '' ? getModelBlock(code, name) : code })
  },

  clearPreview: () => set({ previewActiveCode: null }),

  insertPart: (file, position, matrix) => {
    flushTextHistory()
    const state = get()
    const cmd = makeSubfileCommand(file, 16, position ?? { x: 0, y: 0, z: 0 }, matrix)
    const lineText = serializeCommandLike(cmd, '1 16 0 0 0 1 0 0 0 1 0 0 0 1 x.dat')
    // Inserted parts always land in the main model (the assembly), even when a
    // sub-file tab is focused.
    const name = state.fileNames[0] ?? ''
    const { code, lineNumber } = appendToModelBlock(state.code, name, lineText)
    set({
      ...commitHistoryEntry('Insert part', code, state.activeFileIndex),
      selectedLine: lineNumber,
      selectedLines: [lineNumber],
      selectedVertex: null,
      selectedVertices: [],
      tool: 'move',
      frameRequest: state.frameRequest + 1,
    })
  },

  deleteSelected: () => {
    flushTextHistory()
    const state = get()
    if (state.selectedLine === null) return
    const cmd = findCommand(state.document.models[0], state.selectedLine)
    const removedFile = cmd && cmd.kind === 'subfile' ? cmd.file : null
    let code = removeLine(state.code, state.selectedLine)
    let nextActive = state.activeFileIndex

    // If the deleted line was the last reference to a workspace sub-file, drop
    // that file's block too so its tab closes instead of lingering.
    if (removedFile) {
      const { document } = parseLDraw(code)
      if (!isFileReferenced(document, removedFile)) {
        const names = getFileNames(document)
        const fileIndex = matchFileName(names, removedFile)
        if (fileIndex > 0) {
          code = removeModelBlock(code, names[fileIndex])
          if (fileIndex < nextActive) nextActive -= 1
          else if (fileIndex === nextActive) {
            nextActive = Math.min(fileIndex, Math.max(0, getFileNames(parseLDraw(code).document).length - 1))
          }
        }
      }
    }

    set({
      ...commitHistoryEntry('Delete part', code, nextActive),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      selectedLines: [],
    })
  },

  mergeSelected: async () => {
    flushTextHistory()
    const state = get()
    // Bake every selected sub-file reference to concrete geometry, then replace
    // all of them with the combined lines. Non-reference lines in the selection
    // are left untouched.
    const selected = [...new Set(state.selectedLines)].sort((a, b) => a - b)
    if (selected.length === 0) return

    const bakedByLine = new Map<number, string[]>()
    for (const line of selected) {
      const lines = await bakeReference(state.code, line, defaultLdrawProvider)
      if (lines) bakedByLine.set(line, lines)
    }
    if (bakedByLine.size === 0) return

    // Remove the baked references bottom-up so line numbers stay valid.
    let code = state.code
    for (const line of [...bakedByLine.keys()].sort((a, b) => b - a)) {
      code = removeLine(code, line)
    }
    // Reinsert the combined geometry where the first baked reference was.
    const anchor = Math.min(...bakedByLine.keys())
    const combined = [...bakedByLine.values()].flat()
    code = insertLines(code, anchor, combined)

    set({
      ...commitHistoryEntry('Merge parts', code, state.activeFileIndex),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      selectedLines: [],
      groups: [],
      frameRequest: state.frameRequest + 1,
    })
  },

  setActiveFile: (index) => {
    const state = get()
    const clamped = Math.min(Math.max(index, 0), state.fileNames.length - 1)
    const name = state.fileNames[clamped] ?? ''
    const activeCode = name !== '' ? getModelBlock(state.code, name) : state.code

    // Focus the part(s) that reference this file in the main model, so the
    // tab ↔ viewport selection stays in sync (both directions).
    let selectedLine: number | null = null
    const selectedLines: number[] = []
    if (name !== '') {
      const base = fileBase(name)
      const main = state.document.models[0]
      for (const cmd of main?.commands ?? []) {
        if (cmd.kind === 'subfile' && fileBase(cmd.file) === base) {
          if (selectedLine === null) selectedLine = cmd.lineNumber
          selectedLines.push(cmd.lineNumber)
        }
      }
    }

    set({ activeFileIndex: clamped, activeCode, selectedLine, selectedVertex: null, selectedVertices: [], selectedLines })
  },

  setActiveCode: (text) => {
    const state = get()
    const name = state.fileNames[state.activeFileIndex] ?? ''
    const code = name === '' ? toMpd(text) : replaceModelBlock(state.code, name, text)
    const index = name === '' ? 0 : state.activeFileIndex
    if (code === state.code) return
    set({ ...stateFromCode(code, index), historyPending: true })
    scheduleTextCommit()
  },

  addFile: (rawName) => {
    flushTextHistory()
    const state = get()
    const name = (rawName.trim() || 'new_part.dat').replace(/\.(dat|ldr|mpd)$/i, '') + '.dat'
    const block = `0 FILE ${name}\n0 Name: ${name}\n0 NOFILE`
    const base = state.code.replace(/\s+$/, '')
    let code = base === '' ? block : `${base}\n\n${block}`
    // New parts become reference entries in the main model automatically.
    code = referenceInMain(code, name)
    const newIndex = getFileNames(parseLDraw(code).document).length - 1
    set({
      ...commitHistoryEntry('Add file', code, newIndex),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      frameRequest: state.frameRequest + 1,
    })
  },

  importFile: (text, fileName) => {
    flushTextHistory()
    const state = get()
    const fallback = (fileName ?? 'imported.dat').replace(/\\/g, '/').split('/').pop() ?? 'imported.dat'
    const incoming = toMpd(text, fallback)
    const firstImported = parseLDraw(incoming).document.models[0]?.name?.trim() || fallback

    let code = mergeModelBlocks(state.code, incoming)
    // The imported part becomes a reference entry in the main model.
    code = referenceInMain(code, firstImported)

    const newIndex = matchFileName(getFileNames(parseLDraw(code).document), firstImported)
    set({
      ...commitHistoryEntry(`Import ${firstImported}`, code, newIndex >= 0 ? newIndex : 0),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      frameRequest: state.frameRequest + 1,
    })
  },

  removeFile: (index) => {
    flushTextHistory()
    const state = get()
    const name = state.fileNames[index]
    if (!name || state.fileNames.length <= 1) return
    const code = removeModelBlock(state.code, name)
    if (code === state.code) return
    const nextNames = getFileNames(parseLDraw(code).document)
    let nextActive = state.activeFileIndex
    if (index < nextActive) nextActive -= 1
    else if (index === nextActive) nextActive = Math.min(index, Math.max(0, nextNames.length - 1))
    set({
      ...commitHistoryEntry('Close file', code, nextActive),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      frameRequest: state.frameRequest + 1,
    })
  },

  openSubfile: (name) => {
    flushTextHistory()
    const state = get()
    const fileIndex = matchFileName(state.fileNames, name)
    if (fileIndex >= 0) {
      if (fileIndex !== state.activeFileIndex) {
        set({
          activeFileIndex: fileIndex,
          activeCode: getModelBlock(state.code, state.fileNames[fileIndex] ?? ''),
          selectedLine: null,
          selectedVertex: null,
          selectedVertices: [],
        })
      }
      return
    }
    // The referenced subfile is not a workspace file yet: create a local MPD
    // block so it can be edited (a local definition overrides the external part).
    const cleanName = (name.replace(/\\/g, '/').split('/').pop() ?? name).trim()
    const block = [
      `0 FILE ${cleanName}`,
      `0 Name: ${cleanName}`,
      '0 Author: Part Editor',
      '0 !LICENSE Redistributable under CCAL version 2.0',
      '0 BFC CERTIFY CCW',
      '0 NOFILE',
    ].join('\n')
    const base = state.code.replace(/\s+$/, '')
    const code = base === '' ? block : `${base}\n\n${block}`
    const newIndex = getFileNames(parseLDraw(code).document).length - 1
    set({
      ...commitHistoryEntry(`Open ${cleanName}`, code, newIndex),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
    })

    // Populate the new block with the referenced file's real content when the
    // library can provide it, so the opened tab isn't left empty.
    void defaultLdrawProvider.load(cleanName).then((external) => {
      if (!external) return
      const current = get()
      const currentIndex = matchFileName(current.fileNames, cleanName)
      if (currentIndex < 0) return
      const populated = replaceModelBlock(current.code, cleanName, external.trim())
      if (populated === current.code) return
      set({
        ...commitHistoryEntry(`Load ${cleanName}`, populated, current.activeFileIndex),
        selectedLine: null,
        selectedVertex: null,
        selectedVertices: [],
      })
    })
  },

  applyGeometryLines: (lines, label = 'Edit geometry') => {
    flushTextHistory()
    const state = get()
    const name = state.fileNames[state.activeFileIndex] ?? ''
    const block = name !== '' ? getModelBlock(state.code, name) : state.code
    const header = extractHeaderLines(block)
    const content = [...header, ...lines].join('\n')
    const code = name !== '' ? replaceModelBlock(state.code, name, content) : content
    set({
      ...commitHistoryEntry(label, code, state.activeFileIndex),
      selectedLine: null,
      selectedVertex: null,
      selectedVertices: [],
      frameRequest: get().frameRequest + 1,
    })
  },

  addConnector: (connector) => {
    flushTextHistory()
    const state = get()
    const name = state.fileNames[state.activeFileIndex] ?? ''
    const { code } = appendToModelBlock(state.code, name, `0 PE_CONN ${writeConnText(connector)}`)
    set({
      ...commitHistoryEntry('Add connector', code, state.activeFileIndex),
      selectedLine: null,
      selectedVertex: null,
    })
  },

  removeConnector: (lineNumber) => {
    flushTextHistory()
    const state = get()
    const code = removeLine(state.code, lineNumber)
    if (code === state.code) return
    set({
      ...commitHistoryEntry('Delete connector', code, state.activeFileIndex),
      selectedLine: null,
      selectedVertex: null,
    })
  },

  undo: () => {
    flushTextHistory()
    const state = get()
    const next = undoHistory(state.history)
    if (!next) return
    const node = next.entries[next.currentId]
    set({
      ...stateFromCode(node.snapshot, node.activeFileIndex),
      history: next,
      historyPending: false,
      selectedLine: null,
      selectedVertex: null,
      previewActiveCode: null,
    })
  },

  redo: () => {
    flushTextHistory()
    const state = get()
    const next = redoHistory(state.history)
    if (!next) return
    const node = next.entries[next.currentId]
    set({
      ...stateFromCode(node.snapshot, node.activeFileIndex),
      history: next,
      historyPending: false,
      selectedLine: null,
      selectedVertex: null,
      previewActiveCode: null,
    })
  },

  selectHistory: (id) => {
    flushTextHistory()
    const state = get()
    const next = selectHistory(state.history, id)
    if (!next) return
    const node = next.entries[next.currentId]
    set({
      ...stateFromCode(node.snapshot, node.activeFileIndex),
      history: next,
      historyPending: false,
      selectedLine: null,
      selectedVertex: null,
      previewActiveCode: null,
    })
  },

  /* ------------------------- LDraw library ------------------------- */

  attachLdrawHandle: async (handle) => {
    ldrawSource = new HandleLibraryFs(handle)
    syncLibraryProvider()
    const next = await libraryStateAfterAttach(get().library)
    // Only remember folders that could actually be read. A handle for a
    // protected location (Program Files, …) is granted but yields nothing, and
    // silently restoring it on the next visit would be worse than no folder.
    if (next.topDirs.length > 0) void saveLibraryHandle('ldraw', handle)
    set({ library: next })
  },

  attachLdrawFiles: async (files) => {
    if (files.length === 0) {
      set({ library: { ...get().library, busy: false } })
      return
    }
    ldrawSource = new FileMapLibraryFs(fileEntries(files))
    syncLibraryProvider()
    set({ library: await libraryStateAfterAttach(get().library) })
  },

  detachLibrary: async () => {
    ldrawSource = null
    syncLibraryProvider()
    await clearLibraryHandles()
    set({ library: { ...EMPTY_LIBRARY, revision: get().library.revision + 1 } })
  },

  restoreLibrary: async () => {
    const handles = await loadLibraryHandles()
    const ldraw = handles.ldraw
    if (!ldraw) return

    const permission = await queryPermission(ldraw)
    if (permission === 'granted') {
      await get().attachLdrawHandle(ldraw)
      return
    }
    if (permission === 'denied' || permission === 'unsupported') {
      // The folder moved, was renamed, or the browser cannot persist access.
      await clearLibraryHandles()
      return
    }
    // Stored handle, permission needs a click: offer to reconnect.
    set({ library: { ...get().library, ldrawName: ldraw.name, pendingPermission: true } })
  },

  reconnectLibrary: async () => {
    const handles = await loadLibraryHandles()
    const ldraw = handles.ldraw
    if (!ldraw) {
      set({ library: { ...get().library, pendingPermission: false } })
      return
    }

    const permission = await requestPermission(ldraw)
    if (permission !== 'granted') {
      set({
        library: {
          ...get().library,
          pendingPermission: false,
          error: 'Read access to the LDraw folder was not granted.',
        },
      })
      return
    }
    await get().attachLdrawHandle(ldraw)
  },

  setLibraryBusy: (busy) => {
    const library = get().library
    set({ library: { ...library, busy, error: busy ? null : library.error } })
  },

  setLibraryError: (message) => {
    set({ library: { ...get().library, busy: false, error: message } })
  },

  setLibraryDialogOpen: (open) => set({ libraryDialogOpen: open }),
}))

/* ------------------------- history plumbing ------------------------- */

/** Re-derive the store's derived fields from a source text. */
function stateFromCode(code: string, activeFileIndex: number) {
  const { document, errors, fileNames, activeCode, connectors } = derive(code, activeFileIndex)
  return { code, activeFileIndex, document, errors, fileNames, activeCode, connectors }
}

/**
 * Commit a document change as one history entry. Returns the state fields to
 * spread into a `set` call (history + re-derived document fields).
 */
function commitHistoryEntry(label: string, code: string, activeFileIndex: number) {
  const state = useEditorStore.getState()
  const history = commitHistory(state.history, label, code, activeFileIndex)
  return { history, historyPending: false, ...stateFromCode(code, activeFileIndex) }
}

let textCommitTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Coalesce a burst of text-editor keystrokes: the entry is committed once the
 * user pauses (800 ms), grouping the whole burst into a single "Edit text"
 * history entry rather than one per character.
 */
function scheduleTextCommit() {
  if (textCommitTimer) clearTimeout(textCommitTimer)
  textCommitTimer = setTimeout(flushTextHistory, 800)
}

/** Finalize any pending coalesced text edit (no-op when nothing is pending). */
function flushTextHistory() {
  if (textCommitTimer) {
    clearTimeout(textCommitTimer)
    textCommitTimer = null
  }
  const state = useEditorStore.getState()
  if (!state.historyPending) return
  const current = state.history.entries[state.history.currentId]
  if (state.code === current.snapshot && state.activeFileIndex === current.activeFileIndex) {
    useEditorStore.setState({ historyPending: false })
    return
  }
  const history = commitHistory(state.history, 'Edit text', state.code, state.activeFileIndex)
  useEditorStore.setState({ history, historyPending: false })
}


