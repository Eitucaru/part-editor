import { parseLDraw } from '../core'
import type { LDrawDocument, LDrawModel } from '../core'
import { buildModelGeometry, flattenBuiltToSceneSoup, flattenBuiltToSceneEdges, transformSoup, transformEdgeSoup } from './geometry-builder'
import { flipY, ldrawMatrixToScene } from './matrix3d'
import { soupToLdrawLines, edgeSoupToLdrawLines } from './punch'
import { fileBase, getFileNames, getModelBlock, matchFileName, toMpd } from './workspace'
import { replaceLines } from './text-edit'
import type { LDrawFileProvider } from './file-provider'

/**
 * Bake (inline) a sub-file reference into concrete LDraw lines.
 *
 * The referenced file (and everything it references) is baked to plain
 * type-3 lines, then transformed by the reference's matrix. Type-2 edge
 * lines are carried through too, so the result keeps its outlines. Returns
 * the replacement lines (faces + edges), or null if the line is not a
 * resolvable sub-file reference.
 */
export async function bakeReference(
  code: string,
  lineNumber: number,
  provider: LDrawFileProvider,
): Promise<string[] | null> {
  const { document } = parseLDraw(code)
  const model = document.models[0]
  const cmd = model?.commands.find((c) => c.lineNumber === lineNumber)
  if (!cmd || cmd.kind !== 'subfile') return null

  const base = fileBase(cmd.file)

  // Resolve the referenced file's text: workspace block first, then library.
  let rootDoc: LDrawDocument
  const wsIndex = matchFileName(getFileNames(document), base)
  if (wsIndex >= 0) {
    const wsName = getFileNames(document)[wsIndex]
    rootDoc = parseLDraw(toMpd(getModelBlock(code, wsName), wsName)).document
  } else {
    const text = await provider.load(base)
    if (!text) return null
    rootDoc = parseLDraw(toMpd(text, base)).document
  }
  const rootModel = rootDoc.models[0]
  if (!rootModel) return null

  // Build with the referenced file as root, with every workspace model
  // available for internal sub-file resolution (dedup by basename).
  const models: LDrawModel[] = [rootModel]
  for (const wsModel of document.models) {
    if (fileBase(wsModel.name) === fileBase(rootModel.name)) continue
    models.push(wsModel)
  }
  const combined: LDrawDocument = { models, isMpd: true }

  const built = await buildModelGeometry(combined, provider, rootModel.name)
  const soup = flattenBuiltToSceneSoup(built)
  const edgeSoup = flattenBuiltToSceneEdges(built)
  if (soup.positions.length === 0 && edgeSoup.positions.length === 0) return null

  const scenePos = flipY(cmd.position)
  const sceneMat = ldrawMatrixToScene(cmd.matrix)
  const transformed = transformSoup(soup, sceneMat, scenePos)
  const transformedEdges = transformEdgeSoup(edgeSoup, sceneMat, scenePos)
  const lines = [...soupToLdrawLines(transformed), ...edgeSoupToLdrawLines(transformedEdges)]
  return lines.length > 0 ? lines : null
}

/**
 * Merge (inline) a sub-file reference into its parent file.
 *
 * See `bakeReference`; this wraps it in the single-line text replacement used
 * by the store's single-part merge.
 */
export async function mergeReference(
  code: string,
  lineNumber: number,
  provider: LDrawFileProvider,
): Promise<string | null> {
  const lines = await bakeReference(code, lineNumber, provider)
  if (!lines) return null
  return replaceLines(code, lineNumber, lines)
}
