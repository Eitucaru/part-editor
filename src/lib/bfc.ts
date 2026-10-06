import { BFC } from '../core'
import type { CommentLine, LDrawModel } from '../core'

/**
 * BFC (back-face culling) metadata for an LDraw model.
 *
 * LDraw files optionally declare a winding convention with `0 BFC CERTIFY CCW`
 * (the norm) or `0 BFC CERTIFY CW`. `0 BFC NOCERTIFY` disables certification,
 * and `0 BFC INVERTNEXT` flips the winding of the immediately following
 * type-1 sub-file reference (used for cavity / cut-out geometry).
 *
 * This module is pure: it only inspects the AST and reports what the file
 * declares. The renderer turns that declaration into winding flips and
 * single/double-sided material choices.
 */

export type BfcWinding = 'ccw' | 'cw' | 'none'

/** The winding convention declared by a model's `0 BFC CERTIFY …` lines. */
export function modelWinding(model: LDrawModel): BfcWinding {
  let winding: BfcWinding = 'none'
  for (const cmd of model.commands) {
    if (cmd.kind !== 'comment' || cmd.keyword !== 'BFC') continue
    const rest = cmd.rest.trim().toUpperCase()
    if (rest.startsWith(BFC.CERTIFY)) {
      if (rest.split(/\s+/).includes(BFC.CW)) winding = 'cw'
      else if (rest.split(/\s+/).includes(BFC.CCW)) winding = 'ccw'
      else winding = 'none'
    } else if (rest.startsWith(BFC.NOCERTIFY)) {
      winding = 'none'
    }
  }
  return winding
}

/** True when a model declares `0 BFC CERTIFY` (so winding-based culling applies). */
export function modelCertified(model: LDrawModel): boolean {
  return modelWinding(model) !== 'none'
}

/** True when a type-0 command is a `0 BFC INVERTNEXT` directive. */
export function isInvertNext(cmd: CommentLine): boolean {
  if (cmd.keyword !== 'BFC') return false
  return cmd.rest.trim().toUpperCase().startsWith(BFC.INVERTNEXT)
}
