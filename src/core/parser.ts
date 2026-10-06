import type {
  CommentLine,
  LDrawCommand,
  LDrawDocument,
  LDrawModel,
  LDrawParseError,
  LDrawParseResult,
  LineLine,
  OptionalLineLine,
  QuadLine,
  RawLine,
  SubfileLine,
  TriangleLine,
} from './types'
import { isMatrixMirrored, mat3, vec3 } from './math'
import { parseColor, parseNumber } from './format'
import { extractCommentText, getLineType, getMetaKeyword, splitTokens } from './tokenizer'
import { META, NON_DESCRIPTION_KEYWORDS, isBangKeyword } from './meta'

export interface ParseOptions {
  /**
   * When true (default), malformed lines are silently preserved as `RawLine`.
   * When false, each malformed line is also reported in the result's `errors`.
   */
  tolerant?: boolean
}

interface SourceLine {
  text: string
  number: number
}

interface Block {
  name: string
  lines: SourceLine[]
}

function toSourceLines(source: string): SourceLine[] {
  return source.split(/\r\n|\r|\n/).map((text, i) => ({ text, number: i + 1 }))
}

/**
 * Split source lines into model blocks on `0 FILE` / `0 NOFILE` boundaries,
 * preserving each line's original 1-based line number.
 */
function splitBlocks(lines: SourceLine[]): { blocks: Block[]; isMpd: boolean } {
  const blocks: Block[] = []
  let currentName = ''
  let current: SourceLine[] = []
  let isMpd = false

  const flush = () => {
    if (current.length > 0 || currentName !== '') {
      blocks.push({ name: currentName, lines: current })
    }
    current = []
  }

  for (const line of lines) {
    if (line.text.trim() === '') continue

    const type = getLineType(line.text)
    if (type === 0) {
      const text = extractCommentText(line.text)
      const keyword = getMetaKeyword(text)
      if (keyword === META.FILE) {
        isMpd = true
        flush()
        currentName = text.slice(keyword.length).trim()
        continue
      }
      if (keyword === META.NOFILE) {
        isMpd = true
        flush()
        currentName = ''
        continue
      }
    }
    current.push(line)
  }
  flush()

  return { blocks, isMpd }
}

function raw(line: string, lineNumber: number): RawLine {
  return { kind: 'raw', lineNumber, text: line }
}

function parseNumbers(tokens: string[], from: number, count: number): number[] | null {
  const nums: number[] = []
  for (let i = from; i < from + count; i++) {
    const n = parseNumber(tokens[i])
    if (n === null) return null
    nums.push(n)
  }
  return nums
}

function parseSubfile(line: string, lineNumber: number): LDrawCommand {
  const tokens = splitTokens(line)
  if (tokens.length < 15) return raw(line, lineNumber)

  const color = parseColor(tokens[1])
  if (color === null) return raw(line, lineNumber)

  const nums = parseNumbers(tokens, 2, 12)
  if (nums === null) return raw(line, lineNumber)

  const file = tokens.slice(14).join(' ')
  const position = vec3(nums[0], nums[1], nums[2])
  const matrix = mat3(nums[3], nums[4], nums[5], nums[6], nums[7], nums[8], nums[9], nums[10], nums[11])

  const result: SubfileLine = {
    kind: 'subfile',
    lineNumber,
    color,
    position,
    matrix,
    file,
    inverted: isMatrixMirrored(matrix),
  }
  return result
}

function parseEdge(line: string, lineNumber: number): LDrawCommand {
  const tokens = splitTokens(line)
  if (tokens.length !== 8) return raw(line, lineNumber)

  const color = parseColor(tokens[1])
  if (color === null) return raw(line, lineNumber)

  const nums = parseNumbers(tokens, 2, 6)
  if (nums === null) return raw(line, lineNumber)

  const result: LineLine = {
    kind: 'line',
    lineNumber,
    color,
    from: vec3(nums[0], nums[1], nums[2]),
    to: vec3(nums[3], nums[4], nums[5]),
  }
  return result
}

function parseTriangle(line: string, lineNumber: number): LDrawCommand {
  const tokens = splitTokens(line)
  if (tokens.length < 11) return raw(line, lineNumber)

  const color = parseColor(tokens[1])
  if (color === null) return raw(line, lineNumber)

  const nums = parseNumbers(tokens, 2, 9)
  if (nums === null) return raw(line, lineNumber)

  const result: TriangleLine = {
    kind: 'triangle',
    lineNumber,
    color,
    vertices: [vec3(nums[0], nums[1], nums[2]), vec3(nums[3], nums[4], nums[5]), vec3(nums[6], nums[7], nums[8])],
  }

  if (tokens.length >= 17) {
    const uv = parseNumbers(tokens, 11, 6)
    if (uv !== null) result.uv = uv as TriangleLine['uv']
  }
  return result
}

function parseQuad(line: string, lineNumber: number): LDrawCommand {
  const tokens = splitTokens(line)
  if (tokens.length < 14) return raw(line, lineNumber)

  const color = parseColor(tokens[1])
  if (color === null) return raw(line, lineNumber)

  const nums = parseNumbers(tokens, 2, 12)
  if (nums === null) return raw(line, lineNumber)

  const result: QuadLine = {
    kind: 'quad',
    lineNumber,
    color,
    vertices: [
      vec3(nums[0], nums[1], nums[2]),
      vec3(nums[3], nums[4], nums[5]),
      vec3(nums[6], nums[7], nums[8]),
      vec3(nums[9], nums[10], nums[11]),
    ],
  }

  if (tokens.length >= 22) {
    const uv = parseNumbers(tokens, 14, 8)
    if (uv !== null) result.uv = uv as QuadLine['uv']
  }
  return result
}

function parseOptionalLine(line: string, lineNumber: number): LDrawCommand {
  const tokens = splitTokens(line)
  if (tokens.length !== 14) return raw(line, lineNumber)

  const color = parseColor(tokens[1])
  if (color === null) return raw(line, lineNumber)

  const nums = parseNumbers(tokens, 2, 12)
  if (nums === null) return raw(line, lineNumber)

  const result: OptionalLineLine = {
    kind: 'optional-line',
    lineNumber,
    color,
    vertices: [
      vec3(nums[0], nums[1], nums[2]),
      vec3(nums[3], nums[4], nums[5]),
      vec3(nums[6], nums[7], nums[8]),
      vec3(nums[9], nums[10], nums[11]),
    ],
  }
  return result
}

function parseComment(line: string, lineNumber: number): CommentLine {
  const text = extractCommentText(line)
  let keyword = ''
  let rest = ''

  if (text.length > 0) {
    const match = /^(\S+)(\s+.*)?$/.exec(text)
    if (match) {
      // `Description:`, `Name:` and `Author:` use a trailing colon; normalize
      // it away so callers can compare against bare keywords like "DESCRIPTION".
      let raw = match[1]
      if (raw.endsWith(':')) raw = raw.slice(0, -1)
      keyword = raw.toUpperCase()
      rest = (match[2] ?? '').replace(/^[:\s]+/, '')
    }
  }

  return { kind: 'comment', lineNumber, text, keyword, rest }
}

/**
 * Parse a single raw source line into a command.
 * Never throws: unrecognized or incomplete lines become `RawLine`.
 */
export function parseLine(line: string, lineNumber: number): LDrawCommand {
  const type = getLineType(line)
  if (type === null) return raw(line, lineNumber)

  switch (type) {
    case 0:
      return parseComment(line, lineNumber)
    case 1:
      return parseSubfile(line, lineNumber)
    case 2:
      return parseEdge(line, lineNumber)
    case 3:
      return parseTriangle(line, lineNumber)
    case 4:
      return parseQuad(line, lineNumber)
    case 5:
      return parseOptionalLine(line, lineNumber)
    default:
      return raw(line, lineNumber)
  }
}

function extractDescription(commands: LDrawCommand[]): string | undefined {
  let fallback: string | undefined

  for (const cmd of commands) {
    if (cmd.kind !== 'comment') continue

    if (cmd.keyword === META.DESCRIPTION) {
      return cmd.rest.trim() || undefined
    }

    if (fallback === undefined && cmd.keyword !== '') {
      const isBang = isBangKeyword(cmd.keyword)
      if (!isBang && !NON_DESCRIPTION_KEYWORDS.has(cmd.keyword)) {
        fallback = cmd.text.trim()
      }
    }
  }

  return fallback
}

/**
 * Parse LDraw source text (a single file or an MPD) into a document AST.
 *
 * - Strips a leading UTF-8 BOM.
 * - Accepts LF, CRLF, or CR line endings.
 * - Splits MPD files into models on `0 FILE` / `0 NOFILE`.
 * - Blank lines are not represented in the AST; the serializer regenerates
 *   spacing deterministically.
 */
export function parseLDraw(text: string, options: ParseOptions = {}): LDrawParseResult {
  const errors: LDrawParseError[] = []
  const tolerant = options.tolerant !== false

  let source = text
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1)

  const lines = toSourceLines(source)
  const { blocks, isMpd } = splitBlocks(lines)

  const models: LDrawModel[] = blocks.map((block) => {
    const commands: LDrawCommand[] = []
    for (const line of block.lines) {
      if (line.text.trim() === '') continue
      const cmd = parseLine(line.text, line.number)
      commands.push(cmd)
      if (cmd.kind === 'raw' && !tolerant) {
        errors.push({
          lineNumber: line.number,
          message: `Unrecognized or malformed LDraw line`,
          severity: 'error',
        })
      }
    }
    return { name: block.name, commands, description: extractDescription(commands) }
  })

  const document: LDrawDocument = { models, isMpd }
  return { document, errors }
}
