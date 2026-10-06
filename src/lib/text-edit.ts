/**
 * Line-oriented edits to LDraw source text.
 *
 * All functions are pure: they take source text and return new source text.
 * Line numbers are 1-based. Line endings are normalized to `\n`.
 */

export function splitLines(code: string): string[] {
  return code.split(/\r\n|\r|\n/)
}

/** Return the text of a 1-based line, or '' if out of range. */
export function getLine(code: string, lineNumber: number): string {
  const lines = splitLines(code)
  return lines[lineNumber - 1] ?? ''
}

/** Replace a single line. */
export function replaceLine(code: string, lineNumber: number, newText: string): string {
  const lines = splitLines(code)
  if (lineNumber < 1 || lineNumber > lines.length) return code
  lines[lineNumber - 1] = newText
  return lines.join('\n')
}

/** Insert a line before `beforeLine` (1-based). Appends when out of range. */
export function insertLine(code: string, beforeLine: number, text: string): string {
  const lines = splitLines(code)
  const index = Math.min(Math.max(beforeLine - 1, 0), lines.length)
  lines.splice(index, 0, text)
  return lines.join('\n')
}

/** Remove a single line. */
export function removeLine(code: string, lineNumber: number): string {
  const lines = splitLines(code)
  if (lineNumber < 1 || lineNumber > lines.length) return code
  lines.splice(lineNumber - 1, 1)
  return lines.join('\n')
}

/** Replace a single line with one or more lines. */
export function replaceLines(code: string, lineNumber: number, newLines: string[]): string {
  const lines = splitLines(code)
  if (lineNumber < 1 || lineNumber > lines.length) return code
  lines.splice(lineNumber - 1, 1, ...newLines)
  return lines.join('\n')
}

/** Insert one or more lines before `beforeLine` (1-based). Appends when out of range. */
export function insertLines(code: string, beforeLine: number, newLines: string[]): string {
  const lines = splitLines(code)
  const index = Math.min(Math.max(beforeLine - 1, 0), lines.length)
  lines.splice(index, 0, ...newLines)
  return lines.join('\n')
}

/** Append a line and report its resulting 1-based line number. */
export function appendLine(code: string, text: string): { code: string; lineNumber: number } {
  const trimmed = code.replace(/\r?\n$/, '')
  const lineNumber = trimmed === '' ? 1 : trimmed.split('\n').length + 1
  const newCode = trimmed === '' ? text : trimmed + '\n' + text
  return { code: newCode, lineNumber }
}
