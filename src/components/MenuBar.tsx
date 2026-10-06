import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { canRedo, canUndo } from '../lib/history'
import type { HistoryEntry } from '../lib/history'

export interface MenuBarProps {
  onNew: () => void
  onImport: (text: string, fileName?: string) => void
  onExport: () => void
  onExportFormatted: () => void
  onExportConn: () => void
  onLibrary: () => void
  onFormat: () => void
  onMinify: () => void
  onSettings: () => void
}

type MenuName = 'file' | 'edit' | 'view' | 'history'

/** Top-level menu bar with File / Edit / View / History dropdowns. */
export function MenuBar({ onNew, onImport, onExport, onExportFormatted, onExportConn, onLibrary, onFormat, onMinify, onSettings }: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const selectHistory = useEditorStore((state) => state.selectHistory)
  const history = useEditorStore((state) => state.history)

  const undoable = canUndo(history)
  const redoable = canRedo(history)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleMenu = (name: MenuName) => setActiveMenu((cur) => (cur === name ? null : name))
  const run = (action: () => void) => {
    action()
    setActiveMenu(null)
  }

  const jumpTo = (id: string) => {
    selectHistory(id)
    setActiveMenu(null)
  }

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onImport(String(reader.result ?? ''), file.name)
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <div className="menu-bar" ref={barRef}>
      <input ref={fileInputRef} type="file" accept=".dat,.ldr,.mpd,.txt" style={{ display: 'none' }} onChange={handleImportFile} />

      <div style={{ position: 'relative' }}>
        <button className={`menu-button${activeMenu === 'file' ? ' active' : ''}`} onClick={() => toggleMenu('file')}>
          File
        </button>
        {activeMenu === 'file' && (
          <div className="menu-dropdown">
            <div className="menu-option" onClick={() => run(onNew)}>New File</div>
            <div className="menu-divider" />
            <div className="menu-option" onClick={() => run(() => fileInputRef.current?.click())}>Import LDraw…</div>
            <div className="menu-divider" />
            <div className="menu-option" onClick={() => run(onLibrary)}>LDraw Library…</div>
            <div className="menu-divider" />
            <div className="menu-option" onClick={() => run(onExport)}>Export LDraw (compressed)…</div>
            <div className="menu-option" onClick={() => run(onExportFormatted)}>Export LDraw (formatted)…</div>
            <div className="menu-option" onClick={() => run(onExportConn)}>Export Connectivity (.conn)…</div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button className={`menu-button${activeMenu === 'edit' ? ' active' : ''}`} onClick={() => toggleMenu('edit')}>
          Edit
        </button>
        {activeMenu === 'edit' && (
          <div className="menu-dropdown">
            <div className={`menu-option${undoable ? '' : ' disabled'}`} onClick={() => undoable && run(undo)}>
              <span>Undo</span>
              <span className="menu-option-shortcut">Ctrl+Z</span>
            </div>
            <div className={`menu-option${redoable ? '' : ' disabled'}`} onClick={() => redoable && run(redo)}>
              <span>Redo</span>
              <span className="menu-option-shortcut">Ctrl+Y</span>
            </div>
            <div className="menu-divider" />
            <div className="menu-option" onClick={() => run(onFormat)}>Format Document</div>
            <div className="menu-option" onClick={() => run(onMinify)}>Compress Document</div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button className={`menu-button${activeMenu === 'history' ? ' active' : ''}`} onClick={() => toggleMenu('history')}>
          History
        </button>
        {activeMenu === 'history' && (
          <div className="menu-dropdown history-dropdown">
            <div className={`menu-option${undoable ? '' : ' disabled'}`} onClick={() => undoable && run(undo)}>
              <span>Undo</span>
              <span className="menu-option-shortcut">Ctrl+Z</span>
            </div>
            <div className={`menu-option${redoable ? '' : ' disabled'}`} onClick={() => redoable && run(redo)}>
              <span>Redo</span>
              <span className="menu-option-shortcut">Ctrl+Y</span>
            </div>
            <div className="menu-divider" />
            <HistoryTree rootId={history.rootId} entries={history.entries} currentId={history.currentId} onSelect={jumpTo} />
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button className={`menu-button${activeMenu === 'view' ? ' active' : ''}`} onClick={() => toggleMenu('view')}>
          View
        </button>
        {activeMenu === 'view' && (
          <div className="menu-dropdown">
            <div className="menu-option" onClick={() => run(onSettings)}>Editor Settings</div>
          </div>
        )}
      </div>
    </div>
  )
}

interface HistoryTreeProps {
  rootId: string
  entries: Record<string, HistoryEntry>
  currentId: string
  onSelect: (id: string) => void
}

function HistoryTree({ rootId, entries, currentId, onSelect }: HistoryTreeProps) {
  const root = entries[rootId]
  if (!root) return null
  return (
    <div className="history-tree">
      <HistoryNode entry={root} entries={entries} currentId={currentId} onSelect={onSelect} depth={0} />
    </div>
  )
}

function HistoryNode({
  entry,
  entries,
  currentId,
  onSelect,
  depth,
}: {
  entry: HistoryEntry
  entries: Record<string, HistoryEntry>
  currentId: string
  onSelect: (id: string) => void
  depth: number
}) {
  const current = entry.id === currentId
  return (
    <>
      <div
        className={`menu-option history-entry${current ? ' current' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(entry.id)}
        title={current ? `${entry.label} (current)` : entry.label}
      >
        <span className="history-dot">{current ? '●' : '○'}</span>
        <span className="history-label">{entry.label}</span>
      </div>
      {entry.children.map((childId) => (
        <HistoryNode
          key={childId}
          entry={entries[childId]}
          entries={entries}
          currentId={currentId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  )
}
