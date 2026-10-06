import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { parseConnBinary, writeConnBinary, connPosition, PhysicalT } from './conn'
import type { Connector } from './conn'

// Optional fixture: a real 3001b `.conn` file, which is not redistributed with
// this repository. Point CONN_FIXTURE_3001B at a local copy to run these tests.
const CONN_PATH = process.env.CONN_FIXTURE_3001B ?? ''
const itIf = CONN_PATH && existsSync(CONN_PATH) ? it : it.skip

describe('conn — real 3001b fixture', () => {
  itIf('parses the reference file and re-serializes byte-identically', () => {
    const bytes = readFileSync(CONN_PATH)
    const connectors = parseConnBinary(new Uint8Array(bytes))
    expect(connectors.length).toBeGreaterThan(0)

    // Re-serialize as V0 and compare byte-for-byte (the fixture is a V0 file).
    const rewritten = writeConnBinary(connectors, 'v0')
    expect(Buffer.from(rewritten).equals(bytes)).toBe(true)
  })

  itIf('reports the documented axle and grid records', () => {
    const bytes = new Uint8Array(readFileSync(CONN_PATH))
    const connectors = parseConnBinary(bytes)

    const axles = connectors.filter((c) => c.connType === PhysicalT.Axle)
    expect(axles.length).toBeGreaterThan(0)
    const first = axles[0] as Extract<Connector, { connType: PhysicalT.Axle }>
    expect(first.subType).toBe(10) // RoundHole
    expect(first.length).toBeCloseTo(20, 4)
    expect(connPosition(first.matrix).x).toBeCloseTo(-20, 3)

    const studs = connectors.filter((c) => c.connType === PhysicalT.Stud)
    const holes = connectors.filter((c) => c.connType === PhysicalT.Hole)
    expect(studs.length + holes.length).toBeGreaterThan(0)
  })
})
