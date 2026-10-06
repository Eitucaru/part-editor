import { parseLDraw } from '../core'
import { multiplyMat3 } from '../core'
import type { LDrawDocument, LDrawModel, Mat3, Vec3 } from '../core'
import { getColorRgbLinear } from './ldraw-colors'
import { flipY, ldrawMatrixToScene } from './matrix3d'
import { isInvertNext, modelWinding } from './bfc'
import type { LDrawFileProvider } from './file-provider'

/**
 * Build a render-ready, editable representation of a parsed LDraw document.
 *
 * The result is a hierarchy of `BuiltPart` nodes:
 * - Each node's `direct` buffers hold the geometry authored directly in that
 *   file, in **local coordinates** (no transform applied) with resolved colors
 *   and per-vertex source metadata (`lineIndices` / `vertexIndices`).
 * - Each part's `position`/`matrix` is the LDraw type-1 transform; the scene
 *   applies it via a Three.js group, which is what the transform gizmo edits.
 *
 * Color 16 inherits from the parent chain (root falls back to tan).
 * Quads are split into two triangles, preserving original vertex indices.
 */

export interface DirectGeometry {
  facePositions: number[]
  faceColors: number[]
  /** LDraw color code per face vertex (16 resolved to the inherited color). */
  faceColorCodes: number[]
  /** 1-based source line number per face vertex. */
  faceLineIndices: number[]
  /** Vertex index within the source line per face vertex (0–3). */
  faceVertexIndices: number[]
  edgePositions: number[]
  edgeColors: number[]
  edgeColorCodes: number[]
  edgeLineIndices: number[]
  edgeVertexIndices: number[]
}

export interface BuiltPart {
  lineNumber: number
  file: string
  color: number
  position: Vec3
  matrix: Mat3
  direct: DirectGeometry
  parts: BuiltPart[]
}

export interface BuiltModel {
  direct: DirectGeometry
  parts: BuiltPart[]
  missingFiles: string[]
}

export interface GeometryBuildOptions {
  maxDepth?: number
  edgeColorCode?: number
}

const DEFAULT_MAX_DEPTH = 24
const DEFAULT_EDGE_COLOR = 24

export function emptyDirect(): DirectGeometry {
  return {
    facePositions: [],
    faceColors: [],
    faceColorCodes: [],
    faceLineIndices: [],
    faceVertexIndices: [],
    edgePositions: [],
    edgeColors: [],
    edgeColorCodes: [],
    edgeLineIndices: [],
    edgeVertexIndices: [],
  }
}

function normalizeName(name: string): string {
  const clean = name.replace(/\\/g, '/').toLowerCase()
  const parts = clean.split('/')
  return parts[parts.length - 1]
}

function transformVec(m: Mat3, t: Vec3 | null, p: { x: number; y: number; z: number }): Vec3 {
  if (!t) return { x: p.x, y: p.y === 0 ? 0 : -p.y, z: p.z }
  return {
    x: m.a * p.x + m.b * p.y + m.c * p.z + t.x,
    y: m.d * p.x + m.e * p.y + m.f * p.z + t.y,
    z: m.g * p.x + m.h * p.y + m.i * p.z + t.z,
  }
}

class ModelBuilder {
  direct: DirectGeometry = emptyDirect()
  parts: BuiltPart[] = []
  missing: string[] = []
  private parsedCache = new Map<string, LDrawModel | null>()
  private edgeColorCode: number
  private maxDepth: number

  constructor(
    private provider: LDrawFileProvider,
    private internal: Map<string, LDrawModel>,
    options: GeometryBuildOptions = {},
  ) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    this.edgeColorCode = options.edgeColorCode ?? DEFAULT_EDGE_COLOR
  }

  private effectiveFaceColor(code: number, inheritedColor: number): number {
    return code === 16 ? inheritedColor : code
  }

  /**
   * Apply the accumulated winding sign to a triangle's vertex order. The
   * default (+1, CCW) swaps v1/v2 to keep outward normals pointing outward
   * after the scene-space Y mirror; a negative sign (CW file, or an
   * `INVERTNEXT`-flipped sub-file) keeps the authored order instead.
   */
  private faceOrder(vertices: Array<[Vec3, number]>, sign: number): Array<[Vec3, number]> {
    return sign < 0 ? vertices : [vertices[0], vertices[2], vertices[1]]
  }

  private pushFace(vertices: Array<[Vec3, number]>, code: number, inheritedColor: number, lineNumber: number): void {
    const color = this.effectiveFaceColor(code, inheritedColor)
    const rgb = getColorRgbLinear(color)
    for (const [v, vertexIndex] of vertices) {
      this.direct.facePositions.push(v.x, v.y === 0 ? 0 : -v.y, v.z)
      this.direct.faceColors.push(rgb[0], rgb[1], rgb[2])
      this.direct.faceColorCodes.push(color)
      this.direct.faceLineIndices.push(lineNumber)
      this.direct.faceVertexIndices.push(vertexIndex)
    }
  }

  private pushEdge(vertices: Array<[Vec3, number]>, code: number, lineNumber: number): void {
    const color = code === 16 ? this.edgeColorCode : code
    const rgb = getColorRgbLinear(color)
    for (const [v, vertexIndex] of vertices) {
      this.direct.edgePositions.push(v.x, v.y === 0 ? 0 : -v.y, v.z)
      this.direct.edgeColors.push(rgb[0], rgb[1], rgb[2])
      this.direct.edgeColorCodes.push(color)
      this.direct.edgeLineIndices.push(lineNumber)
      this.direct.edgeVertexIndices.push(vertexIndex)
    }
  }

  private async resolve(name: string): Promise<LDrawModel | null> {
    const key = normalizeName(name)
    const internalModel = this.internal.get(key)
    if (internalModel) return internalModel

    const cached = this.parsedCache.get(key)
    if (cached !== undefined) return cached

    const text = await this.provider.load(name)
    if (!text) {
      this.parsedCache.set(key, null)
      return null
    }

    const { document } = parseLDraw(text)
    const model = document.models[0] ?? null
    if (model && !model.name) model.name = name
    this.parsedCache.set(key, model)
    return model
  }

  async build(
    model: LDrawModel,
    inheritedColor: number,
    depth: number,
    active: Set<string>,
    windingSign = 1,
  ): Promise<void> {
    if (depth > this.maxDepth) return

    const key = model.name ? normalizeName(model.name) : ''
    if (key) {
      if (active.has(key)) return
      active.add(key)
    }

    // A `0 BFC CERTIFY CW` file reverses its winding relative to the CCW norm.
    const localSign = windingSign * (modelWinding(model) === 'cw' ? -1 : 1)

    let invertNext = false

    for (const cmd of model.commands) {
      switch (cmd.kind) {
        case 'comment':
          if (isInvertNext(cmd)) invertNext = true
          break
        case 'raw':
          break

        case 'subfile': {
          const effectiveColor = this.effectiveFaceColor(cmd.color, inheritedColor)
          const childWindingSign = localSign * (invertNext ? -1 : 1)
          invertNext = false
          const child = await this.resolve(cmd.file)
          if (!child) {
            this.missing.push(cmd.file)
            break
          }
          const childBuilder = new ModelBuilder(this.provider, this.internal, {
            maxDepth: this.maxDepth,
            edgeColorCode: this.edgeColorCode,
          })
          await childBuilder.build(child, effectiveColor, depth + 1, active, childWindingSign)
          this.missing.push(...childBuilder.missing)
          this.parts.push({
            lineNumber: cmd.lineNumber,
            file: cmd.file,
            color: cmd.color,
            position: flipY(cmd.position),
            matrix: ldrawMatrixToScene(cmd.matrix),
            direct: childBuilder.direct,
            parts: childBuilder.parts,
          })
          break
        }

        case 'line':
          invertNext = false
          this.pushEdge(
            [
              [cmd.from, 0],
              [cmd.to, 1],
            ],
            cmd.color,
            cmd.lineNumber,
          )
          break

        case 'optional-line':
          invertNext = false
          this.pushEdge(
            [
              [cmd.vertices[0], 0],
              [cmd.vertices[1], 1],
            ],
            cmd.color,
            cmd.lineNumber,
          )
          break

        case 'triangle':
          invertNext = false
          this.pushFace(
            this.faceOrder(
              [
                [cmd.vertices[0], 0],
                [cmd.vertices[1], 1],
                [cmd.vertices[2], 2],
              ],
              localSign,
            ),
            cmd.color,
            inheritedColor,
            cmd.lineNumber,
          )
          break

        case 'quad': {
          invertNext = false
          const [a, b, c, d] = cmd.vertices
          this.pushFace(
            this.faceOrder(
              [
                [a, 0],
                [b, 1],
                [c, 2],
              ],
              localSign,
            ),
            cmd.color,
            inheritedColor,
            cmd.lineNumber,
          )
          this.pushFace(
            this.faceOrder(
              [
                [a, 0],
                [c, 2],
                [d, 3],
              ],
              localSign,
            ),
            cmd.color,
            inheritedColor,
            cmd.lineNumber,
          )
          break
        }
      }
    }

    if (key) active.delete(key)
  }
}

/** Build the editable model representation for the main model of a document. */
export async function buildDocumentGeometry(
  document: LDrawDocument,
  provider: LDrawFileProvider,
  options: GeometryBuildOptions = {},
): Promise<BuiltModel> {
  return buildModelGeometry(document, provider, undefined, options)
}

/**
 * Build a specific named model (or the first model when `rootName` is
 * omitted) as the root, with every other model in the document available for
 * internal sub-file resolution. Used to bake a referenced file (e.g. when
 * merging a part into its parent).
 */
export async function buildModelGeometry(
  document: LDrawDocument,
  provider: LDrawFileProvider,
  rootName: string | undefined,
  options: GeometryBuildOptions = {},
): Promise<BuiltModel> {
  if (document.models.length === 0) {
    return { direct: emptyDirect(), parts: [], missingFiles: [] }
  }

  const internal = new Map<string, LDrawModel>()
  for (const model of document.models) {
    if (model.name) internal.set(normalizeName(model.name), model)
  }

  const root = rootName ? document.models.find((m) => normalizeName(m.name) === normalizeName(rootName)) : undefined
  const target = root ?? document.models[0]
  if (!target) return { direct: emptyDirect(), parts: [], missingFiles: [] }

  const builder = new ModelBuilder(provider, internal, options)
  await builder.build(target, 16, 0, new Set())

  return { direct: builder.direct, parts: builder.parts, missingFiles: builder.missing }
}

/** A flat, world-space (scene-space) triangle soup with per-vertex color codes. */
export interface TriangleSoup {
  /** Scene-space positions, 3 floats per vertex (already Y-flipped). */
  positions: number[]
  /** LDraw color code per vertex (16 already resolved to the inherited color). */
  colorCodes: number[]
}

function appendSoupDirect(soup: TriangleSoup, geom: DirectGeometry): void {
  soup.positions.push(...geom.facePositions)
  soup.colorCodes.push(...geom.faceColorCodes)
}

function appendSoupPart(soup: TriangleSoup, part: BuiltPart, m: Mat3 | null, t: Vec3 | null): void {
  const mat = m === null ? part.matrix : multiplyMat3(m, part.matrix)
  const pos: Vec3 = m === null ? part.position : transformVec(m, t as Vec3, part.position)
  for (let i = 0; i < part.direct.facePositions.length; i += 3) {
    const p = transformVec(mat, pos, {
      x: part.direct.facePositions[i],
      y: part.direct.facePositions[i + 1],
      z: part.direct.facePositions[i + 2],
    })
    soup.positions.push(p.x, p.y, p.z)
  }
  soup.colorCodes.push(...part.direct.faceColorCodes)
  for (const child of part.parts) appendSoupPart(soup, child, mat, pos)
}

/**
 * Flatten a built model into a single scene-space triangle soup, carrying each
 * face's resolved color code. This is the input to the CSG boolean engine
 * (punch / erase), which needs the whole part collapsed into one consistent
 * coordinate space.
 */
export function flattenBuiltToSceneSoup(model: BuiltModel): TriangleSoup {
  const soup: TriangleSoup = { positions: [], colorCodes: [] }
  appendSoupDirect(soup, model.direct)
  for (const part of model.parts) appendSoupPart(soup, part, null, null)
  return soup
}

/** Transform a scene-space triangle soup by a scene matrix + translation. */
export function transformSoup(soup: TriangleSoup, m: Mat3, t: Vec3): TriangleSoup {
  const positions: number[] = []
  for (let i = 0; i < soup.positions.length; i += 3) {
    const p = transformVec(m, t, {
      x: soup.positions[i],
      y: soup.positions[i + 1],
      z: soup.positions[i + 2],
    })
    positions.push(p.x, p.y, p.z)
  }
  return { positions, colorCodes: [...soup.colorCodes] }
}

/** A flat, world-space (scene-space) edge list (type-2 lines) with per-vertex colors. */
export interface EdgeSoup {
  /** Scene-space positions, 3 floats per edge vertex (already Y-flipped). */
  positions: number[]
  /** LDraw color code per edge vertex (16 already resolved to the edge color). */
  colorCodes: number[]
}

function appendEdgeSoupDirect(soup: EdgeSoup, geom: DirectGeometry): void {
  soup.positions.push(...geom.edgePositions)
  soup.colorCodes.push(...geom.edgeColorCodes)
}

function appendEdgeSoupPart(soup: EdgeSoup, part: BuiltPart, m: Mat3 | null, t: Vec3 | null): void {
  const mat = m === null ? part.matrix : multiplyMat3(m, part.matrix)
  const pos: Vec3 = m === null ? part.position : transformVec(m, t as Vec3, part.position)
  for (let i = 0; i < part.direct.edgePositions.length; i += 3) {
    const p = transformVec(mat, pos, {
      x: part.direct.edgePositions[i],
      y: part.direct.edgePositions[i + 1],
      z: part.direct.edgePositions[i + 2],
    })
    soup.positions.push(p.x, p.y, p.z)
  }
  soup.colorCodes.push(...part.direct.edgeColorCodes)
  for (const child of part.parts) appendEdgeSoupPart(soup, child, mat, pos)
}

/**
 * Flatten a built model's type-2 edge lines into a single scene-space edge
 * list. Used alongside `flattenBuiltToSceneSoup` when merging a reference, so
 * the baked geometry keeps its crisp outlines instead of only faces.
 */
export function flattenBuiltToSceneEdges(model: BuiltModel): EdgeSoup {
  const soup: EdgeSoup = { positions: [], colorCodes: [] }
  appendEdgeSoupDirect(soup, model.direct)
  for (const part of model.parts) appendEdgeSoupPart(soup, part, null, null)
  return soup
}

/** Transform a scene-space edge list by a scene matrix + translation. */
export function transformEdgeSoup(soup: EdgeSoup, m: Mat3, t: Vec3): EdgeSoup {
  const positions: number[] = []
  for (let i = 0; i < soup.positions.length; i += 3) {
    const p = transformVec(m, t, {
      x: soup.positions[i],
      y: soup.positions[i + 1],
      z: soup.positions[i + 2],
    })
    positions.push(p.x, p.y, p.z)
  }
  return { positions, colorCodes: [...soup.colorCodes] }
}
