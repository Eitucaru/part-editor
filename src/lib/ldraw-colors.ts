/**
 * LDraw color table and conversion helpers.
 *
 * The table covers the standard 0–15 palette plus the codes the editor needs
 * most often (16 inherit/tan, 17, 19, 24 edge, and the common greys). Custom
 * colors written as `0x2RRGGBB` are decoded from their low 24 bits.
 *
 * Returned RGB values are **linear** (sRGB → linear), matching what Three.js
 * expects for vertex colors when the renderer outputs sRGB.
 */

const COLOR_HEX: Record<number, number> = {
  0: 0x05131d,
  1: 0x0055bf,
  2: 0x237841,
  3: 0x008f9b,
  4: 0xc91a09,
  5: 0xc870a0,
  6: 0x583927,
  7: 0x9ba19d,
  8: 0x6d6e5c,
  9: 0xb4d2e3,
  10: 0x4b9f4a,
  11: 0x55a5af,
  12: 0xf2705e,
  13: 0xfc97ac,
  14: 0xf2cd37,
  15: 0xffffff,
  16: 0xe4cd9e,
  17: 0xe5d5a8,
  19: 0xe4cd9e,
  24: 0x000000,
  71: 0xa0a0a0,
  72: 0x646464,
}

const DEFAULT_HEX = 0xcccccc

/** Resolve a color code to a 24-bit hex value. */
export function getColorHex(code: number): number {
  const direct = COLOR_HEX[code]
  if (direct !== undefined) return direct
  // Custom color: 0x2RRGGBB → low 24 bits are the RGB value.
  if (code >= 0x2000000) return code & 0xffffff
  return DEFAULT_HEX
}

function srgbToLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Resolve a color code to linear RGB components in 0..1. */
export function getColorRgbLinear(code: number): [number, number, number] {
  const hex = getColorHex(code)
  return [
    srgbToLinear((hex >> 16) & 0xff),
    srgbToLinear((hex >> 8) & 0xff),
    srgbToLinear(hex & 0xff),
  ]
}
