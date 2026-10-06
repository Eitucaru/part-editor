/** Shared editor settings. Used by the renderer and settings UI. */

export interface EditorSettings {
  backgroundColor: string
  gridColor: string
  gridSize: number
  showGrid: boolean
  showAxes: boolean
  ambientColor: string
  ambientIntensity: number
  directionalColor: string
  directionalIntensity: number
  /** Step (LDU) for incremental movement — arrow-key nudging & snap of vertex drags. */
  moveIncrement: number
  /** Snap vertex movement to whole increments. */
  moveSnap: boolean
  /**
   * Live-update the text editor while dragging in the viewport/blueprint
   * (vertices and part moves). Disable for performance on large models.
   */
  liveSync: boolean
}

export const DEFAULT_SETTINGS: EditorSettings = {
  backgroundColor: '#2A2D34',
  gridColor: '#696C71',
  gridSize: 500,
  showGrid: true,
  showAxes: true,
  ambientColor: '#ffffff',
  ambientIntensity: 1.3,
  directionalColor: '#ffffff',
  directionalIntensity: 1.0,
  moveIncrement: 1,
  moveSnap: true,
  liveSync: true,
}
