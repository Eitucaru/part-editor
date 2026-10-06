/**
 * Minimal 3D math primitives used by the LDraw core.
 *
 * Coordinates are kept in native LDraw space (right-handed, Y-up, LDU units).
 * Conversion to a left-handed render space (Three.js) is the renderer's
 * responsibility.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A 3×3 matrix in LDraw type-1 order: a b c / d e f / g h i. */
export interface Mat3 {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h: number
  i: number
}

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function mat3(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
  i: number,
): Mat3 {
  return { a, b, c, d, e, f, g, h, i }
}

export function identityMat3(): Mat3 {
  return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1)
}

/** Determinant of a 3×3 matrix. */
export function determinant(m: Mat3): number {
  return (
    m.a * (m.e * m.i - m.f * m.h) -
    m.b * (m.d * m.i - m.f * m.g) +
    m.c * (m.d * m.h - m.e * m.g)
  )
}

/** Multiply two 3×3 matrices (`a ∘ b`, apply `b` first). */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return {
    a: a.a * b.a + a.b * b.d + a.c * b.g,
    b: a.a * b.b + a.b * b.e + a.c * b.h,
    c: a.a * b.c + a.b * b.f + a.c * b.i,
    d: a.d * b.a + a.e * b.d + a.f * b.g,
    e: a.d * b.b + a.e * b.e + a.f * b.h,
    f: a.d * b.c + a.e * b.f + a.f * b.i,
    g: a.g * b.a + a.h * b.d + a.i * b.g,
    h: a.g * b.b + a.h * b.e + a.i * b.h,
    i: a.g * b.c + a.h * b.f + a.i * b.i,
  }
}

/** Transform a point by a 3×3 matrix plus a translation. */
export function transformPoint(m: Mat3, t: Vec3, p: Vec3): Vec3 {
  return {
    x: m.a * p.x + m.b * p.y + m.c * p.z + t.x,
    y: m.d * p.x + m.e * p.y + m.f * p.z + t.y,
    z: m.g * p.x + m.h * p.y + m.i * p.z + t.z,
  }
}

/**
 * A negative determinant means the matrix includes a mirror (reflection),
 * which inverts the winding of the referenced geometry.
 */
export function isMatrixMirrored(m: Mat3): boolean {
  return determinant(m) < 0
}
