import { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { ContextMenu, useContextMenu } from './ContextMenu'

/** Tab strip for the open files in the workspace (an MPD with one tab per model). */
export function FileTabs() {
  const fileNames = useEditorStore((state) => state.fileNames)
  const activeFileIndex = useEditorStore((state) => state.activeFileIndex)
  const setActiveFile = useEditorStore((state) => state.setActiveFile)
  const addFile = useEditorStore((state) => state.addFile)
  const removeFile = useEditorStore((state) => state.removeFile)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const { menu, open, close } = useContextMenu()

  const commit = () => {
    addFile(draft)
    setDraft('')
    setAdding(false)
  }

  const openTabMenu = (event: React.MouseEvent, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const single = fileNames.length <= 1
    open(event.clientX, event.clientY, [
      {
        label: 'Close',
        action: () => removeFile(index),
        disabled: single,
      },
      {
        label: 'Close Others',
        action: () => {
          // Remove every other file, working from the end so indexes stay valid.
          for (let i = fileNames.length - 1; i >= 0; i--) {
            if (i !== index) removeFile(i)
          }
        },
        disabled: single,
      },
      {
        label: 'Close All',
        action: () => {
          for (let i = fileNames.length - 1; i >= 0; i--) removeFile(i)
        },
        disabled: single,
      },
    ])
  }

  return (
    <div className="file-tabs" role="tablist">
      {fileNames.map((name, index) => (
        <button
          key={name}
          role="tab"
          aria-selected={index === activeFileIndex}
          className={`file-tab${index === activeFileIndex ? ' active' : ''}`}
          title={name}
          onClick={() => setActiveFile(index)}
          onContextMenu={(event) => openTabMenu(event, index)}
        >
          {name}
        </button>
      ))}

      {adding ? (
        <input
          autoFocus
          className="file-tab-input"
          value={draft}
          placeholder="new_part.dat"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            else if (event.key === 'Escape') {
              setDraft('')
              setAdding(false)
            }
          }}
        />
      ) : (
        <button
          className="file-tab add"
          title="Add file"
          aria-label="Add file"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}

      {menu && <ContextMenu menu={menu} onClose={close} />}
    </div>
  )
}
