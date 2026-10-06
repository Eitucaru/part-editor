import type { LDrawCommand, LDrawDocument, LDrawModel } from './types'
import { formatNumber } from './format'
import { parseLDraw } from './parser'
import type { LDrawParseError } from './types'

/**
 * Serialization of a parsed LDraw document back to text.
 *
 * Three formatting modes are provided:
 * - `pretty`   — human-readable: 3-space group separators and blank lines
 *                inserted before comment sections (matches the original UI).
 * - `compact`  — single spaces, no inserted blank lines, 4-decimal numbers.
 * - `minified` — like `compact` but with 3-decimal numbers (smaller output).
 *
 * Formatting is deterministic and idempotent: `format(format(x)) === format(x)`.
 */

export type FormatMode = 'pretty' | 'compact' | 'minified'

export interface SerializeOptions {
  mode?: FormatMode
  /** Decimal places for numbers (pretty/compact default 4, minified default 3). */
  precision?: number
  newline?: '\n' | '\r\n'
  /** Append a trailing newline (default true). */
  finalNewline?: boolean
}

type ResolvedOptions = Required<SerializeOptions>

const DEFAULT_PRECISION: Record<FormatMode, number> = {
  pretty: 4,
  compact: 4,
  minified: 3,
}

const GROUP_SEP: Record<FormatMode, string> = {
  pretty: '   ',
  compact: ' ',
  minified: ' ',
}

function resolveOptions(options: SerializeOptions = {}): ResolvedOptions {
  const mode = options.mode ?? 'pretty'
  return {
    mode,
    precision: options.precision ?? DEFAULT_PRECISION[mode],
    newline: options.newline ?? '\n',
    finalNewline: options.finalNewline ?? true,
  }
}

function fmt(value: number, precision: number): string {
  return formatNumber(value, precision)
}

function joinNumbers(nums: number[], precision: number): string {
  return nums.map((n) => fmt(n, precision)).join(' ')
}

function serializeSubfile(cmd: Extract<LDrawCommand, { kind: 'subfile' }>, precision: number, sep: string): string {
  const { color, position, matrix, file } = cmd
  const pos = joinNumbers([position.x, position.y, position.z], precision)
  const r1 = joinNumbers([matrix.a, matrix.b, matrix.c], precision)
  const r2 = joinNumbers([matrix.d, matrix.e, matrix.f], precision)
  const r3 = joinNumbers([matrix.g, matrix.h, matrix.i], precision)
  return `1 ${color}${sep}${pos}${sep}${r1}${sep}${r2}${sep}${r3} ${file}`
}

function serializeUv(uv: number[], precision: number): string {
  return uv.map((n) => fmt(n, precision)).join(' ')
}

/** Serialize a single command to a single line of text. */
export function serializeCommand(cmd: LDrawCommand, options: SerializeOptions = {}): string {
  const { mode, precision } = resolveOptions(options)
  const sep = GROUP_SEP[mode]

  switch (cmd.kind) {
    case 'comment':
      return cmd.text === '' ? '0' : `0 ${cmd.text}`

    case 'raw':
      // Preserve unknown lines verbatim in pretty mode; normalize whitespace
      // otherwise. Raw lines are already malformed, so this is safe.
      return mode === 'pretty' ? cmd.text : cmd.text.trim().replace(/[ \t]+/g, ' ')

    case 'subfile':
      return serializeSubfile(cmd, precision, sep)

    case 'line': {
      const from = joinNumbers([cmd.from.x, cmd.from.y, cmd.from.z], precision)
      const to = joinNumbers([cmd.to.x, cmd.to.y, cmd.to.z], precision)
      return `2 ${cmd.color}${sep}${from}${sep}${to}`
    }

    case 'triangle': {
      const verts = cmd.vertices.map((v) => joinNumbers([v.x, v.y, v.z], precision)).join(sep)
      const uv = cmd.uv ? ` ${serializeUv(cmd.uv, precision)}` : ''
      return `3 ${cmd.color}${sep}${verts}${uv}`
    }

    case 'quad': {
      const verts = cmd.vertices.map((v) => joinNumbers([v.x, v.y, v.z], precision)).join(sep)
      const uv = cmd.uv ? ` ${serializeUv(cmd.uv, precision)}` : ''
      return `4 ${cmd.color}${sep}${verts}${uv}`
    }

    case 'optional-line': {
      const verts = cmd.vertices.map((v) => joinNumbers([v.x, v.y, v.z], precision)).join(sep)
      return `5 ${cmd.color}${sep}${verts}`
    }
  }
}

/** Serialize a model's commands into lines (no FILE/NOFILE wrapper). */
export function serializeModel(model: LDrawModel, options: SerializeOptions = {}): string[] {
  const opts = resolveOptions(options)
  const lines: string[] = []
  let prevWasGeometry = false

  for (const cmd of model.commands) {
    if (cmd.kind === 'comment' && opts.mode === 'pretty' && prevWasGeometry) {
      lines.push('')
    }
    lines.push(serializeCommand(cmd, opts))
    prevWasGeometry = cmd.kind !== 'comment'
  }

  return lines
}

/** Serialize a whole document (single file or MPD) to text. */
export function serializeLDraw(document: LDrawDocument, options: SerializeOptions = {}): string {
  const opts = resolveOptions(options)
  const blocks: string[] = []

  for (const model of document.models) {
    const lines: string[] = []
    if (document.isMpd && model.name !== '') {
      lines.push(`0 FILE ${model.name}`)
      lines.push(...serializeModel(model, opts))
      lines.push('0 NOFILE')
    } else {
      lines.push(...serializeModel(model, opts))
    }
    if (lines.length > 0) blocks.push(lines.join(opts.newline))
  }

  const blockSep = opts.mode === 'pretty' ? opts.newline + opts.newline : opts.newline
  const body = blocks.join(blockSep)
  return opts.finalNewline && body.length > 0 ? body + opts.newline : body
}

/** Convenience: parse and re-serialize (reformat) LDraw text. */
export function formatLDraw(text: string, options: SerializeOptions = {}): { text: string; errors: LDrawParseError[] } {
  const { document, errors } = parseLDraw(text)
  return { text: serializeLDraw(document, options), errors }
}

/** Convenience: parse and minify LDraw text. */
export function minifyLDraw(text: string, options: SerializeOptions = {}): { text: string; errors: LDrawParseError[] } {
  return formatLDraw(text, { ...options, mode: 'minified' })
}
