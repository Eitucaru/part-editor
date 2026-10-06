import { identityMat3, isMatrixMirrored, serializeCommand } from '../core'
import type { FormatMode, LDrawCommand, Mat3, SubfileLine, Vec3 } from '../core'

/**
 * High-level edit operations that produce updated commands.
 *
 * These are pure: they take a command and return a new command. Pairing them
 * with `text-edit.ts` and the serializer turns a 3D interaction into a precise,
 * single-line text edit (preserving the rest of the document and the editor's
 * cursor/scroll state).
 */

/** Create a new type-1 sub-file command (used by "insert part"). */
export function makeSubfileCommand(
  file: string,
  color = 16,
  position: Vec3 = { x: 0, y: 0, z: 0 },
  matrix: Mat3 = identityMat3(),
): SubfileLine {
  return { kind: 'subfile', lineNumber: 0, color, position, matrix, file, inverted: isMatrixMirrored(matrix) }
}

/** Replace a sub-file's position and matrix (and recompute the mirrored flag). */
export function setSubfileTransform(cmd: SubfileLine, position: Vec3, matrix: Mat3): SubfileLine {
  return { ...cmd, position: { ...position }, matrix: { ...matrix }, inverted: isMatrixMirrored(matrix) }
}

/** Replace one vertex of a line/triangle/quad. Other commands pass through. */
export function setVertexPosition(cmd: LDrawCommand, vertexIndex: number, position: Vec3): LDrawCommand {
  switch (cmd.kind) {
    case 'line':
      if (vertexIndex === 0) return { ...cmd, from: { ...position } }
      if (vertexIndex === 1) return { ...cmd, to: { ...position } }
      return cmd
    case 'triangle': {
      const vertices = cmd.vertices.map((v, i) => (i === vertexIndex ? { ...position } : v)) as [Vec3, Vec3, Vec3]
      return { ...cmd, vertices }
    }
    case 'quad': {
      const vertices = cmd.vertices.map((v, i) => (i === vertexIndex ? { ...position } : v)) as [
        Vec3,
        Vec3,
        Vec3,
        Vec3,
      ]
      return { ...cmd, vertices }
    }
    default:
      return cmd
  }
}

/** Pick a formatting mode that matches an existing line's whitespace style. */
export function detectFormatMode(line: string): FormatMode {
  return line.includes('   ') ? 'pretty' : 'compact'
}

/** Serialize a command using the same whitespace style as an existing line. */
export function serializeCommandLike(cmd: LDrawCommand, referenceLine: string): string {
  return serializeCommand(cmd, { mode: detectFormatMode(referenceLine) })
}
