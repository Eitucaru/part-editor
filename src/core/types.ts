import type { Vec3, Mat3 } from './math'

/**
 * Typed abstract syntax tree (AST) for LDraw files.
 *
 * Every source line maps to exactly one command. Malformed or unrecognized
 * lines are preserved as `RawLine` so that parsing is always lossless and a
 * live editor never drops user text mid-edit.
 */

/** A type-0 line: comment or meta command. */
export interface CommentLine {
  kind: 'comment'
  /** 1-based source line number. */
  lineNumber: number
  /** Content after the leading `0` (without the leading whitespace). */
  text: string
  /** Uppercased first token of `text`, or '' when there is no content. */
  keyword: string
  /** Content after `keyword`, or ''. */
  rest: string
}

/** A type-1 line: sub-file reference. */
export interface SubfileLine {
  kind: 'subfile'
  lineNumber: number
  color: number
  position: Vec3
  matrix: Mat3
  file: string
  /** True when the matrix determinant is negative (mirrored). */
  inverted: boolean
}

/** A type-2 line: edge line between two points. */
export interface LineLine {
  kind: 'line'
  lineNumber: number
  color: number
  from: Vec3
  to: Vec3
}

/** A type-3 line: triangle. */
export interface TriangleLine {
  kind: 'triangle'
  lineNumber: number
  color: number
  vertices: [Vec3, Vec3, Vec3]
  /** Optional 6 UV values: u1 v1 u2 v2 u3 v3. */
  uv?: [number, number, number, number, number, number]
}

/** A type-4 line: quad. */
export interface QuadLine {
  kind: 'quad'
  lineNumber: number
  color: number
  vertices: [Vec3, Vec3, Vec3, Vec3]
  /** Optional 8 UV values: u1 v1 u2 v2 u3 v3 u4 v4. */
  uv?: [number, number, number, number, number, number, number, number]
}

/** A type-5 line: optional (conditional) edge line. */
export interface OptionalLineLine {
  kind: 'optional-line'
  lineNumber: number
  color: number
  vertices: [Vec3, Vec3, Vec3, Vec3]
}

/** A line that could not be classified or fully parsed. */
export interface RawLine {
  kind: 'raw'
  lineNumber: number
  /** The original, unmodified line text. */
  text: string
}

export type LDrawCommand =
  | CommentLine
  | SubfileLine
  | LineLine
  | TriangleLine
  | QuadLine
  | OptionalLineLine
  | RawLine

/** A single model (file block) inside an LDraw document. */
export interface LDrawModel {
  /** File name from `0 FILE`; empty string for the top-level/main model. */
  name: string
  commands: LDrawCommand[]
  /** First `Description:` meta, or the first plain comment line. */
  description?: string
}

/** A parsed LDraw document (a single file, or an MPD with many models). */
export interface LDrawDocument {
  models: LDrawModel[]
  /** True when the source contained `0 FILE` / `0 NOFILE` delimiters. */
  isMpd: boolean
}

export interface LDrawParseError {
  lineNumber: number
  message: string
  severity: 'warning' | 'error'
}

export interface LDrawParseResult {
  document: LDrawDocument
  errors: LDrawParseError[]
}

/* ---- Type guards ---- */

export function isComment(cmd: LDrawCommand): cmd is CommentLine {
  return cmd.kind === 'comment'
}

export function isSubfile(cmd: LDrawCommand): cmd is SubfileLine {
  return cmd.kind === 'subfile'
}

export function isGeometry(cmd: LDrawCommand): boolean {
  return (
    cmd.kind === 'subfile' ||
    cmd.kind === 'line' ||
    cmd.kind === 'triangle' ||
    cmd.kind === 'quad' ||
    cmd.kind === 'optional-line'
  )
}
