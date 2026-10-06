import * as THREE from 'three'
import type { Mat3, Vec3 } from '../core'

/**
 * Matrix helpers for converting between LDraw type-1 matrices and Three.js.
 *
 * LDraw matrices are row-major `a b c / d e f / g h i` plus a translation
 * `x y z`. They are always of the form `rotation × local-axis scale` (possibly
 * mirrored), never shear — so `Matrix4.decompose` reproduces them exactly.
 */

/** Build a Three.js Matrix4 from an LDraw position + 3×3 matrix. */
export function ldrawToMatrix4(position: Vec3, matrix: Mat3): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    matrix.a,
    matrix.b,
    matrix.c,
    position.x,
    matrix.d,
    matrix.e,
    matrix.f,
    position.y,
    matrix.g,
    matrix.h,
    matrix.i,
    position.z,
    0,
    0,
    0,
    1,
  )
}

/** Extract the LDraw position + 3×3 matrix from a Three.js Matrix4. */
export function matrix4ToLdraw(m: THREE.Matrix4): { position: Vec3; matrix: Mat3 } {
  const e = m.elements
  return {
    position: { x: e[12], y: e[13], z: e[14] },
    matrix: {
      a: e[0],
      b: e[4],
      c: e[8],
      d: e[1],
      e: e[5],
      f: e[9],
      g: e[2],
      h: e[6],
      i: e[10],
    },
  }
}

/**
 * Set an object's transform from an LDraw matrix.
 *
 * Uses `Matrix4.decompose` — NOT the individual `setFromMatrixPosition` /
 * `setFromRotationMatrix` / `setFromMatrixScale` setters — so rotation,
 * non-uniform scale, and mirroring (negative determinant) are all reproduced
 * correctly.
 */
export function applyLdrawMatrix(object: THREE.Object3D, position: Vec3, matrix: Mat3): void {
  ldrawToMatrix4(position, matrix).decompose(object.position, object.quaternion, object.scale)
}

/**
 * Coordinate-space conversion between LDraw and the Three.js scene.
 *
 * LDraw is right-handed with **-Y up**; Three.js is right-handed with **+Y up**.
 * The conversion is the mirror `F = diag(1, -1, 1)`, which is its own inverse:
 *   - points:   scenePoint = flipY(ldrawPoint)
 *   - matrices: sceneMatrix = F · ldrawMatrix · F
 * `F · M · F` negates row 2 and column 2 of the 3×3 matrix.
 */

/** Flip a point's Y component (LDraw ↔ scene), normalizing -0 to 0. */
export function flipY(v: Vec3): Vec3 {
  return { x: v.x, y: v.y === 0 ? 0 : -v.y, z: v.z }
}

/** Convert an LDraw 3×3 matrix to scene space (F·M·F). */
export function ldrawMatrixToScene(m: Mat3): Mat3 {
  return {
    a: m.a,
    b: m.b === 0 ? 0 : -m.b,
    c: m.c,
    d: m.d === 0 ? 0 : -m.d,
    e: m.e,
    f: m.f === 0 ? 0 : -m.f,
    g: m.g,
    h: m.h === 0 ? 0 : -m.h,
    i: m.i,
  }
}

/** Convert a scene-space 3×3 matrix back to LDraw (F is its own inverse). */
export function sceneMatrixToLdraw(m: Mat3): Mat3 {
  return ldrawMatrixToScene(m)
}
