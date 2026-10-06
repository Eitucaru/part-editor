import { parseLDraw } from '../core'
import type { LDrawDocument } from '../core'
import { appendLine, splitLines } from './text-edit'

/**
 * Multi-file workspace helpers.
 *
 * The workspace is one MPD document (a single source string) whose `0 FILE …
 * 0 NOFILE` blocks are the workspace files. The active file's block is shown
 * in the text editor; edits splice that block back into the whole document.
 * The combined `LDrawDocument` is what the viewport renders (the first model
 * is the "main" model, and sub-files resolve against the other models by name).
 */

/** Normalize arbitrary text into an MPD (wrap a single file in FILE/NOFILE). */
export function toMpd(text: string, fallbackName = 'model.dat'): string {
  const trimmed = text.replace(/\s+$/, '')
  const { document } = parseLDraw(trimmed)
  if (document.models.length === 0) return `0 FILE ${fallbackName}\n0 NOFILE`
  if (document.isMpd && document.models[0].name !== '') return trimmed
  const name = document.models[0].name?.trim() || fallbackName
  return `0 FILE ${name}\n${trimmed}\n0 NOFILE`
}

/** Names of the workspace files (one per named model). */
export function getFileNames(document: LDrawDocument): string[] {
  return document.models.map((model) => model.name).filter((name) => name !== '')
}

function findFileLine(lines: string[], name: string): number {
  const target = name.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.toLowerCase().startsWith('0 file ') && line.slice(6).trim().toLowerCase() === target) return i
  }
  return -1
}

function findNoFileLine(lines: string[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === '0 nofile') return i
  }
  return -1
}

/** The raw content of a file's block (between `0 FILE` and `0 NOFILE`). */
export function getModelBlock(code: string, name: string): string {
  const lines = splitLines(code)
  const fileLine = findFileLine(lines, name)
  if (fileLine < 0) return ''
  const nofileLine = findNoFileLine(lines, fileLine)
  const end = nofileLine >= 0 ? nofileLine : lines.length
  return lines.slice(fileLine + 1, end).join('\n')
}

/**
 * Number of global lines before a file's block content begins, so a global
 * 1-based line number can be converted to the block-relative line shown in
 * the editor: `blockLine = globalLine - modelBlockOffset(code, name)`.
 * For the unnamed root model (not wrapped in `0 FILE`) this is 0.
 */
export function modelBlockOffset(code: string, name: string): number {
  if (name === '') return 0
  const fileLine = findFileLine(splitLines(code), name)
  return fileLine < 0 ? 0 : fileLine + 1
}

/** Replace a file's block content, preserving the `0 FILE`/`0 NOFILE` lines. */
export function replaceModelBlock(code: string, name: string, content: string): string {
  const lines = splitLines(code)
  const fileLine = findFileLine(lines, name)
  if (fileLine < 0) return code
  const nofileLine = findNoFileLine(lines, fileLine)
  const end = nofileLine >= 0 ? nofileLine : lines.length
  const newLines = content.split(/\r\n|\r|\n/)
  lines.splice(fileLine + 1, end - fileLine - 1, ...newLines)
  return lines.join('\n')
}

/** Remove a file's whole block (`0 FILE … 0 NOFILE`) from the workspace. */
export function removeModelBlock(code: string, name: string): string {
  const lines = splitLines(code)
  const fileLine = findFileLine(lines, name)
  if (fileLine < 0) return code
  const nofileLine = findNoFileLine(lines, fileLine)
  const end = nofileLine >= 0 ? nofileLine : lines.length
  lines.splice(fileLine, end - fileLine + 1)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Basename of a referenced file name, lower-cased (matches `matchFileName`). */
export function fileBase(name: string): string {
  return (name.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
}

/** True when any model in the document references the given file (by basename). */
export function isFileReferenced(document: LDrawDocument, name: string): boolean {
  const target = fileBase(name)
  return document.models.some((model) =>
    model.commands.some((cmd) => cmd.kind === 'subfile' && fileBase(cmd.file) === target),
  )
}

/** Merge incoming MPD blocks into a workspace: replace same-name blocks, else append. */
export function mergeModelBlocks(code: string, incoming: string): string {
  const { document } = parseLDraw(incoming)
  let result = code
  for (const model of document.models) {
    const name = model.name?.trim()
    if (!name) continue
    const content = getModelBlock(incoming, name)
    const names = getFileNames(parseLDraw(result).document)
    const existing = matchFileName(names, name)
    if (existing >= 0) {
      result = replaceModelBlock(result, names[existing], content)
    } else {
      const block = `0 FILE ${name}\n${content}\n0 NOFILE`
      result = result.replace(/\s+$/, '')
      result = result === '' ? block : `${result}\n\n${block}`
    }
  }
  return result
}

/** Append a line to the end of a file's block and report its global line number. */
export function appendToModelBlock(code: string, name: string, text: string): { code: string; lineNumber: number } {
  const lines = splitLines(code)
  const fileLine = findFileLine(lines, name)
  if (fileLine < 0) return appendLine(code, text)
  const nofileLine = findNoFileLine(lines, fileLine)
  const insertIndex = nofileLine >= 0 ? nofileLine : lines.length
  lines.splice(insertIndex, 0, text)
  return { code: lines.join('\n'), lineNumber: insertIndex + 1 }
}

/** Match a referenced file name against a workspace file name (basename, case-insensitive). */
export function matchFileName(fileNames: string[], file: string): number {
  const base = (file.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
  return fileNames.findIndex((name) => (name.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase() === base)
}
