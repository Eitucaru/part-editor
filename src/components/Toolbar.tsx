import { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { toolModesFor, variantAsDraw } from '../lib/tools'
import type { ToolMode, ToolVariant } from '../lib/tools'

export type ToolbarMode = 'shape' | 'conn'

/**
 * Tool palette: `Shape`/`Connectivity` tabs, a row of tool buttons, and a
 * variant row for the active drawing tool.
 */
export function Toolbar() {
  const setTool = useEditorStore((state) => state.setTool)
  const setDrawVariant = useEditorStore((state) => state.setDrawVariant)
  const [mode, setMode] = useState<ToolbarMode>('shape')
  const [subMode, setSubMode] = useState('select')
  const [detail, setDetail] = useState<string | null>(null)

  const tools = toolModesFor(mode)
  const activeTool: ToolMode | undefined = tools.find((tool) => tool.id === subMode)

  const selectTool = (tool: ToolMode) => {
    setSubMode(tool.id)
    if (tool.variants && tool.variants.length > 0) {
      const first = tool.variants[0]
      setDetail(first.label)
      setDrawVariant(variantAsDraw(first))
    } else {
      setDetail(null)
      setDrawVariant(null)
      setTool('select')
    }
  }

  const selectVariant = (variant: ToolVariant) => {
    setDetail(variant.label)
    setDrawVariant(variantAsDraw(variant))
  }

  const selectTab = (nextMode: ToolbarMode) => {
    setMode(nextMode)
    setSubMode('select')
    setDetail(null)
    setDrawVariant(null)
    setTool('select')
  }

  return (
    <div className="palette-toolbar">
      <div className="palette-tabstrip" role="tablist">
        <button
          role="tab"
          className={`palette-tab${mode === 'shape' ? ' active' : ''}`}
          title="Shape edit mode"
          onClick={() => selectTab('shape')}
        >
          Shape
        </button>
        <button
          role="tab"
          className={`palette-tab${mode === 'conn' ? ' active' : ''}`}
          title="Connectivity edit mode"
          onClick={() => selectTab('conn')}
        >
          Connectivity
        </button>
      </div>

      <div className="palette-toolrows">
        <div className="palette-modes" role="toolbar">
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={`palette-mode-button${subMode === tool.id ? ' active' : ''}`}
              title={tool.tooltip}
              onClick={() => selectTool(tool)}
            >
              {tool.label}
            </button>
          ))}
        </div>

        {activeTool?.variants && activeTool.variants.length > 0 && (
          <div className="palette-subtoolbar" role="toolbar">
            {activeTool.variants.map((variant) => (
              <button
                key={variant.label}
                className={`palette-variant-button${detail === variant.label ? ' active' : ''}`}
                title={variant.desc}
                onClick={() => selectVariant(variant)}
              >
                {variant.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
