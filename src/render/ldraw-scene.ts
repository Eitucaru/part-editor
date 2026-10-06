import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { buildDocumentGeometry, buildModelGeometry, flattenBuiltToSceneSoup } from '../lib/geometry-builder'
import type { BuiltModel, BuiltPart, DirectGeometry } from '../lib/geometry-builder'
import { defaultLdrawProvider } from '../lib/file-provider'
import { applyLdrawMatrix, flipY, matrix4ToLdraw, sceneMatrixToLdraw } from '../lib/matrix3d'
import { modelCertified } from '../lib/bfc'
import { punchBoxSolid, punchCylinderSolid, soupToLdrawLines, subtractSoup } from '../lib/punch'
import type { CsgSolid } from '../lib/csg'
import { AxleT, connDirection, connPosition, connectorColor, makeAxleConnector, makeHoleGridConnector, makeStudGridConnector, parseConnText, PhysicalT } from '../lib/conn'
import type { Connector, ConnMatrix } from '../lib/conn'
import type { LDrawDocument, Mat3, Vec3 } from '../core'
import type { EditorSettings } from '../lib/types'
import type { ActiveDrawVariant } from '../lib/tools'
import type { PartSelection, ToolType, VertexSelection } from '../store/editorStore'

const PART_HIGHLIGHT = 0x007acc
const GRAB_SNAP = 10
/** Vertex marker (unselected / selected) colors and screen size in px.
 * Markers are opaque yellow dots that depth-test against the model, so points
 * on the far side are hidden (they no longer show "through" the part). */
const VERTEX_MARKER_COLOR = 0xffd400
const VERTEX_MARKER_SELECTED = 0xff5722
const VERTEX_MARKER_PX = 12
/** Drawing grid: one stud (20 LDU) on X/Z. */
const DRAW_GRID = 20

export interface LDrawSceneCallbacks {
  onSelectPart: (selection: PartSelection | null) => void
  onToggleSelect: (selection: PartSelection) => void
  onSelectVertices: (selections: VertexSelection[]) => void
  onTransformPart: (lineNumber: number, position: Vec3, matrix: Mat3) => void
  onMoveVertices: (entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>) => void
  /** Live text previews during a drag (before the mouse-up commit). */
  onPreviewVertices?: (entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>) => void
  onPreviewTransformPart?: (lineNumber: number, position: Vec3, matrix: Mat3) => void
  /** Replace the active file's geometry with freshly triangulated LDraw lines. */
  onApplyGeometry: (lines: string[], label: string) => void
  /** Place a new connectivity record. */
  onAddConnector: (connector: Connector) => void
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material?.dispose()
}

/** Multiply a connector matrix (column-major 3×4) by a local point. */
function connTransformPoint(m: ConnMatrix, v: { x: number; y: number; z: number }): Vec3 {
  return {
    x: m[0] * v.x + m[3] * v.y + m[6] * v.z + m[9],
    y: m[1] * v.x + m[4] * v.y + m[7] * v.z + m[10],
    z: m[2] * v.x + m[5] * v.y + m[8] * v.z + m[11],
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
      child.geometry?.dispose()
      disposeMaterial(child.material as THREE.Material | THREE.Material[])
    }
  })
}

/**
 * The interactive viewport: renders the document as a part hierarchy, supports
 * orbiting, picking (parts and vertices), a transform gizmo, and vertex
 * dragging. Edits are reported through callbacks and written back to the text
 * by the store.
 */
export class LDrawScene {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private transformControls: TransformControls
  private provider = defaultLdrawProvider
  private modelGroup = new THREE.Group()
  private connectorGroup = new THREE.Group()
  private partGroups = new Map<number, THREE.Group>()
  private pickMeshes: THREE.Object3D[] = []
  private editableMeshes: THREE.Mesh[] = []
  private editableEdgeMeshes: THREE.LineSegments[] = []
  private gridHelper: THREE.GridHelper | null = null
  private axesHelper: THREE.AxesHelper
  private ambientLight: THREE.AmbientLight
  private directionalLight: THREE.DirectionalLight
  private settings: EditorSettings
  private animationId = 0
  private hasFramed = false
  private updateToken = 0
  private disposed = false
  private bfcCertified = false
  private built: BuiltModel | null = null

  private tool: ToolType = 'select'
  private selectedLine: number | null = null
  private selectedLines = new Set<number>()
  private selectionBoxes: THREE.BoxHelper[] = []

  private drawVariant: ActiveDrawVariant | null = null
  private drawDrag: { kind: ActiveDrawVariant['kind']; ax: number; az: number; cx: number; cz: number; surfaceY: number } | null = null
  private previewBox: THREE.Mesh | null = null

  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private draggingPart: { lineNumber: number; plane: THREE.Plane; startX: number; startZ: number; startPositions: Map<number, THREE.Vector3>; moved: boolean } | null = null
  private transformStartPositions: Map<number, THREE.Vector3> | null = null

  // Vertex-edit mode state (markers + multi-select + live mesh updates).
  // Vertices are welded by scene-space position, so a corner shared by several
  // quads/tris is one editable point that moves every line referencing it.
  private vertexMarkerGroup = new THREE.Group()
  private vertexMarkers = new Map<string, THREE.Mesh>()
  private vertexPositions = new Map<string, THREE.Vector3>()
  private vertexRefs = new Map<string, VertexSelection[]>()
  private vertexRefPosKey = new Map<string, string>()
  private selectedVertexKeys = new Set<string>()
  private draggingVertices: { keys: string[]; anchorKey: string; anchorStart: THREE.Vector3; startPositions: Map<string, THREE.Vector3>; plane: THREE.Plane; moved: boolean } | null = null
  private vertexGizmo: THREE.Object3D | null = null
  private vertexTransformStartPositions: Map<string, THREE.Vector3> | null = null
  private vertexTransformStartCenter: THREE.Vector3 | null = null

  constructor(
    private container: HTMLElement,
    settings: EditorSettings,
    private callbacks: LDrawSceneCallbacks,
  ) {
    this.settings = settings

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(settings.backgroundColor)

    const width = container.clientWidth || 1
    const height = container.clientHeight || 1
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100000)
    this.camera.position.set(80, 120, 160)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.addEventListener('mouseDown', this.onTransformMouseDown)
    this.transformControls.addEventListener('mouseUp', this.onTransformMouseUp)
    this.transformControls.addEventListener('objectChange', this.onTransformObjectChange)
    this.scene.add(this.transformControls)

    this.axesHelper = new THREE.AxesHelper(50)
    this.axesHelper.visible = settings.showAxes
    this.scene.add(this.axesHelper)

    this.rebuildGrid()

    this.ambientLight = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity)
    this.directionalLight = new THREE.DirectionalLight(settings.directionalColor, settings.directionalIntensity)
    this.directionalLight.position.set(-100, 200, -100)
    this.scene.add(this.ambientLight, this.directionalLight)

    this.scene.add(this.modelGroup)
    this.scene.add(this.connectorGroup)
    this.scene.add(this.vertexMarkerGroup)

    const dom = this.renderer.domElement
    dom.addEventListener('pointermove', this.onPointerMove)
    // Capture phase so a vertex-marker click wins over the transform gizmo,
    // which otherwise sits on top of the selection centroid.
    dom.addEventListener('pointerdown', this.onVertexMarkerPointerDown, true)
    dom.addEventListener('pointerdown', this.onPointerDown)
    dom.addEventListener('pointerup', this.onPointerUp)
    dom.addEventListener('click', this.onClick)

    this.animate()
  }

  setSettings(settings: EditorSettings): void {
    this.settings = settings
    this.scene.background = new THREE.Color(settings.backgroundColor)
    this.axesHelper.visible = settings.showAxes
    this.ambientLight.color.set(settings.ambientColor)
    this.ambientLight.intensity = settings.ambientIntensity
    this.directionalLight.color.set(settings.directionalColor)
    this.directionalLight.intensity = settings.directionalIntensity
    this.rebuildGrid()
  }

  setTool(tool: ToolType): void {
    this.tool = tool
    if (tool === 'move' || tool === 'rotate' || tool === 'scale') {
      this.attachTransformControls()
    } else {
      this.transformControls.detach()
    }
    if (tool === 'vertex') {
      this.selectedLine = null
      this.selectedLines = new Set()
      this.clearPartHighlight()
    } else {
      this.draggingVertices = null
      this.selectedVertexKeys.clear()
      this.clearVertexMarkers()
      this.detachVertexGizmo()
    }
    if (tool !== 'draw') {
      this.drawVariant = null
      this.clearDrawPreview()
      this.setDrawCameraMode(false)
    }
  }

  setDrawVariant(variant: ActiveDrawVariant | null): void {
    this.drawVariant = variant
    this.clearDrawPreview()
    if (variant) {
      this.tool = 'draw'
      this.transformControls.detach()
      this.clearPartHighlight()
      this.setDrawCameraMode(true)
    } else {
      this.setDrawCameraMode(false)
    }
  }

  /**
   * While a draw tool is active, orbit stays available via right-drag/middle
   * (left-drag draws). Otherwise the default left-orbit mapping is restored.
   */
  private setDrawCameraMode(draw: boolean): void {
    this.controls.enabled = true
    if (draw) {
      this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    } else {
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    }
  }

  setSelectedLine(lineNumber: number | null): void {
    this.selectedLine = lineNumber
    this.selectedLines = lineNumber != null ? new Set([lineNumber]) : new Set()
    this.applyPartSelection()
  }

  setSelectedLines(lineNumber: number | null, lines: number[]): void {
    this.selectedLine = lineNumber
    this.selectedLines = new Set(lines)
    this.applyPartSelection()
  }

  setSelectedVertices(selections: VertexSelection[]): void {
    const keys = new Set<string>()
    for (const s of selections) {
      const posKey = this.vertexRefPosKey.get(this.vertexKey(s.lineNumber, s.vertexIndex))
      if (posKey) keys.add(posKey)
    }
    this.selectedVertexKeys = keys
    this.applyVertexHighlight()
    this.attachVertexGizmo()
  }

  /**
   * Live-preview vertex moves coming from the 2D schematic view (no commit or
   * rebuild). Positions are LDraw coords, exactly like `onMoveVertices`. The
   * editable mesh buffers and vertex markers are updated in place so a drag in
   * the schematic is mirrored into the 3D view until the store commits.
   */
  previewVertexMoves(entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }>): void {
    if (this.tool !== 'vertex') return
    const updates = new Map<string, THREE.Vector3>()
    const markerUpdates = new Map<string, THREE.Vector3>()
    for (const e of entries) {
      const s = flipY(e.position)
      const scene = new THREE.Vector3(s.x, s.y, s.z)
      const refKey = this.vertexKey(e.lineNumber, e.vertexIndex)
      updates.set(refKey, scene)
      const posKeyOfRef = this.vertexRefPosKey.get(refKey)
      if (posKeyOfRef) markerUpdates.set(posKeyOfRef, scene)
    }
    this.updateEditableMeshVertices(updates)
    for (const [key, pos] of markerUpdates) {
      const marker = this.vertexMarkers.get(key)
      if (marker) marker.position.copy(pos)
    }
  }

  /**
   * Nudge the current selection by one move-increment along a scene axis (the
   * universal arrow-key "incremental movement"). Moves either the selected
   * welded vertices (vertex mode) or the selected part(s). `axis`/`sign` are
   * scene-space (so +Y = "up" on screen), converted to LDraw on commit.
   */
  nudgeSelection(axis: 'x' | 'y' | 'z', sign: 1 | -1): void {
    const inc = Math.max(this.settings.moveIncrement || 1, 0.05)
    const dx = axis === 'x' ? sign * inc : 0
    const dy = axis === 'y' ? sign * inc : 0
    const dz = axis === 'z' ? sign * inc : 0

    if (this.tool === 'vertex' && this.selectedVertexKeys.size > 0) {
      const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
      for (const key of this.selectedVertexKeys) {
        const p = this.vertexPositions.get(key)
        const refs = this.vertexRefs.get(key)
        if (!p || !refs) continue
        const np = new THREE.Vector3(p.x + dx, p.y + dy, p.z + dz)
        this.vertexPositions.set(key, np)
        const marker = this.vertexMarkers.get(key)
        if (marker) marker.position.copy(np)
        const lp = flipY(np)
        for (const ref of refs) entries.push({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex, position: lp })
      }
      if (entries.length > 0) this.callbacks.onMoveVertices(entries)
      return
    }

    if (this.selectedLine == null) return
    const group = this.partGroups.get(this.selectedLine)
    if (!group) return
    const { position, matrix } = matrix4ToLdraw(group.matrix)
    // position/matrix are scene-space; move along scene axes then convert.
    const sceneTarget = { x: position.x + dx, y: position.y + dy, z: position.z + dz }
    this.callbacks.onTransformPart(this.selectedLine, flipY(sceneTarget), sceneMatrixToLdraw(matrix))
  }

  frameView(): void {
    this.frame()
  }

  async update(document: LDrawDocument, activeFileName?: string): Promise<void> {
    const token = ++this.updateToken
    try {
      // In vertex mode the viewport shows the active file's own geometry as the
      // editable root (its sub-references stay non-editable), so markers and
      // drags operate on the file whose tab is open.
      const built = this.tool === 'vertex' && activeFileName
        ? await buildModelGeometry(document, this.provider, activeFileName, {})
        : await buildDocumentGeometry(document, this.provider)
      if (token !== this.updateToken || this.disposed) return
      this.built = built
      this.bfcCertified = document.models.length > 0 && modelCertified(document.models[0])
      this.applyModel(built)
      if (this.tool === 'vertex') this.rebuildVertexMarkers(built)
      this.renderConnectors(document)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[scene] update failed', error)
    }
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.animationId)

    const dom = this.renderer.domElement
    dom.removeEventListener('pointermove', this.onPointerMove)
    dom.removeEventListener('pointerdown', this.onVertexMarkerPointerDown, true)
    dom.removeEventListener('pointerdown', this.onPointerDown)
    dom.removeEventListener('pointerup', this.onPointerUp)
    dom.removeEventListener('click', this.onClick)

    this.controls.dispose()
    this.transformControls.removeEventListener('mouseDown', this.onTransformMouseDown)
    this.transformControls.removeEventListener('mouseUp', this.onTransformMouseUp)
    this.transformControls.removeEventListener('objectChange', this.onTransformObjectChange)
    this.transformControls.dispose()
    disposeObject(this.modelGroup)
    disposeObject(this.connectorGroup)
    this.clearPartHighlight()
    this.clearVertexMarkers()
    if (this.previewBox) {
      this.previewBox.geometry.dispose()
      disposeMaterial(this.previewBox.material as THREE.Material)
      this.scene.remove(this.previewBox)
      this.previewBox = null
    }
    if (this.gridHelper) {
      this.gridHelper.geometry.dispose()
      disposeMaterial(this.gridHelper.material as THREE.Material | THREE.Material[])
      this.scene.remove(this.gridHelper)
    }
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  private animate = (): void => {
    if (this.disposed) return
    this.animationId = requestAnimationFrame(this.animate)
    this.controls.update()
    for (const box of this.selectionBoxes) box.update()
    this.updateVertexMarkerScale()
    this.renderer.render(this.scene, this.camera)
  }

  /** Keep vertex markers at a constant on-screen size regardless of zoom. */
  private updateVertexMarkerScale(): void {
    if (this.vertexMarkers.size === 0) return
    const height = this.container.clientHeight || 1
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360)
    for (const marker of this.vertexMarkers.values()) {
      const dist = this.camera.position.distanceTo(marker.position)
      const scale = (VERTEX_MARKER_PX * 2 * dist * tanHalf) / height
      marker.scale.setScalar(scale * (marker.userData.selected ? 1.4 : 1))
    }
  }

  private rebuildGrid(): void {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper)
      this.gridHelper.geometry.dispose()
      disposeMaterial(this.gridHelper.material as THREE.Material | THREE.Material[])
      this.gridHelper = null
    }
    if (!this.settings.showGrid) return

    const size = this.settings.gridSize
    const color = new THREE.Color(this.settings.gridColor)
    this.gridHelper = new THREE.GridHelper(size, Math.max(Math.round(size / 20), 2), color, color)
    this.scene.add(this.gridHelper)
  }

  private buildDirectMeshes(direct: DirectGeometry, editable: boolean): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = []

    if (direct.facePositions.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(direct.facePositions, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(direct.faceColors, 3))
      geo.setAttribute('aLineIndex', new THREE.Float32BufferAttribute(direct.faceLineIndices, 1))
      geo.setAttribute('aVertexIndex', new THREE.Float32BufferAttribute(direct.faceVertexIndices, 1))
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.4,
        metalness: 0,
        side: this.bfcCertified ? THREE.FrontSide : THREE.DoubleSide,
        flatShading: true,
      })
      const mesh = new THREE.Mesh(geo, material)
      mesh.userData.editable = editable
      meshes.push(mesh)
    }

    if (direct.edgePositions.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(direct.edgePositions, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(direct.edgeColors, 3))
      geo.setAttribute('aLineIndex', new THREE.Float32BufferAttribute(direct.edgeLineIndices, 1))
      geo.setAttribute('aVertexIndex', new THREE.Float32BufferAttribute(direct.edgeVertexIndices, 1))
      const material = new THREE.LineBasicMaterial({ vertexColors: true })
      const lines = new THREE.LineSegments(geo, material)
      lines.userData.editable = editable
      meshes.push(lines)
    }

    return meshes
  }

  private buildPartGroup(part: BuiltPart, topLineNumber: number | null, topFile?: string): THREE.Group {
    const group = new THREE.Group()
    applyLdrawMatrix(group, part.position, part.matrix)

    const myTop = topLineNumber ?? part.lineNumber
    const myFile = topFile ?? part.file
    for (const mesh of this.buildDirectMeshes(part.direct, false)) {
      mesh.userData.topPartLineNumber = myTop
      mesh.userData.topPartFile = myFile
      group.add(mesh)
    }
    for (const child of part.parts) {
      group.add(this.buildPartGroup(child, myTop, myFile))
    }

    if (topLineNumber === null) {
      group.userData.lineNumber = part.lineNumber
      group.userData.file = part.file
      this.partGroups.set(part.lineNumber, group)
    }
    return group
  }

  private collectRenderables(): void {
    this.pickMeshes = []
    this.editableMeshes = []
    this.editableEdgeMeshes = []
    this.modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.pickMeshes.push(child)
        if (child.userData.editable) this.editableMeshes.push(child)
      } else if (child instanceof THREE.LineSegments) {
        this.pickMeshes.push(child)
        if (child.userData.editable) this.editableEdgeMeshes.push(child)
      }
    })
  }

  private applyModel(built: BuiltModel): void {
    this.transformControls.detach()
    this.clearPartHighlight()
    // Vertex markers are rebuilt (and cleared) by `rebuildVertexMarkers`, which
    // needs the old `vertexRefs` to remap the selection across the edit.
    this.detachVertexGizmo()
    this.partGroups.clear()

    for (const child of [...this.modelGroup.children]) {
      this.modelGroup.remove(child)
      disposeObject(child)
    }

    for (const mesh of this.buildDirectMeshes(built.direct, true)) {
      mesh.userData.topPartLineNumber = null
      this.modelGroup.add(mesh)
    }
    for (const part of built.parts) {
      this.modelGroup.add(this.buildPartGroup(part, null))
    }

    this.collectRenderables()

    if (this.selectedLine != null) this.applyPartSelection()

    if (!this.hasFramed) {
      this.frame()
      this.hasFramed = true
    }
  }

  /**
   * Render `0 PE_CONN` connectivity records of the main model as colored
   * markers. Stud/hole records draw their full grid (one marker per occupied
   * cell); axle/slider/rail types draw a shape stretched along the connector
   * axis; ball/hinge/fixed draw a sphere or cylinder. Markers live in a
   * separate group so they are not part of geometry picking.
   */
  private renderConnectors(document: LDrawDocument): void {
    for (const child of [...this.connectorGroup.children]) {
      this.connectorGroup.remove(child)
      disposeObject(child)
    }
    const model = document.models[0]
    if (!model) return

    for (const cmd of model.commands) {
      if (cmd.kind !== 'comment' || cmd.keyword !== 'PE_CONN') continue
      const connector = parseConnText(cmd.rest)
      if (!connector) continue
      const marker = this.buildConnectorMarker(connector)
      if (marker) this.connectorGroup.add(marker)
    }
  }

  private buildConnectorMarker(connector: Connector): THREE.Group | null {
    const group = new THREE.Group()
    group.userData.isHelper = true
    const material = new THREE.MeshBasicMaterial({
      color: connectorColor(connector),
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    const pos = connPosition(connector.matrix)
    const dir = connDirection(connector.matrix)
    const scenePos = new THREE.Vector3(pos.x, -pos.y, pos.z)
    const sceneDir = new THREE.Vector3(dir.x, -dir.y, dir.z).normalize()

    if (connector.connType === PhysicalT.Stud || connector.connType === PhysicalT.Hole) {
      this.buildGridMarker(group, material, connector)
      return group
    }

    const add = (geometry: THREE.BufferGeometry, at: THREE.Vector3, orient: boolean) => {
      const mesh = new THREE.Mesh(geometry, material)
      if (orient && sceneDir.lengthSq() > 0.999) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sceneDir)
      }
      mesh.position.copy(at)
      mesh.renderOrder = 999
      mesh.userData.isHelper = true
      group.add(mesh)
    }

    switch (connector.connType) {
      case PhysicalT.Axle: {
        const len = connector.length
        if (connector.subType === AxleT.Axle) {
          // Cross axle: two perpendicular fins along the axis.
          const fin = new THREE.BoxGeometry(3, len, 3)
          const finGeo = fin
          add(finGeo, scenePos, true)
          const fin2 = new THREE.BoxGeometry(3, len, 3)
          add(fin2, scenePos, true)
          // rotate the second fin 90° about the axis
          const last = group.children[group.children.length - 1]
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
          last.quaternion.multiply(q)
        } else if (connector.subType % 2 === 0) {
          // Socket (female): a wider, open cylinder.
          add(new THREE.CylinderGeometry(5, 5, len, 16), scenePos, true)
        } else {
          // Pin/bar/clip (male): a slim cylinder.
          add(new THREE.CylinderGeometry(2.5, 2.5, len, 12), scenePos, true)
        }
        // End caps.
        const capGeo = new THREE.SphereGeometry(3, 10, 10)
        if (connector.isStartCapped) add(capGeo, scenePos.clone(), false)
        if (connector.isEndCapped) add(capGeo, scenePos.clone().addScaledVector(sceneDir, connector.length), false)
        break
      }
      case PhysicalT.Ball:
        add(new THREE.SphereGeometry(6, 16, 12), scenePos, false)
        break
      case PhysicalT.Fixed:
        add(new THREE.SphereGeometry(6, 16, 12), scenePos, false)
        add(new THREE.BoxGeometry(5, 5, 5), scenePos.clone().addScaledVector(sceneDir, 6), true)
        break
      case PhysicalT.Hinge:
        add(new THREE.CylinderGeometry(5, 5, 8, 16), scenePos, true)
        break
      case PhysicalT.Rail:
        add(new THREE.BoxGeometry(4, connector.length, 4), scenePos, true)
        break
      case PhysicalT.Slider:
        add(new THREE.CylinderGeometry(4, 4, connector.length, 16), scenePos, true)
        break
      default:
        add(new THREE.SphereGeometry(4, 12, 12), scenePos, false)
        break
    }
    return group
  }

  /** Draw each occupied cell of a Stud/Hole grid as a small marker. */
  private buildGridMarker(
    group: THREE.Group,
    material: THREE.Material,
    connector: Extract<Connector, { connType: PhysicalT.Stud }> | Extract<Connector, { connType: PhysicalT.Hole }>,
  ): void {
    const isStud = connector.connType === PhysicalT.Stud
    const cells = connector.cells
    // A connector is a point on the surface, so its marker sits entirely on
    // one side of the surface: studs on top (+Y), anti-studs underneath (-Y).
    const outward = isStud ? 1 : -1
    const baseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(connectorColor(connector)).multiplyScalar(0.55),
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    // Track the world-space extents to draw a base plate.
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let y = 0

    for (let i = 0; i < cells.length; i++) {
      const row = cells[i]
      for (let j = 0; j < row.length; j++) {
        const cell = row[j]
        if (!cell || cell.altitude <= 0) continue
        const local = connTransformPoint(connector.matrix, { x: i * 10, y: 0, z: j * 10 })
        y = local.y
        minX = Math.min(minX, local.x)
        maxX = Math.max(maxX, local.x)
        minZ = Math.min(minZ, local.z)
        maxZ = Math.max(maxZ, local.z)
        let geometry: THREE.BufferGeometry | null = null
        let halfHeight = 2
        if (cell.altitude === 3) {
          // Corner / edge marker.
          geometry = new THREE.SphereGeometry(2, 8, 8)
          halfHeight = 2
        } else if (isStud) {
          geometry = new THREE.CylinderGeometry(6, 6, 4, 16)
          halfHeight = 2
        } else {
          const tube = cell.altitude >= 20
          geometry = new THREE.CylinderGeometry(6, 6, tube ? 10 : 3, 16)
          halfHeight = tube ? 5 : 1.5
        }
        if (!geometry) continue
        const at = new THREE.Vector3(local.x, -local.y + outward * halfHeight, local.z)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.copy(at)
        mesh.renderOrder = 999
        mesh.userData.isHelper = true
        group.add(mesh)
      }
    }

    if (Number.isFinite(minX)) {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(maxX - minX, 20), 1, Math.max(maxZ - minZ, 20)),
        baseMat,
      )
      base.position.set((minX + maxX) / 2, -y + outward * 0.5, (minZ + maxZ) / 2)
      base.renderOrder = 998
      base.userData.isHelper = true
      group.add(base)
    }
  }

  private applyPartSelection(): void {
    this.clearPartHighlight()
    if (this.selectedLine != null) {
      for (const line of this.selectedLines) {
        const group = this.partGroups.get(line)
        if (group) {
          const box = new THREE.BoxHelper(group, new THREE.Color(PART_HIGHLIGHT))
          box.userData.isHelper = true
          this.scene.add(box)
          this.selectionBoxes.push(box)
        }
      }
    }
    this.attachTransformControls()
  }

  private attachTransformControls(): void {
    const group = this.selectedLine != null ? this.partGroups.get(this.selectedLine) : undefined
    if (group && (this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale')) {
      const mode: 'translate' | 'rotate' | 'scale' = this.tool === 'move' ? 'translate' : this.tool
      this.transformControls.setMode(mode)
      this.transformControls.attach(group)
    } else {
      this.transformControls.detach()
    }
  }

  private clearPartHighlight(): void {
    for (const box of this.selectionBoxes) {
      this.scene.remove(box)
      disposeObject(box)
    }
    this.selectionBoxes = []
  }

  /* -------------------- vertex-edit mode -------------------- */

  private vertexKey(lineNumber: number, vertexIndex: number): string {
    return `${lineNumber}:${vertexIndex}`
  }

  /** Stable key for a scene-space position, welded to ~0.001 LDU. */
  private posKey(p: { x: number; y: number; z: number }): string {
    return `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}:${Math.round(p.z * 1000)}`
  }

  private rebuildVertexMarkers(built: BuiltModel): void {
    // Capture the selected refs (line:vertexIndex is stable across edits) so the
    // selection survives a rebuild after the vertices move.
    const selectedRefs: VertexSelection[] = []
    for (const key of this.selectedVertexKeys) {
      const refs = this.vertexRefs.get(key)
      if (refs) for (const ref of refs) selectedRefs.push(ref)
    }
    this.clearVertexMarkers()
    const direct = built.direct
    const refsByKey = new Map<string, VertexSelection[]>()
    const posByKey = new Map<string, THREE.Vector3>()
    const addVertex = (x: number, y: number, z: number, line: number, vertexIndex: number) => {
      const pos = new THREE.Vector3(x, y, z)
      const key = this.posKey(pos)
      if (!refsByKey.has(key)) {
        refsByKey.set(key, [])
        posByKey.set(key, pos)
      }
      const list = refsByKey.get(key)!
      if (!list.some((r) => r.lineNumber === line && r.vertexIndex === vertexIndex)) {
        list.push({ lineNumber: line, vertexIndex })
      }
    }
    // Face vertices (type 3/4) …
    for (let i = 0; i < direct.facePositions.length; i += 3) {
      const vi = i / 3
      addVertex(
        direct.facePositions[i],
        direct.facePositions[i + 1],
        direct.facePositions[i + 2],
        Math.round(direct.faceLineIndices[vi] ?? 0),
        Math.round(direct.faceVertexIndices[vi] ?? 0),
      )
    }
    // … and edge vertices (type 2) so lines follow a welded corner too.
    for (let i = 0; i < direct.edgePositions.length; i += 3) {
      const vi = i / 3
      addVertex(
        direct.edgePositions[i],
        direct.edgePositions[i + 1],
        direct.edgePositions[i + 2],
        Math.round(direct.edgeLineIndices[vi] ?? 0),
        Math.round(direct.edgeVertexIndices[vi] ?? 0),
      )
    }
    for (const [key, refs] of refsByKey) {
      const pos = posByKey.get(key)!
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 14),
        new THREE.MeshBasicMaterial({
          color: VERTEX_MARKER_COLOR,
          // Opaque + depth-tested: far-side markers are hidden behind the model
          // instead of showing through it. Polygon offset keeps the dot from
          // z-fighting with the surface it sits on.
          transparent: false,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
      marker.userData.isHelper = true
      marker.userData.vertexKey = key
      marker.userData.selected = false
      marker.position.copy(pos)
      marker.renderOrder = 999
      this.vertexMarkerGroup.add(marker)
      this.vertexMarkers.set(key, marker)
      this.vertexPositions.set(key, pos.clone())
      this.vertexRefs.set(key, refs)
      for (const ref of refs) this.vertexRefPosKey.set(this.vertexKey(ref.lineNumber, ref.vertexIndex), key)
    }
    // Re-derive the selected welded positions from the stable refs.
    this.selectedVertexKeys = new Set<string>()
    for (const ref of selectedRefs) {
      const posKey = this.vertexRefPosKey.get(this.vertexKey(ref.lineNumber, ref.vertexIndex))
      if (posKey) this.selectedVertexKeys.add(posKey)
    }
    this.applyVertexHighlight()
    this.attachVertexGizmo()
  }

  private clearVertexMarkers(): void {
    for (const marker of this.vertexMarkers.values()) {
      this.vertexMarkerGroup.remove(marker)
      marker.geometry.dispose()
      disposeMaterial(marker.material as THREE.Material)
    }
    this.vertexMarkers.clear()
    this.vertexPositions.clear()
    this.vertexRefs.clear()
    this.vertexRefPosKey.clear()
  }

  private applyVertexHighlight(): void {
    for (const [key, marker] of this.vertexMarkers) {
      const selected = this.selectedVertexKeys.has(key)
      marker.userData.selected = selected
      const mat = marker.material as THREE.MeshBasicMaterial
      mat.color.set(selected ? VERTEX_MARKER_SELECTED : VERTEX_MARKER_COLOR)
    }
  }

  private pickVertexMarker(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects([...this.vertexMarkers.values()], false)
    for (const hit of hits) {
      const key = hit.object.userData.vertexKey as string | undefined
      if (key) return key
    }
    return null
  }

  /** Live-update the editable mesh's vertex positions (keyed by line:vertexIndex). */
  private updateEditableMeshVertices(updates: Map<string, THREE.Vector3>): void {
    const apply = (geo: THREE.BufferGeometry) => {
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
      const lineAttr = geo.getAttribute('aLineIndex') as THREE.BufferAttribute | undefined
      const vertAttr = geo.getAttribute('aVertexIndex') as THREE.BufferAttribute | undefined
      if (!lineAttr || !vertAttr) return
      let dirty = false
      for (let i = 0; i < posAttr.count; i++) {
        const key = this.vertexKey(Math.round(lineAttr.getX(i)), Math.round(vertAttr.getX(i)))
        const p = updates.get(key)
        if (p) {
          posAttr.setXYZ(i, p.x, p.y, p.z)
          dirty = true
        }
      }
      if (dirty) posAttr.needsUpdate = true
    }
    for (const mesh of this.editableMeshes) apply(mesh.geometry)
    for (const lines of this.editableEdgeMeshes) apply(lines.geometry)
  }

  private syncVertexSelectionToStore(): void {
    const selections: VertexSelection[] = []
    for (const key of this.selectedVertexKeys) {
      const refs = this.vertexRefs.get(key)
      if (refs) for (const ref of refs) selections.push(ref)
    }
    this.callbacks.onSelectVertices(selections)
  }

  private attachVertexGizmo(): void {
    if (this.tool !== 'vertex' || this.selectedVertexKeys.size === 0 || this.draggingVertices != null) {
      this.detachVertexGizmo()
      return
    }
    const center = new THREE.Vector3()
    let n = 0
    for (const key of this.selectedVertexKeys) {
      const p = this.vertexPositions.get(key)
      if (p) {
        center.add(p)
        n += 1
      }
    }
    if (n === 0) {
      this.detachVertexGizmo()
      return
    }
    center.divideScalar(n)
    if (!this.vertexGizmo) {
      this.vertexGizmo = new THREE.Object3D()
      this.vertexGizmo.userData.isVertexGizmo = true
      this.scene.add(this.vertexGizmo)
    }
    this.vertexGizmo.position.copy(center)
    this.transformControls.setMode('translate')
    this.transformControls.attach(this.vertexGizmo)
  }

  private detachVertexGizmo(): void {
    if (this.vertexGizmo && this.transformControls.object === this.vertexGizmo) {
      this.transformControls.detach()
    }
    if (this.vertexGizmo) {
      this.scene.remove(this.vertexGizmo)
      this.vertexGizmo = null
    }
  }

  private startVertexDrag(): void {
    if (this.selectedVertexKeys.size === 0) return
    const keys = [...this.selectedVertexKeys]
    const anchorKey = keys[0]
    const anchor = this.vertexPositions.get(anchorKey)
    if (!anchor) return
    const startPositions = new Map<string, THREE.Vector3>()
    for (const key of keys) {
      const p = this.vertexPositions.get(key)
      if (p) startPositions.set(key, p.clone())
    }
    const normal = this.camera.getWorldDirection(new THREE.Vector3())
    this.draggingVertices = {
      keys,
      anchorKey,
      anchorStart: anchor.clone(),
      startPositions,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor),
      moved: false,
    }
    this.controls.enabled = false
    this.detachVertexGizmo()
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private pickPart(): PartSelection | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false)
    for (const hit of hits) {
      const line = hit.object.userData.topPartLineNumber as number | null | undefined
      if (line != null) {
        return { lineNumber: line, file: (hit.object.userData.topPartFile as string) ?? '' }
      }
    }
    return null
  }

  private onClick = (): void => {
    if (this.tool === 'select' || this.tool === 'vertex' || this.tool === 'draw') return
    this.callbacks.onSelectPart(this.pickPart())
  }

  private onVertexMarkerPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.tool !== 'vertex') return
    this.updatePointer(event)
    if (this.pickVertexMarker()) {
      // The pointer is on a vertex marker: free-drag it and keep the transform
      // gizmo from grabbing the pointer (it overlaps the marker).
      event.stopPropagation()
      this.onPointerDown(event)
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    this.updatePointer(event)
    // The transform gizmo owns the pointer when one of its handles is grabbed
    // (its pointerdown fires before ours); dragging a handle must never start a
    // body/vertex drag underneath it.
    if (this.transformControls.dragging) return

    if (this.tool === 'draw' && this.drawVariant) {
      this.startDraw()
      return
    }

    if (this.tool === 'select' || this.tool === 'move') {
      // Dragging a part body (not a gizmo handle) moves the selected parts.
      const pick = this.pickPart()
      if (event.ctrlKey || event.metaKey) {
        if (pick) this.callbacks.onToggleSelect(pick)
        return
      }
      this.callbacks.onSelectPart(pick)
      if (!pick) return
      const group = this.partGroups.get(pick.lineNumber)
      if (!group) return
      const worldPos = new THREE.Vector3().setFromMatrixPosition(group.matrixWorld)
      // Record every selected part's starting position so the whole group
      // moves together live during the drag (not just the primary part).
      const startPositions = new Map<number, THREE.Vector3>()
      for (const line of this.selectedLines) {
        const g = this.partGroups.get(line)
        if (g) startPositions.set(line, new THREE.Vector3().setFromMatrixPosition(g.matrixWorld))
      }
      if (!startPositions.has(pick.lineNumber)) startPositions.set(pick.lineNumber, worldPos.clone())
      this.draggingPart = {
        lineNumber: pick.lineNumber,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), worldPos),
        startX: worldPos.x,
        startZ: worldPos.z,
        startPositions,
        moved: false,
      }
      this.controls.enabled = false
      return
    }

    if (this.tool === 'vertex') {
      const pick = this.pickVertexMarker()
      if (event.ctrlKey || event.metaKey) {
        if (pick) {
          if (this.selectedVertexKeys.has(pick)) this.selectedVertexKeys.delete(pick)
          else this.selectedVertexKeys.add(pick)
          this.applyVertexHighlight()
          this.syncVertexSelectionToStore()
          this.attachVertexGizmo()
        }
        return
      }
      if (!pick) {
        this.selectedVertexKeys.clear()
        this.applyVertexHighlight()
        this.syncVertexSelectionToStore()
        this.detachVertexGizmo()
        return
      }
      if (!this.selectedVertexKeys.has(pick)) {
        this.selectedVertexKeys = new Set([pick])
        this.applyVertexHighlight()
        this.syncVertexSelectionToStore()
        this.attachVertexGizmo()
      }
      this.startVertexDrag()
      return
    }

    return
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.updatePointer(event)

    if (this.tool === 'draw' && this.drawDrag) {
      const point = this.groundPoint()
      if (point) {
        this.drawDrag.cx = Math.round(point.x / DRAW_GRID) * DRAW_GRID
        this.drawDrag.cz = Math.round(point.z / DRAW_GRID) * DRAW_GRID
        this.updateDrawPreview()
      }
      return
    }

    if (this.draggingPart) {
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const target = new THREE.Vector3()
      if (this.raycaster.ray.intersectPlane(this.draggingPart.plane, target)) {
        const x = Math.round(target.x / GRAB_SNAP) * GRAB_SNAP
        const z = Math.round(target.z / GRAB_SNAP) * GRAB_SNAP
        const dx = x - this.draggingPart.startX
        const dz = z - this.draggingPart.startZ
        for (const [line, start] of this.draggingPart.startPositions) {
          const g = this.partGroups.get(line)
          if (g) g.position.set(start.x + dx, start.y, start.z + dz)
        }
        this.draggingPart.moved = true
      }
      return
    }

    if (this.draggingVertices) {
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const target = new THREE.Vector3()
      if (this.raycaster.ray.intersectPlane(this.draggingVertices.plane, target)) {
        const dx = target.x - this.draggingVertices.anchorStart.x
        const dy = target.y - this.draggingVertices.anchorStart.y
        const dz = target.z - this.draggingVertices.anchorStart.z
        const updates = new Map<string, THREE.Vector3>()
        for (const key of this.draggingVertices.keys) {
          const start = this.draggingVertices.startPositions.get(key)
          if (!start) continue
          const np = new THREE.Vector3(start.x + dx, start.y + dy, start.z + dz)
          this.vertexPositions.set(key, np)
          const marker = this.vertexMarkers.get(key)
          if (marker) marker.position.copy(np)
          const refs = this.vertexRefs.get(key)
          if (refs) for (const ref of refs) updates.set(this.vertexKey(ref.lineNumber, ref.vertexIndex), np)
        }
        this.updateEditableMeshVertices(updates)
        this.draggingVertices.moved = true
      }
      return
    }
  }

  private onPointerUp = (): void => {
    if (this.tool === 'draw' && this.drawDrag) {
      this.finishDraw()
      return
    }

    if (this.draggingPart) {
      const drag = this.draggingPart
      this.draggingPart = null
      this.controls.enabled = true
      if (drag.moved) {
        const group = this.partGroups.get(drag.lineNumber)
        if (group) {
          const { position, matrix } = matrix4ToLdraw(group.matrix)
          this.callbacks.onTransformPart(drag.lineNumber, flipY(position), sceneMatrixToLdraw(matrix))
        }
      }
      return
    }

    if (this.draggingVertices) {
      const drag = this.draggingVertices
      this.draggingVertices = null
      this.controls.enabled = true
      if (drag.moved) {
        const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
        for (const key of drag.keys) {
          const p = this.vertexPositions.get(key)
          const refs = this.vertexRefs.get(key)
          if (p && refs) for (const ref of refs) entries.push({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex, position: flipY(p) })
        }
        if (entries.length) this.callbacks.onMoveVertices(entries)
      }
      this.attachVertexGizmo()
      return
    }
  }

  private onTransformMouseDown = (): void => {
    this.controls.enabled = false
    this.transformStartPositions = null
    this.vertexTransformStartPositions = null
    this.vertexTransformStartCenter = null

    // Vertex gizmo: record the selected vertices' positions and the gizmo center.
    if (this.vertexGizmo && this.transformControls.object === this.vertexGizmo) {
      const starts = new Map<string, THREE.Vector3>()
      for (const key of this.selectedVertexKeys) {
        const p = this.vertexPositions.get(key)
        if (p) starts.set(key, p.clone())
      }
      this.vertexTransformStartPositions = starts
      this.vertexTransformStartCenter = this.vertexGizmo.position.clone()
      return
    }

    if (this.selectedLine == null) return
    const primary = this.partGroups.get(this.selectedLine)
    if (!primary) return
    const starts = new Map<number, THREE.Vector3>()
    for (const line of this.selectedLines) {
      const g = this.partGroups.get(line)
      if (g) starts.set(line, new THREE.Vector3().setFromMatrixPosition(g.matrixWorld))
    }
    if (!starts.has(this.selectedLine)) starts.set(this.selectedLine, new THREE.Vector3().setFromMatrixPosition(primary.matrixWorld))
    this.transformStartPositions = starts
  }

  private onTransformObjectChange = (): void => {
    // Vertex gizmo: translate every selected vertex live.
    if (this.vertexGizmo && this.transformControls.object === this.vertexGizmo) {
      if (!this.vertexTransformStartPositions || !this.vertexTransformStartCenter) return
      const center = this.vertexGizmo.position
      const dx = center.x - this.vertexTransformStartCenter.x
      const dy = center.y - this.vertexTransformStartCenter.y
      const dz = center.z - this.vertexTransformStartCenter.z
      const updates = new Map<string, THREE.Vector3>()
      for (const [key, start] of this.vertexTransformStartPositions) {
        const np = new THREE.Vector3(start.x + dx, start.y + dy, start.z + dz)
        this.vertexPositions.set(key, np)
        const marker = this.vertexMarkers.get(key)
        if (marker) marker.position.copy(np)
        const refs = this.vertexRefs.get(key)
        if (refs) for (const ref of refs) updates.set(this.vertexKey(ref.lineNumber, ref.vertexIndex), np)
      }
      this.updateEditableMeshVertices(updates)
      // Mirror the live positions into the text editor (no history).
      const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
      for (const key of this.selectedVertexKeys) {
        const p = this.vertexPositions.get(key)
        const refs = this.vertexRefs.get(key)
        if (p && refs) for (const ref of refs) entries.push({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex, position: flipY(p) })
      }
      if (entries.length) this.callbacks.onPreviewVertices?.(entries)
      return
    }

    if (!this.transformStartPositions || this.selectedLine == null) return
    // Only translation moves a group together live; rotate/scale act on the
    // primary part alone (matching the store's transform semantics).
    if (this.tool !== 'move') return
    const primary = this.partGroups.get(this.selectedLine)
    if (!primary || this.transformControls.object !== primary) return
    const start = this.transformStartPositions.get(this.selectedLine)
    if (!start) return
    const current = new THREE.Vector3().setFromMatrixPosition(primary.matrixWorld)
    const dx = current.x - start.x
    const dy = current.y - start.y
    const dz = current.z - start.z
    for (const [line, s] of this.transformStartPositions) {
      if (line === this.selectedLine) continue
      const g = this.partGroups.get(line)
      if (g) g.position.set(s.x + dx, s.y + dy, s.z + dz)
    }
    // Mirror the live translation into the text editor (no history).
    const { position, matrix } = matrix4ToLdraw(primary.matrix)
    this.callbacks.onPreviewTransformPart?.(this.selectedLine, flipY(position), sceneMatrixToLdraw(matrix))
  }

  private onTransformMouseUp = (): void => {
    this.controls.enabled = true
    this.transformStartPositions = null

    // Vertex gizmo: commit the moved vertices.
    if (this.vertexGizmo && this.transformControls.object === this.vertexGizmo) {
      const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
      for (const key of this.selectedVertexKeys) {
        const p = this.vertexPositions.get(key)
        const refs = this.vertexRefs.get(key)
        if (p && refs) for (const ref of refs) entries.push({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex, position: flipY(p) })
      }
      this.vertexTransformStartPositions = null
      this.vertexTransformStartCenter = null
      if (entries.length) this.callbacks.onMoveVertices(entries)
      return
    }

    if (this.selectedLine == null) return

    const group = this.partGroups.get(this.selectedLine)
    if (!group || this.transformControls.object !== group) return

    const { position, matrix } = matrix4ToLdraw(group.matrix)
    if (this.tool === 'move') {
      position.x = Math.round(position.x)
      position.y = Math.round(position.y)
      position.z = Math.round(position.z)
    }
    this.callbacks.onTransformPart(this.selectedLine, flipY(position), sceneMatrixToLdraw(matrix))
  }

  /* ---------------- draw gesture (punch, erase, connectors) ---------------- */

  /** Scene-space point on the y=0 construction plane, or null. */
  private groundPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const target = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    return this.raycaster.ray.intersectPlane(plane, target) ? target : null
  }

  /** Point on the model surface under the cursor, falling back to the ground. */
  private surfacePoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false)
    if (hits.length > 0) return hits[0].point.clone()
    return this.groundPoint()
  }

  private startDraw(): void {
    const isConnector = this.drawVariant?.kind === 'connector'
    const point = isConnector ? this.surfacePoint() : this.groundPoint()
    if (!point) return
    const gx = Math.round(point.x / DRAW_GRID) * DRAW_GRID
    const gz = Math.round(point.z / DRAW_GRID) * DRAW_GRID
    this.drawDrag = { kind: this.drawVariant!.kind, ax: gx, az: gz, cx: gx, cz: gz, surfaceY: point.y }
    this.updateDrawPreview()
  }

  private updateDrawPreview(): void {
    if (!this.drawDrag || !this.drawVariant) return
    const { kind, ax, az, cx, cz } = this.drawDrag
    const height = this.drawVariant.naturalSize.y
    let min: { x: number; y: number; z: number }
    let max: { x: number; y: number; z: number }
    if (kind === 'punch') {
      const r = this.drawVariant.radius ?? 6
      const bounds = this.modelBounds()
      min = { x: cx - r, y: bounds.min.y, z: cz - r }
      max = { x: cx + r, y: bounds.max.y, z: cz + r }
    } else if (kind === 'erase') {
      const bounds = this.modelBounds()
      min = { x: Math.min(ax, cx) - 10, y: bounds.min.y, z: Math.min(az, cz) - 10 }
      max = { x: Math.max(ax, cx) + 10, y: bounds.max.y, z: Math.max(az, cz) + 10 }
    } else if (kind === 'connector' && this.drawVariant.conn) {
      const ct = this.drawVariant.conn.connType
      if (ct === PhysicalT.Stud || ct === PhysicalT.Hole) {
        min = { x: Math.min(ax, cx) - 10, y: this.drawDrag.surfaceY, z: Math.min(az, cz) - 10 }
        max = { x: Math.max(ax, cx) + 10, y: this.drawDrag.surfaceY + 4, z: Math.max(az, cz) + 10 }
      } else {
        min = { x: Math.min(ax, cx) - 2, y: this.drawDrag.surfaceY - 2, z: Math.min(az, cz) - 2 }
        max = { x: Math.max(ax, cx) + 2, y: this.drawDrag.surfaceY + 2, z: Math.max(az, cz) + 2 }
      }
    } else {
      min = { x: Math.min(ax, cx) - 10, y: 0, z: Math.min(az, cz) - 10 }
      max = { x: Math.max(ax, cx) + 10, y: height, z: Math.max(az, cz) + 10 }
    }
    this.setPreviewBox(min, max)
  }

  private finishDraw(): void {
    const drag = this.drawDrag!
    const variant = this.drawVariant!
    this.drawDrag = null
    this.clearDrawPreview()

    const loX = Math.min(drag.ax, drag.cx)
    const hiX = Math.max(drag.ax, drag.cx)
    const loZ = Math.min(drag.az, drag.cz)
    const hiZ = Math.max(drag.az, drag.cz)

    if (variant.kind === 'punch') {
      const bounds = this.modelBounds()
      const size = bounds.getSize(new THREE.Vector3())
      const radius = variant.radius ?? 6
      const tool = punchCylinderSolid(
        { x: drag.cx, y: bounds.min.y + size.y / 2, z: drag.cz },
        radius,
        size.y + 100,
      )
      this.applyPunchTool(tool, 'Punch hole')
      return
    }

    if (variant.kind === 'erase') {
      const bounds = this.modelBounds()
      const margin = 50
      const tool = punchBoxSolid(
        { x: loX - 10, y: bounds.min.y - margin, z: loZ - 10 },
        { x: hiX + 10, y: bounds.max.y + margin, z: hiZ + 10 },
      )
      this.applyPunchTool(tool, 'Erase region')
      return
    }

    if (variant.kind === 'connector' && variant.conn) {
      const c = variant.conn
      // Scene → LDraw: negate Y. The connector lands where the user clicked
      // on the model surface (or the ground plane when nothing was hit).
      const y = -drag.surfaceY

      if (c.connType === PhysicalT.Stud) {
        this.callbacks.onAddConnector(makeStudGridConnector(loX, loZ, hiX, hiZ, y, 10, c.subType))
        return
      }
      if (c.connType === PhysicalT.Hole) {
        this.callbacks.onAddConnector(makeHoleGridConnector(loX, loZ, hiX, hiZ, y, 10, c.subType))
        return
      }

      // Axle / slider (and any other axle-type): drag to set the length along
      // the connector axis. A plain click uses the variant's default length.
      const dragged = Math.hypot(hiX - loX, hiZ - loZ)
      const length = dragged < 4 ? c.length : Math.max(4, Math.round(dragged))
      const connector = makeAxleConnector({ x: drag.ax, y, z: drag.az }, c.subType, length)
      this.callbacks.onAddConnector(connector)
    }
  }

  /** Scene-space bounds of the current model (used to size punch/erase tools). */
  private modelBounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.modelGroup)
  }

  /** Flatten the model, subtract a tool solid, and write the result back as LDraw lines. */
  private applyPunchTool(tool: CsgSolid, label: string): void {
    if (!this.built) return
    const soup = flattenBuiltToSceneSoup(this.built)
    if (soup.positions.length === 0) return
    const result = subtractSoup(soup, tool)
    const lines = soupToLdrawLines(result)
    if (lines.length === 0) return
    this.callbacks.onApplyGeometry(lines, label)
  }

  private setPreviewBox(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): void {
    if (!this.previewBox) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00d4d4,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      })
      this.previewBox = new THREE.Mesh(geo, mat)
      this.previewBox.userData.isHelper = true
      this.scene.add(this.previewBox)
    }
    this.previewBox.visible = true
    this.previewBox.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
    this.previewBox.scale.set(
      Math.max(max.x - min.x, 0.01),
      Math.max(max.y - min.y, 0.01),
      Math.max(max.z - min.z, 0.01),
    )
  }

  private clearDrawPreview(): void {
    this.drawDrag = null
    if (this.previewBox) this.previewBox.visible = false
  }

  private frame(): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup)
    if (box.isEmpty()) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const distance = maxDim * 1.8

    this.camera.position.copy(center).addScaledVector(new THREE.Vector3(1, 1, 1).normalize(), distance)
    this.camera.near = Math.max(maxDim / 100, 0.1)
    this.camera.far = maxDim * 20
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
  }
}
