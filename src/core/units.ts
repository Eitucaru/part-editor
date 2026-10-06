/**
 * Length units and conversions.
 *
 * Standard LDraw unit conventions:
 *   - 1 stud = 20 LDU
 *   - 1 mm   = 2.5 LDU  (so 1 LDU = 0.4 mm, 1 stud = 8 mm)
 *   - 1 inch = 64 LDU
 *
 * Geometry is always stored and processed in LDU; conversion exists only for
 * UI display and import/export.
 */

export const LDU_PER_STUD = 20
export const LDU_PER_MM = 2.5
export const MM_PER_STUD = 8
export const LDU_PER_INCH = 64

export type LengthUnit = 'ldu' | 'stud' | 'mm' | 'inch'

const LDU_PER_UNIT: Record<LengthUnit, number> = {
  ldu: 1,
  stud: LDU_PER_STUD,
  mm: LDU_PER_MM,
  inch: LDU_PER_INCH,
}

/** Convert a value in `unit` to LDU. */
export function toLdu(value: number, unit: LengthUnit): number {
  return value * LDU_PER_UNIT[unit]
}

/** Convert a value in LDU to `unit`. */
export function fromLdu(ldu: number, unit: LengthUnit): number {
  return ldu / LDU_PER_UNIT[unit]
}

/** Convert a value between two length units. */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return fromLdu(toLdu(value, from), to)
}
