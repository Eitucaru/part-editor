/**
 * Known LDraw meta-command keywords (uppercased).
 *
 * Meta commands are type-0 lines whose first token is a recognized keyword.
 * This list is intentionally broad so consumers (parser, serializer, and later
 * the renderer) can reason about a line's semantics without string literals
 * scattered across the codebase.
 */

export const META = {
  // Official LDraw meta commands
  DESCRIPTION: 'DESCRIPTION',
  NAME: 'NAME',
  AUTHOR: 'AUTHOR',
  FILE: 'FILE',
  NOFILE: 'NOFILE',
  LICENSE: '!LICENSE',
  LDRAW_ORG: '!LDRAW_ORG',
  CATEGORY: '!CATEGORY',
  KEYWORDS: '!KEYWORDS',
  HISTORY: '!HISTORY',
  HELP: '!HELP',
  CMDLINE: '!CMDLINE',
  COLOUR: '!COLOUR',
  BFC: 'BFC',
  STEP: 'STEP',
  ROTSTEP: 'ROTSTEP',
  SAVE: 'SAVE',
  CLEAR: 'CLEAR',
  WRITE: 'WRITE',
  PRINT: 'PRINT',
  PAUSE: 'PAUSE',
  MPD: 'MPD',
} as const

/** BFC statement keywords (the `rest` of a `0 BFC …` line starts with these). */
export const BFC = {
  CERTIFY: 'CERTIFY',
  NOCERTIFY: 'NOCERTIFY',
  CCW: 'CCW',
  CW: 'CW',
  INVERTNEXT: 'INVERTNEXT',
  CLIP: 'CLIP',
  NOCLIP: 'NOCLIP',
} as const

/** Keywords that never describe a part (skipped when guessing a description). */
export const NON_DESCRIPTION_KEYWORDS = new Set<string>([
  META.BFC,
  META.STEP,
  META.ROTSTEP,
  META.SAVE,
  META.CLEAR,
  META.WRITE,
  META.PRINT,
  META.PAUSE,
  META.MPD,
  META.FILE,
  META.NOFILE,
  META.NAME,
  META.AUTHOR,
  META.LICENSE,
  META.LDRAW_ORG,
  META.CATEGORY,
  META.KEYWORDS,
  META.HISTORY,
  META.HELP,
  META.CMDLINE,
  META.COLOUR,
])

/** True when a keyword is a `!`-prefixed official meta command. */
export function isBangKeyword(keyword: string): boolean {
  return keyword.startsWith('!')
}
