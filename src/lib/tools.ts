/**
 * Toolbar model: the `Shape` and `Connectivity` tabs, their tool buttons and
 * the variants each drawing tool offers.
 *
 * Shape tools cut geometry (CSG punch / erase); connectivity tools place
 * `.conn` connector records (see `conn.ts`).
 */

export type DrawKind = 'punch' | 'erase' | 'connector'

/** A connectivity record to place with the Conn tab tools. */
export interface ConnVariant {
  connType: number
  subType: number
  length: number
  /** Where the connector anchors: top (stud), bottom (hole), or center (axle). */
  placement: 'stud' | 'hole' | 'axle'
}

export interface ToolVariant {
  label: string
  desc: string
  /** How the variant is drawn in the viewport. */
  kind: DrawKind
  /** Natural (unscaled) size in LDU, used for ghost/snap/scale math. */
  naturalSize: { x: number; y: number; z: number }
  /** Cylinder radius in LDU for `punch` variants. */
  radius?: number
  /** Connectivity record for `connector` variants. */
  conn?: ConnVariant
}

export interface ToolMode {
  id: string
  label: string
  tooltip: string
  variants?: ToolVariant[]
}

export const SHAPE_TOOLS: ToolMode[] = [
  { id: 'select', label: 'Select', tooltip: 'Select parts' },
  { id: 'element', label: 'Element', tooltip: 'Select nested components directly' },
  { id: 'hole', label: 'Hole', tooltip: 'Click or drag to cut holes', variants: [
    { label: 'Axle Hole', desc: 'Punch an axle hole', kind: 'punch', radius: 6, naturalSize: { x: 12, y: 24, z: 12 } },
    { label: 'Pin Hole', desc: 'Punch a pin hole', kind: 'punch', radius: 4, naturalSize: { x: 8, y: 24, z: 8 } },
    { label: 'Bar Hole', desc: 'Punch a bar hole', kind: 'punch', radius: 3, naturalSize: { x: 6, y: 24, z: 6 } },
  ] },
  { id: 'eraser', label: 'Eraser', tooltip: 'Erase a rectangular region', variants: [
    { label: 'Shape Erase', desc: 'Erase a box region', kind: 'erase', naturalSize: { x: 20, y: 24, z: 20 } },
  ] },
  { id: 'scale', label: 'Scale', tooltip: 'Scale a part' },
  { id: 'decal', label: 'Decal', tooltip: 'Import an image for decal' },
]

export const CONN_TOOLS: ToolMode[] = [
  { id: 'select', label: 'Select', tooltip: 'Select connectivity info' },
  { id: 'element', label: 'Element', tooltip: 'Select nested connectivity info directly' },
  {
    id: 'stud',
    label: 'Stud',
    tooltip: 'Add stud connectivity',
    variants: [
      { label: 'Stud', desc: 'Add a stud connector', kind: 'connector', conn: { connType: 3, subType: 0, length: 0, placement: 'stud' }, naturalSize: { x: 20, y: 4, z: 20 } },
    ],
  },
  {
    id: 'bottom',
    label: 'Bottom',
    tooltip: 'Add bottom tube connectivity',
    variants: [
      { label: 'Bottom Tube', desc: 'Add an anti-stud tube', kind: 'connector', conn: { connType: 2, subType: 0, length: 0, placement: 'hole' }, naturalSize: { x: 20, y: 4, z: 20 } },
    ],
  },
  {
    id: 'acc',
    label: 'Acc',
    tooltip: 'Add accessory connectivity',
    variants: [
      { label: 'Axle', desc: 'Add an axle', kind: 'connector', conn: { connType: 0, subType: 7, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
      { label: 'Pin', desc: 'Add a technic pin', kind: 'connector', conn: { connType: 0, subType: 3, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
      { label: 'Clip', desc: 'Add a clip', kind: 'connector', conn: { connType: 0, subType: 12, length: 4, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
      { label: 'Bar', desc: 'Add a bar', kind: 'connector', conn: { connType: 0, subType: 13, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
    ],
  },
  {
    id: 'hole',
    label: 'Hole',
    tooltip: 'Add hole connectivity',
    variants: [
      { label: 'Axle Socket', desc: 'Add an axle socket', kind: 'connector', conn: { connType: 0, subType: 6, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
      { label: 'Pin Socket', desc: 'Add a pin socket', kind: 'connector', conn: { connType: 0, subType: 14, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
      { label: 'Round Hole', desc: 'Add a round hole', kind: 'connector', conn: { connType: 0, subType: 10, length: 20, placement: 'axle' }, naturalSize: { x: 20, y: 20, z: 20 } },
    ],
  },
]

/** A `ToolVariant` used by the viewport draw gesture. */
export interface ActiveDrawVariant {
  kind: DrawKind
  naturalSize: { x: number; y: number; z: number }
  radius?: number
  conn?: ConnVariant
}

export function toolModesFor(mode: 'shape' | 'conn'): ToolMode[] {
  return mode === 'shape' ? SHAPE_TOOLS : CONN_TOOLS
}

export function findToolMode(mode: 'shape' | 'conn', id: string): ToolMode | undefined {
  return toolModesFor(mode).find((tool) => tool.id === id)
}

export function variantAsDraw(variant: ToolVariant): ActiveDrawVariant {
  return {
    kind: variant.kind,
    naturalSize: { ...variant.naturalSize },
    radius: variant.radius,
    conn: variant.conn,
  }
}
