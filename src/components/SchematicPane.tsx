import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import type { VertexSelection } from '../store/editorStore'
import type { Vec3 } from '../core'
import type { LDrawScene } from '../render/ldraw-scene'
import { defaultLdrawProvider } from '../lib/file-provider'
import { buildModelGeometry, emptyDirect } from '../lib/geometry-builder'
import type { BuiltModel } from '../lib/geometry-builder'
import { getColorHex } from '../lib/ldraw-colors'
import { flipY } from '../lib/matrix3d'
import {
  buildSchematicGeom,
  fromAtlasDelta,
  groupPolysByPlane,
  layoutAtlas,
  orbitView,
  posKey,
  reconstructPolys,
  selectPolysForMode,
  toAtlas,
  unfoldPolys,
  VIEW_PRESETS,
  viewLabel,
} from '../lib/schematic'
import type { NetFace, PlacedPlane, SchematicGeom, SchematicMode, SchematicPoly, ScPt } from '../lib/schematic'

type Scope = 'file' | 'complete'
/** How far an edit ripples: whole shared vertex vs. the single face grabbed. */
type ConnectMode = 'connected' | 'disconnected'
type ToolMode = 'move' | 'orbit'

/** One editable vertex reference `(source line, corner index)` + its weld key. */
interface DragRef {
  line: number
  index: number
  key: string
}

interface Handle {
  x: number
  y: number
  /** Welded vertex key (editable geometry only). */
  key: string
  /** Index into the current atlas `placed` planes. */
  group: number
  /** Owning editable surface & corner (used for disconnected edits). */
  line: number
  corner: number
  selected: boolean
}

interface DragState {
  kind: 'vert' | 'poly' | 'pan' | 'orbit'
  /** The exact source refs this drag will move (resolved at press time). */
  refs: DragRef[]
  /** Original (committed) scene position per weld key. */
  orig: Map<string, ScPt>
  group: number
  pressX: number
  pressY: number
  pointerId: number
  moved: boolean
}

interface CanvasState {
  geom: SchematicGeom | null
  /** Sub-file surfaces (per referenced part) for the papercraft nets. */
  contextParts: Array<{ name: string; polys: SchematicPoly[] }>
  fileName: string
  /** Consumed on next draw to re-fit the view. */
  refitKey: string
  /** Atlas transform: (x,y) = atlas centre in LDU, scale = px per LDU. */
  cx: number
  cy: number
  scale: number
  overrides: Map<string, ScPt>
  selectedKeys: Set<string>
  /** Weld keys explicitly "disconnected" (black/yellow) — drag only the grabbed face. */
  detached: Set<string>
  hoverHandle: number | null
  hoverPoly: number | null
  drag: DragState | null
  /** Cached per-draw results used by hit tests / drags. */
  placed: PlacedPlane[]
  handles: Handle[]
  allPolys: SchematicPoly[]
  editableCount: number
}

const COLOR_UNSELECTED = '#ffd400'
const COLOR_SELECTED = '#ff5722'
const HIT_RADIUS_PX = 8

function makeCanvasState(): CanvasState {
  return {
    geom: null,
    contextParts: [],
    fileName: '',
    refitKey: 'first',
    cx: 0,
    cy: 0,
    scale: 1,
    overrides: new Map(),
    selectedKeys: new Set(),
    detached: new Set(),
    hoverHandle: null,
    hoverPoly: null,
    drag: null,
    placed: [],
    handles: [],
    allPolys: [],
    editableCount: 0,
  }
}

function hexCss(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`
}

const sameView = (a: ScPt, b: ScPt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-6

/**
 * The 2D schematic companion: an overlay window at the bottom-right of the
 * viewport. Modes:
 *  - Full: every surface of the part laid out at true shape, separated.
 *  - Side: only the surfaces facing the chosen side (including ones rotated up
 *    to being another side).
 *  - Plane: only the surfaces that face the viewer head-on.
 * The scope toggle adds the whole rendered part (sub-file geometry as context)
 * vs. only the active file's own editable surfaces. An orientation selector
 * (axis presets + free orbit) picks the side to look from.
 */
export function SchematicPane({ getScene }: { getScene: () => LDrawScene | null }) {
  const open = useEditorStore((s) => s.schematicOpen)
  const setOpen = useEditorStore((s) => s.setSchematicOpen)
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const document = useEditorStore((s) => s.document)
  const activeFileName = useEditorStore((s) => s.fileNames[s.activeFileIndex] ?? '')
  const libraryRevision = useEditorStore((s) => s.library.revision)
  const selectedVertices = useEditorStore((s) => s.selectedVertices)
  const settings = useEditorStore((s) => s.settings)

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const S = useRef<CanvasState>(makeCanvasState())

  const [version, setVersion] = useState(0)
  const paint = useCallback(() => setVersion((v) => v + 1), [])
  const [geomRev, setGeomRev] = useState(0)

  const [mode, setMode] = useState<SchematicMode>('full')
  const [scope, setScope] = useState<Scope>('file')
  const [connectMode, setConnectMode] = useState<ConnectMode>('connected')
  const [toolMode, setToolMode] = useState<ToolMode>('move')
  const [view, setView] = useState<ScPt>({ x: 0, y: 0, z: 1 })
  const [frameGeo, setFrameGeo] = useState({ docked: true, x: 0, y: 0, w: 460, h: 360 })
  const [coordText, setCoordText] = useState<{ x: string; y: string; z: string } | null>(null)

  /** Change a view-affecting control and ask for a refit on next draw. */
  const changeMode = (m: SchematicMode) => {
    setMode(m)
    S.current.refitKey = 'mode'
    paint()
  }
  const changeScope = (sc: Scope) => {
    setScope(sc)
    S.current.refitKey = 'scope'
    paint()
  }
  const changeView = (v: ScPt) => {
    setView(v)
    S.current.refitKey = 'view'
    paint()
  }

  /* ------------------------------ geometry ------------------------------ */

  useEffect(() => {
    if (!activeFileName) {
      S.current.geom = buildSchematicGeom(emptyDirect())
      S.current.contextParts = []
      S.current.fileName = ''
      S.current.refitKey = 'file'
      setGeomRev((r) => r + 1)
      paint()
      return
    }
    let cancelled = false
    buildModelGeometry(document, defaultLdrawProvider, activeFileName, {}).then((built) => {
      if (cancelled) return
      const firstForFile = S.current.geom === null || S.current.fileName !== activeFileName
      S.current.geom = buildSchematicGeom(built.direct)
      S.current.fileName = activeFileName
      // Context = each referenced sub-file's own surfaces (they are displayed
      // as unfolded papercraft nets in Complete scope).
      S.current.contextParts = collectContextParts(built)
      if (firstForFile) S.current.refitKey = 'file'
      setGeomRev((r) => r + 1)
      paint()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, activeFileName, libraryRevision])

  // Sync selection from the store (re-runs when geometry rebuilds).
  useEffect(() => {
    const geom = S.current.geom
    const keys = new Set<string>()
    if (geom) {
      for (const ref of selectedVertices as VertexSelection[]) {
        const k = geom.refToKey.get(`${ref.lineNumber}:${ref.vertexIndex}`)
        if (k) keys.add(k)
      }
    }
    S.current.selectedKeys = keys
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVertices, geomRev])

  useEffect(() => {
    if (open) {
      S.current.refitKey = 'open'
      paint()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, open])

  // Wheel = zoom about the cursor.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !open) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = S.current
      if (!s.geom || s.geom.empty) return
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(rect.width, 1)
      const h = Math.max(rect.height, 1)
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.min(Math.max(s.scale * factor, 0.005), 200)
      if (next === s.scale) return
      const ax = s.cx + (x - w / 2) / s.scale
      const ay = s.cy + (y - h / 2) / s.scale
      s.scale = next
      s.cx = ax - (x - w / 2) / s.scale
      s.cy = ay - (y - h / 2) / s.scale
      paint()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paint])

  /* ----------------------------- drawing ----------------------------- */

  function draw(): void {
    const canvas = canvasRef.current
    if (!canvas || !open) return
    const s = S.current
    const geom = s.geom
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(rect.width, 1)
    const h = Math.max(rect.height, 1)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#191b1f'
    ctx.fillRect(0, 0, w, h)

    if (!geom) {
      drawMessage(ctx, w, h, 'Loading…')
      return
    }

    // The active file's own surfaces are the editable set and are drawn as the
    // separated "atlas". Sub-file context (Complete) is unfolded below it as
    // connected papercraft nets.
    const editable = geom.polys
    s.allPolys = editable
    s.editableCount = editable.length

    // Papercraft nets for every referenced sub-file (Complete). Computed before
    // the atlas so an assembly file (no own surfaces) can still show its
    // referenced sub-files as unfolded nets.
    const nets: Array<{ faces: NetFace[]; width: number; height: number; colors: number[] }> = []
    let bandRowW = 0
    let bandRowH = 0
    if (scope === 'complete') {
      for (const part of s.contextParts) {
        const net = unfoldPolys(part.polys)
        if (net.faces.length === 0) continue
        nets.push({ faces: net.faces, width: net.width, height: net.height, colors: part.polys.map((p) => p.colorCode) })
        bandRowW += net.width
        bandRowH = Math.max(bandRowH, net.height)
      }
      if (nets.length > 0) bandRowW += 24 * (nets.length - 1)
    }

    // The active file's own surfaces are the editable "atlas". Its layout may
    // be empty (an assembly with no geometry of its own), in which case only
    // the nets are drawn.
    const chosen = new Set(selectPolysForMode(editable, mode, view))
    const groups = groupPolysByPlane(editable).filter((g) => g.polyIndices.some((i) => chosen.has(i)))
    if (editable.length === 0 && nets.length === 0) {
      drawMessage(ctx, w, h, `No geometry in "${s.fileName || activeFileName}".\nOpen a sub-part (✎) to edit it here.`)
      return
    }
    if (editable.length > 0 && groups.length === 0 && nets.length === 0) {
      drawMessage(ctx, w, h, 'No surfaces shown from this direction.\nOrbit (Shift+drag / Orbit tool) or pick a side/plane.')
      return
    }
    const layout = layoutAtlas(editable, groups, 16)
    s.placed = layout.placed

    const bandGap = 26
    const bandTop = layout.height + bandGap
    const totalW = Math.max(layout.width, bandRowW)
    const totalH = nets.length > 0 ? bandTop + bandRowH : layout.height

    // Re-fit on request (includes the net band in Complete).
    if (s.refitKey) {
      s.refitKey = ''
      const pad = 18
      const scale = Math.min((w - pad * 2) / Math.max(totalW, 1), (h - pad * 2) / Math.max(totalH, 1))
      s.scale = Math.min(Math.max(scale, 0.005), 200)
      s.cx = totalW / 2
      s.cy = totalH / 2
    }

    const toScreen = (x: number, y: number) => ({ x: (x - s.cx) * s.scale + w / 2, y: (y - s.cy) * s.scale + h / 2 })

    drawGrid(ctx, s, w, h)

    const polyGroup = new Int32Array(editable.length).fill(-1)
    layout.placed.forEach((p, gi) => p.group.polyIndices.forEach((i) => (polyGroup[i] = gi)))

    // Editable surfaces.
    for (let i = 0; i < editable.length; i++) {
      const gi = polyGroup[i]
      if (gi < 0 || !chosen.has(i)) continue
      const poly = editable[i]
      const path = polyScreenPath(poly, layout.placed[gi], toScreen)
      ctx.beginPath()
      ctx.moveTo(path[0].x, path[0].y)
      for (let k = 1; k < path.length; k++) ctx.lineTo(path[k].x, path[k].y)
      ctx.closePath()
      ctx.fillStyle = hexCss(getColorHex(poly.colorCode))
      ctx.globalAlpha = mode === 'plane' ? 0.85 : 0.45
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.1
      ctx.strokeStyle = 'rgba(240,244,252,0.75)'
      ctx.stroke()
    }

    // Hovered surface highlight (editable only).
    if (s.hoverPoly !== null && s.hoverPoly < editable.length) {
      const gi = polyGroup[s.hoverPoly]
      if (gi >= 0) {
        const path = polyScreenPath(editable[s.hoverPoly], layout.placed[gi], toScreen)
        ctx.beginPath()
        ctx.moveTo(path[0].x, path[0].y)
        for (let k = 1; k < path.length; k++) ctx.lineTo(path[k].x, path[k].y)
        ctx.closePath()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#ffe08a'
        ctx.stroke()
      }
    }

    // Handles for the editable surfaces (one per weld key within a plane tile,
    // carrying the owning surface+corner so disconnected edits know the source).
    const handles: Handle[] = []
    const handleMap = new Map<string, Handle>()
    for (let gi = 0; gi < layout.placed.length; gi++) {
      const pl = layout.placed[gi]
      for (const i of pl.group.polyIndices) {
        if (!chosen.has(i)) continue
        const poly = editable[i]
        for (let c = 0; c < poly.verts.length; c++) {
          const key = posKey(poly.verts[c])
          const id = `${gi}:${key}`
          let h = handleMap.get(id)
          if (!h) {
            const a = toAtlas(s.overrides.get(`${poly.line}:${c}`) ?? poly.verts[c], pl)
            const scr = toScreen(a.x, a.y)
            h = { x: scr.x, y: scr.y, key, group: gi, line: poly.line, corner: c, selected: s.selectedKeys.has(key) }
            handles.push(h)
            handleMap.set(id, h)
          }
        }
      }
    }
    s.handles = handles
    drawHandles(ctx, s)

    // Sub-file papercraft nets (Complete) below the atlas.
    if (nets.length > 0) {
      let nx = 0
      for (const net of nets) {
        for (const face of net.faces) {
          const colorCode = net.colors[face.polyIndex] ?? 16
          const path = face.pts.map((p) => toScreen(p.x + nx, p.y + bandTop))
          ctx.beginPath()
          ctx.moveTo(path[0].x, path[0].y)
          for (let k = 1; k < path.length; k++) ctx.lineTo(path[k].x, path[k].y)
          ctx.closePath()
          ctx.fillStyle = hexCss(getColorHex(colorCode))
          ctx.globalAlpha = 0.22
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.lineWidth = 1
          ctx.strokeStyle = 'rgba(205,212,224,0.5)'
          ctx.stroke()
        }
        nx += net.width + 24
      }
    }
  }

  function polyScreenPath(poly: SchematicPoly, pl: PlacedPlane, toScreen: (x: number, y: number) => { x: number; y: number }): Array<{ x: number; y: number }> {
    const s = S.current
    return poly.verts.map((p, c) => {
      const a = toAtlas(s.overrides.get(`${poly.line}:${c}`) ?? p, pl)
      return toScreen(a.x, a.y)
    })
  }

  /* --------------------------- pointer events --------------------------- */

  function canvasRect(): { x: number; y: number; w: number; h: number } {
    const canvas = canvasRef.current
    const r = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 }
    return { x: r.left, y: r.top, w: Math.max(r.width, 1), h: Math.max(r.height, 1) }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    const s = S.current
    const rect = canvasRect()
    const x = e.clientX - rect.x
    const y = e.clientY - rect.y

    // Right-click a vertex toggles its individual Disconnect (black/yellow).
    if (e.button === 2) {
      const hh = hitHandle(s, x, y)
      if (hh !== null) {
        const key = s.handles[hh].key
        if (s.detached.has(key)) s.detached.delete(key)
        else s.detached.add(key)
        paint()
        return
      }
      beginPan(e, x, y)
      return
    }
    if (e.button === 1) {
      beginPan(e, x, y)
      return
    }
    if (e.button !== 0) return
    if (s.drag) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setCoordText(null)

    const handleHit = hitHandle(s, x, y)
    if (handleHit !== null) {
      if (tool !== 'vertex') setTool('vertex')
      const handle = s.handles[handleHit]
      if (e.ctrlKey || e.metaKey) {
        if (s.selectedKeys.has(handle.key)) s.selectedKeys.delete(handle.key)
        else s.selectedKeys.add(handle.key)
        pushSelectionToStore(s)
        paint()
        return
      }
      if (s.selectedKeys.size !== 1 || !s.selectedKeys.has(handle.key)) {
        s.selectedKeys = new Set([handle.key])
        pushSelectionToStore(s)
      }
      beginHandleDrag(e, handle, x, y)
      paint()
      return
    }

    // Clicking an editable polygon selects its corners (and can drag it).
    const polyHit = hitPoly(s, x, y, rect.w, rect.h)
    if (polyHit !== null && polyHit < s.editableCount && toolMode === 'move') {
      if (tool !== 'vertex') setTool('vertex')
      const poly = s.allPolys[polyHit]
      const keys = poly.verts.map((p) => posKey(p))
      s.selectedKeys = new Set(keys)
      pushSelectionToStore(s)
      const gi = groupOfPoly(s, polyHit)
      beginPolyDrag(e, polyHit, gi >= 0 ? gi : 0, x, y)
      paint()
      return
    }

    // Empty space.
    s.selectedKeys = new Set()
    pushSelectionToStore(s)
    if (e.shiftKey || toolMode === 'orbit') beginOrbit(e, x, y)
    else beginPan(e, x, y)
    paint()
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    const s = S.current
    const rect = canvasRect()
    const x = e.clientX - rect.x
    const y = e.clientY - rect.y

    if (s.drag) {
      if (e.pointerId !== s.drag.pointerId) return
      if (s.drag.kind === 'pan') {
        const dx = x - s.drag.pressX
        const dy = y - s.drag.pressY
        s.cx -= dx / s.scale
        s.cy -= dy / s.scale
        s.drag.pressX = x
        s.drag.pressY = y
        if (Math.abs(dx) + Math.abs(dy) > 2) s.drag.moved = true
        paint()
        return
      }
      if (s.drag.kind === 'orbit') {
        const dx = x - s.drag.pressX
        const dy = y - s.drag.pressY
        s.drag.pressX = x
        s.drag.pressY = y
        if (Math.abs(dx) + Math.abs(dy) > 1) {
          const v = orbitView(view, dx, dy)
          setView(v)
          s.refitKey = 'orbit'
          s.drag.moved = true
          paint()
        }
        return
      }
      const dx = x - s.drag.pressX
      const dy = y - s.drag.pressY
      let du = dx / s.scale
      let dvUp = -dy / s.scale
      if (settings.moveSnap) {
        const inc = Math.max(settings.moveIncrement || 1, 0.05)
        du = Math.round(du / inc) * inc
        dvUp = Math.round(dvUp / inc) * inc
      }
      const placed = s.placed[s.drag.group]
      if (!placed) return
      const delta = fromAtlasDelta(placed, du, dvUp)
      const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
      s.overrides.clear()
      for (const ref of s.drag.refs) {
        const o = s.drag.orig.get(ref.key)
        if (!o) continue
        const np = { x: o.x + delta.x, y: o.y + delta.y, z: o.z + delta.z }
        s.overrides.set(`${ref.line}:${ref.index}`, np)
        entries.push({ lineNumber: ref.line, vertexIndex: ref.index, position: flipY(np) })
      }
      if (Math.abs(du) + Math.abs(dvUp) > 0.001) s.drag.moved = true
      getScene()?.previewVertexMoves(entries)
      useEditorStore.getState().previewVertices(entries)
      paint()
      return
    }

    const prevH = s.hoverHandle
    const prevP = s.hoverPoly
    s.hoverHandle = hitHandle(s, x, y)
    s.hoverPoly = hitPoly(s, x, y, rect.w, rect.h)
    if (prevH !== s.hoverHandle || prevP !== s.hoverPoly) paint()
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const s = S.current
    const drag = s.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    s.drag = null
    if (drag.kind === 'pan' || drag.kind === 'orbit') {
      paint()
      return
    }
    if (drag.moved) {
      const entries: Array<{ lineNumber: number; vertexIndex: number; position: Vec3 }> = []
      for (const ref of drag.refs) {
        const np = s.overrides.get(`${ref.line}:${ref.index}`)
        if (!np) continue
        entries.push({ lineNumber: ref.line, vertexIndex: ref.index, position: flipY(np) })
      }
      if (entries.length > 0) useEditorStore.getState().moveVertices(entries)
    } else {
      useEditorStore.getState().clearPreview()
    }
    s.overrides.clear()
    paint()
  }

  function beginPan(e: React.PointerEvent<HTMLCanvasElement>, x?: number, y?: number): void {
    const rect = canvasRect()
    const px = x ?? e.clientX - rect.x
    const py = y ?? e.clientY - rect.y
    S.current.drag = { kind: 'pan', refs: [], orig: new Map(), group: 0, pressX: px, pressY: py, pointerId: e.pointerId, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function beginOrbit(e: React.PointerEvent<HTMLCanvasElement>, x: number, y: number): void {
    S.current.drag = { kind: 'orbit', refs: [], orig: new Map(), group: 0, pressX: x, pressY: y, pointerId: e.pointerId, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  /** Resolve the source refs affected when grabbing `handle`'s vertex. */
  function resolveHandleRefs(s: CanvasState, handle: Handle): DragRef[] {
    const geom = s.geom
    const out: DragRef[] = []
    const seen = new Set<string>()
    const add = (line: number, index: number, key: string) => {
      const id = `${line}:${index}`
      if (seen.has(id)) return
      seen.add(id)
      out.push({ line, index, key })
    }
    const detach = connectMode === 'disconnected' || s.detached.has(handle.key)
    if (detach) {
      add(handle.line, handle.corner, handle.key)
    } else {
      const vertex = geom?.weld.get(handle.key)
      if (vertex) for (const ref of vertex.refs) add(ref.lineNumber, ref.vertexIndex, handle.key)
    }
    return out
  }

  /** Resolve the source refs affected when dragging an entire polygon. */
  function resolvePolyRefs(s: CanvasState, polyIndex: number): DragRef[] {
    const geom = s.geom
    const poly = s.allPolys[polyIndex]
    const out: DragRef[] = []
    const seen = new Set<string>()
    const add = (line: number, index: number, key: string) => {
      const id = `${line}:${index}`
      if (seen.has(id)) return
      seen.add(id)
      out.push({ line, index, key })
    }
    poly.verts.forEach((p, c) => {
      const key = posKey(p)
      const detach = connectMode === 'disconnected' || s.detached.has(key)
      if (detach) {
        add(poly.line, c, key)
      } else {
        const vertex = geom?.weld.get(key)
        if (vertex) for (const ref of vertex.refs) add(ref.lineNumber, ref.vertexIndex, key)
      }
    })
    return out
  }

  function beginDragWith(e: React.PointerEvent<HTMLCanvasElement>, kind: DragState['kind'], refs: DragRef[], group: number, x: number, y: number): void {
    const geom = S.current.geom
    const orig = new Map<string, ScPt>()
    for (const ref of refs) {
      if (!orig.has(ref.key)) {
        const v = geom?.weld.get(ref.key)
        if (v) orig.set(ref.key, v.pos)
      }
    }
    S.current.drag = { kind, refs, orig, group, pressX: x, pressY: y, pointerId: e.pointerId, moved: false }
    S.current.overrides.clear()
  }

  function beginHandleDrag(e: React.PointerEvent<HTMLCanvasElement>, handle: Handle, x: number, y: number): void {
    beginDragWith(e, 'vert', resolveHandleRefs(S.current, handle), handle.group, x, y)
  }

  function beginPolyDrag(e: React.PointerEvent<HTMLCanvasElement>, polyIndex: number, group: number, x: number, y: number): void {
    beginDragWith(e, 'poly', resolvePolyRefs(S.current, polyIndex), group, x, y)
  }

  function groupOfPoly(s: CanvasState, polyIndex: number): number {
    const target = s.allPolys[polyIndex]
    const idx = s.allPolys.indexOf(target)
    if (idx < 0) return -1
    for (let gi = 0; gi < s.placed.length; gi++) {
      if (s.placed[gi].group.polyIndices.includes(idx)) return gi
    }
    return -1
  }

  function hitHandle(s: CanvasState, x: number, y: number): number | null {
    let best: number | null = null
    let bestDist = HIT_RADIUS_PX
    for (let i = 0; i < s.handles.length; i++) {
      const hd = s.handles[i]
      const d = Math.hypot(hd.x - x, hd.y - y)
      if (d <= bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  function hitPoly(s: CanvasState, x: number, y: number, w: number, h: number): number | null {
    const toWorld = (sx: number, sy: number) => ({ x: s.cx + (sx - w / 2) / s.scale, y: s.cy + (sy - h / 2) / s.scale })
    const ax = toWorld(x, y)
    for (let i = 0; i < s.editableCount; i++) {
      const gi = groupOfPoly(s, i)
      if (gi < 0) continue
      const pl = s.placed[gi]
      const pts = s.allPolys[i].verts.map((p) => {
        const a = toAtlas(p, pl)
        return { x: a.x, y: a.y }
      })
      if (pointIn(pts, ax.x, ax.y)) return i
    }
    return null
  }

  function pushSelectionToStore(s: CanvasState): void {
    const refs: VertexSelection[] = []
    const geom = s.geom
    if (geom) {
      for (const key of s.selectedKeys) {
        const vertex = geom.weld.get(key)
        if (!vertex) continue
        for (const ref of vertex.refs) refs.push({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex })
      }
    }
    useEditorStore.getState().selectVertices(refs)
  }

  /* ------------------------------ chrome ------------------------------ */

  function coordFields(): React.ReactNode {
    const s = S.current
    const geom = s.geom
    if (!geom) return null
    const keys = [...s.selectedKeys]
    // Direct value inputs only make sense for exactly one welded vertex.
    if (keys.length !== 1) return null
    const vertex = geom.weld.get(keys[0])
    if (!vertex) return null
    const cur = { x: vertex.pos.x, y: vertex.pos.y === 0 ? 0 : -vertex.pos.y, z: vertex.pos.z }
    const fallback = { x: String(cur.x), y: String(cur.y), z: String(cur.z) }
    const value = coordText ?? fallback
    const commit = (axis: 'x' | 'y' | 'z') => {
      const num = Number(coordText?.[axis] ?? cur[axis])
      setCoordText(null)
      if (!Number.isFinite(num)) return
      const next: Vec3 = { x: cur.x, y: cur.y, z: cur.z }
      next[axis] = num
      const entries = vertex.refs.map((ref) => ({ lineNumber: ref.lineNumber, vertexIndex: ref.vertexIndex, position: next }))
      useEditorStore.getState().moveVertices(entries)
    }
    return (
      <div className="schematic-coords">
        {(
          [
            ['X', 'x', '#f48771'],
            ['Y', 'y', '#9fd36a'],
            ['Z', 'z', '#6ab7ff'],
          ] as Array<[string, 'x' | 'y' | 'z', string]>
        ).map(([label, axis, color]) => (
          <label key={axis} className="schematic-coord" style={{ color }}>
            {label}
            <input
              type="number"
              step="any"
              value={value[axis]}
              onChange={(e) => setCoordText({ ...(coordText ?? fallback), [axis]: e.target.value })}
              onBlur={() => commit(axis)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </label>
        ))}
        <span className="schematic-coords-hint">LDraw · ↵ applies</span>
      </div>
    )
  }

  function fitView(): void {
    const s = S.current
    if (!s.geom || s.geom.empty) return
    s.refitKey = 'fit'
    paint()
  }

  /* ------------------------------- JSX ------------------------------- */

  if (!open) {
    return (
      <button className="schematic-open-btn" title="Open the 2D blueprint view" onClick={() => setOpen(true)}>
        <span aria-hidden>◨</span> Blueprint
      </button>
    )
  }

  return (
    <div
      ref={frameRef}
      className="schematic-frame"
      style={
        frameGeo.docked
          ? { right: 14, bottom: 14, width: frameGeo.w, height: frameGeo.h }
          : { left: frameGeo.x, top: frameGeo.y, width: frameGeo.w, height: frameGeo.h }
      }
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        className="schematic-titlebar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          const startX = e.clientX
          const startY = e.clientY
          const parent = frameRef.current?.parentElement
          const rect = frameRef.current?.getBoundingClientRect()
          const prect = parent?.getBoundingClientRect()
          const g = frameGeo
          const baseX = g.docked && prect && rect ? rect.left - prect.left : g.x
          const baseY = g.docked && prect && rect ? rect.top - prect.top : g.y
          const move = (ev: PointerEvent) =>
            setFrameGeo({ docked: false, x: Math.max(0, baseX + (ev.clientX - startX)), y: Math.max(0, baseY + (ev.clientY - startY)), w: g.w, h: g.h })
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <span className="schematic-title-icon" aria-hidden>
          ◨
        </span>
        <span className="schematic-title" title={activeFileName}>
          Blueprint{activeFileName ? ` · ${activeFileName}` : ''}
        </span>
        <span className="schematic-title-spacer" />
        <button className="schematic-icon-btn" title="Fit blueprint" onClick={fitView}>
          ⛶
        </button>
        <button className="schematic-icon-btn" title="Close blueprint" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="schematic-toolbar">
        <div className="schematic-seg" role="group" aria-label="Schematic mode">
          {(
            [
              ['full', 'Full'],
              ['side', 'Side'],
              ['plane', 'Plane'],
            ] as Array<[SchematicMode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              className={`schematic-seg-btn${mode === m ? ' active' : ''}`}
              title={
                m === 'full'
                  ? 'Full: every surface of the part, laid out at true shape (unfolded & separated)'
                  : m === 'side'
                    ? 'Side: surfaces facing the chosen side, including ones rotated up to being another side'
                    : 'Plane: only surfaces facing the viewer head-on'
              }
              onClick={() => changeMode(m)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="schematic-seg" role="group" aria-label="Geometry scope">
          {(
            [
              ['file', 'File'],
              ['complete', 'Complete'],
            ] as Array<[Scope, string]>
          ).map(([sc, label]) => (
            <button
              key={sc}
              className={`schematic-seg-btn${scope === sc ? ' active' : ''}`}
              title={
                sc === 'file'
                  ? 'Only the active file\u2019s own surfaces'
                  : 'The whole rendered part \u2014 sub-file geometry included (context)'
              }
              onClick={() => changeScope(sc)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="schematic-seg" role="group" aria-label="Schematic tool">
          <button
            className={`schematic-seg-btn${toolMode === 'move' ? ' active' : ''}`}
            title="Select & drag vertices / surfaces"
            onClick={() => setToolMode('move')}
          >
            Move
          </button>
          <button
            className={`schematic-seg-btn${toolMode === 'orbit' ? ' active' : ''}`}
            title="Drag to orbit the schematic orientation (Side/Plane)"
            onClick={() => setToolMode('orbit')}
          >
            Orbit
          </button>
        </div>

        <div className="schematic-seg" role="group" aria-label="Vertex connectivity">
          <button
            className={`schematic-seg-btn${connectMode === 'connected' ? ' active' : ''}`}
            title="Connected: moving a vertex also moves every quad / tri / line that shares it"
            onClick={() => setConnectMode('connected')}
          >
            Connected
          </button>
          <button
            className={`schematic-seg-btn${connectMode === 'disconnected' ? ' active' : ''}`}
            title="Disconnected: moving a vertex only edits the single face you grab (it detaches from the rest)"
            onClick={() => setConnectMode('disconnected')}
          >
            Disconnected
          </button>
        </div>

        <div className="schematic-seg" role="group" aria-label="Side / plane selector">
          {VIEW_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`schematic-seg-btn${sameView(view, p.view) ? ' active' : ''}`}
              title={`Look from ${p.label}`}
              onClick={() => changeView({ ...p.view })}
            >
              {viewLabel(p.view)}
            </button>
          ))}
        </div>

        <span className="schematic-toolbar-spacer" />
        <span className="schematic-hint">
          {connectMode} · {mode} · look {viewLabel(view)} · right-click vertex = disconnect · right-drag = pan · wheel = zoom
        </span>
      </div>

      <div className="schematic-canvas-host">
        <canvas
          ref={canvasRef}
          className="schematic-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (!S.current.drag) {
              S.current.hoverHandle = null
              S.current.hoverPoly = null
              paint()
            }
          }}
        />
        {coordFields()}
      </div>

      <div
        className="schematic-resize"
        title="Resize"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const g = frameGeo
          const parent = frameRef.current?.parentElement
          const maxW = parent ? parent.clientWidth - 20 : 900
          const maxH = parent ? parent.clientHeight - 30 : 700
          const move = (ev: PointerEvent) =>
            setFrameGeo({
              docked: g.docked,
              x: g.x,
              y: g.y,
              w: Math.min(Math.max(g.w + (ev.clientX - startX), 300), maxW),
              h: Math.min(Math.max(g.h + (ev.clientY - startY), 200), maxH),
            })
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
    </div>
  )
}

/* ------------------------ module-level draw helpers ------------------------ */

function collectContextParts(built: BuiltModel): Array<{ name: string; polys: SchematicPoly[] }> {
  const out: Array<{ name: string; polys: SchematicPoly[] }> = []
  const walk = (parts: BuiltModel['parts']) => {
    for (const part of parts) {
      const polys = reconstructPolys(part.direct)
      if (polys.length > 0) out.push({ name: part.file, polys })
      if (part.parts.length > 0) walk(part.parts)
    }
  }
  walk(built.parts)
  return out
}

function pointIn(pts: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function drawMessage(ctx: CanvasRenderingContext2D, w: number, h: number, message: string): void {
  ctx.fillStyle = '#9a9aa2'
  ctx.font = '12px Inter, system-ui, Avenir, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = message.split('\n')
  lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 18))
}

function drawGrid(ctx: CanvasRenderingContext2D, s: CanvasState, w: number, h: number): void {
  const { cx, cy, scale } = s
  const x0 = cx - w / 2 / scale
  const x1 = cx + w / 2 / scale
  const y0 = cy - h / 2 / scale
  const y1 = cy + h / 2 / scale
  const raw = 36 / Math.max(scale, 1e-9)
  const exp = Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const base = Math.pow(10, exp)
  let step = base * 10
  for (const m of [1, 2, 5, 10]) {
    if (base * m >= raw) {
      step = base * m
      break
    }
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.beginPath()
  for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) {
    const sx = (gx - cx) * scale + w / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, h)
  }
  for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) {
    const sy = (gy - cy) * scale + h / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(w, sy)
  }
  ctx.stroke()
}

function drawHandles(ctx: CanvasRenderingContext2D, s: CanvasState): void {
  s.handles.forEach((handle, i) => {
    const hovered = s.hoverHandle === i
    const selected = handle.selected
    const detached = s.detached.has(handle.key)
    const r = ((selected ? 4.6 : detached ? 4.2 : 3.6)) * (hovered ? 1.3 : 1)
    ctx.beginPath()
    ctx.arc(handle.x, handle.y, r, 0, Math.PI * 2)
    // A disconnected vertex renders black with a yellow outline.
    ctx.fillStyle = detached ? '#000000' : selected ? COLOR_SELECTED : COLOR_UNSELECTED
    ctx.fill()
    if (selected || hovered || detached) {
      ctx.lineWidth = detached ? 2 : 1
      ctx.strokeStyle = detached ? '#ffd400' : 'rgba(255,255,255,0.9)'
      ctx.stroke()
    }
  })
}
