/**
 * Number parsing and formatting rules for LDraw.
 *
 * LDraw numbers are decimal floats written without scientific notation.
 * Formatting is deterministic and idempotent so that "format twice" is a
 * no-op — a key requirement for the live-sync editor.
 */

/** Round `value` to `precision` decimals, stripping trailing zeros and `-0`. */
export function formatNumber(value: number, precision = 4): string {
  if (!Number.isFinite(value)) return '0'

  const factor = Math.pow(10, precision)
  let rounded = Math.round(value * factor) / factor
  // Normalize -0 to 0.
  if (rounded === 0) rounded = 0

  let str = String(rounded)
  // Guard against scientific notation for very large/small magnitudes.
  if (str.includes('e') || str.includes('E')) {
    str = rounded.toFixed(precision)
  }
  // toFixed can leave trailing zeros, e.g. "1.5000" -> "1.5".
  if (str.includes('.')) {
    str = str.replace(/0+$/, '').replace(/\.$/, '')
  }
  return str
}

/** Parse a floating-point token. Returns `null` for incomplete/invalid input. */
export function parseNumber(token: string): number | null {
  if (token === '' || token === '-' || token === '.' || token === '-.') return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

/**
 * Parse a color token. LDraw colors are integers, but a custom color may be
 * written in hexadecimal (`0x2RRGGBB`) in some files.
 */
export function parseColor(token: string): number | null {
  let value: number
  if (/^0x[0-9a-f]+$/i.test(token)) {
    value = parseInt(token, 16)
  } else {
    value = Number(token)
  }
  return Number.isFinite(value) ? value : null
}
