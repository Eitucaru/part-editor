/**
 * Search-path resolution for LDraw library lookups.
 *
 * High-resolution primitives (`p/48`) are preferred over the standard ones
 * when both exist, for smoother curves; then standard primitives, then parts,
 * then the Unofficial tree.
 */

/** Produce the ordered list of library-relative candidate paths for a name. */
export function resolveCandidates(name: string): string[] {
  const clean = name.replace(/\\/g, '/').replace(/^\.\//, '')

  // `s/` prefixed names are sub-parts living under `parts/s/`.
  if (clean.startsWith('s/')) {
    const rest = clean.slice(2)
    return [`parts/s/${rest}`, `UnOfficial/parts/s/${rest}`]
  }

  return [
    `p/48/${clean}`,
    `p/${clean}`,
    `p/8/${clean}`,
    `parts/${clean}`,
    `UnOfficial/p/48/${clean}`,
    `UnOfficial/p/${clean}`,
    `UnOfficial/p/8/${clean}`,
    `UnOfficial/parts/${clean}`,
    clean,
  ]
}
