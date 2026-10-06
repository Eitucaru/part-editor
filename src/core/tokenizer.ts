/**
 * Line-level tokenization for LDraw source text.
 */

export type LineType = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Classify a raw line by its leading digit.
 *
 * Leading spaces/tabs are skipped so indented lines (common in the official
 * primitive library) parse identically to column-0 lines. Returns `null` when
 * the line is not a valid LDraw command line.
 */
export function getLineType(line: string): LineType | null {
  let i = 0
  while (i < line.length) {
    const code = line.charCodeAt(i)
    if (code !== 32 && code !== 9) break // skip ' ' and '\t'
    i++
  }
  if (i >= line.length) return null

  const first = line.charCodeAt(i)
  if (first < 48 || first > 53) return null // '0'..'5'

  if (i + 1 < line.length) {
    const second = line.charCodeAt(i + 1)
    // The digit must be followed by whitespace or end-of-line.
    if (!(second === 32 || second === 9 || second === 13)) return null
  }
  return (first - 48) as LineType
}

/** Split a line on runs of whitespace, trimming leading/trailing space. */
export function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/)
}

/**
 * Uppercased first token of a type-0 line's text.
 * Returns '' when the line has no content (a bare `0`).
 */
export function getMetaKeyword(text: string): string {
  const match = /^\S+/.exec(text)
  return match ? match[0].toUpperCase() : ''
}

/**
 * Extract the content after the leading `0` of a type-0 line.
 * Leading whitespace (including before the `0`) is removed; the rest of the
 * comment text is preserved.
 */
export function extractCommentText(line: string): string {
  const trimmed = line.trimStart()
  if (trimmed.length === 0 || trimmed[0] !== '0') return trimmed
  if (trimmed.length === 1) return ''
  return trimmed.slice(1).replace(/^[ \t]+/, '')
}
