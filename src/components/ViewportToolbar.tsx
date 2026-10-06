import { useEditorStore } from '../store/editorStore'
import type { ToolType } from '../store/editorStore'

const TOOLS: Array<{ id: ToolType; label: string; icon: string }> = [
  { id: 'select', label: 'Select', icon: '↖' },
  { id: 'move', label: 'Move', icon: '✥' },
  { id: 'rotate', label: 'Rotate', icon: '↻' },
  { id: 'scale', label: 'Scale', icon: '⤢' },
  { id: 'vertex', label: 'Vertex', icon: '•' },
]

/** Floating toolbar for viewport tools. */
export function ViewportToolbar({ onFit }: { onFit: () => void }) {
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)

  return (
    <div className="viewport-toolbar">
      <div className="viewport-toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-button${tool === t.id ? ' active' : ''}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="viewport-toolbar-group">
        <button className="tool-button" title="Frame model" onClick={onFit}>
          <span className="tool-icon">⛶</span>
        </button>
      </div>
    </div>
  )
}
