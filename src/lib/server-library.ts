import type { LDrawFileProvider } from './file-provider'

/**
 * Reads the LDraw library from a MiniBrickCraze-compatible API (`/ldraw/manifest`,
 * `/ldraw/v/{version}/bundle`, `/parts/{slug}/model/bundle`).
 *
 * A bundle is a file plus everything it references, so drawing a part takes one request instead of
 * one per sub-file and primitive. Bundle URLs carry the library version from the manifest, which
 * lets the browser cache them for good; when the library changes the server answers 410 and the
 * manifest is read again.
 */

/** A reference name the way the server keys it: lower-case, `/`, no `parts/` or `p/` prefix. */
export function referenceKey(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^(?:ldraw\/)?(?:unofficial\/)?(?:parts|p|models)\//, '')
}

export interface LdrawBundle {
  version: string
  root: string
  files: Record<string, string>
  missing: string[]
  truncated: boolean
}

export interface PartModelBundle extends LdrawBundle {
  part: { slug: string }
  source: string
}

type Fetcher = (url: string) => Promise<Response>

export class ServerLdrawProvider implements LDrawFileProvider {
  /** Known files by reference key; `null` is a confirmed miss. */
  private files = new Map<string, string | null>()
  private pending = new Map<string, Promise<void>>()
  private manifestRequest: Promise<string> | null = null
  /** Label of the server's library, once the manifest has been read. */
  label: string | null = null

  /**
   * @param apiBase API root, e.g. `https://minibrickcraze.com/api/v1`.
   * @param hires Ask for `p/48` primitives where the library has them (smoother curves).
   */
  constructor(
    readonly apiBase: string,
    private hires = true,
    private fetcher: Fetcher = (url) => fetch(url),
  ) {}

  private url(path: string): string {
    return this.apiBase.replace(/\/+$/, '') + path
  }

  private manifest(): Promise<string> {
    if (!this.manifestRequest) {
      const request = (async () => {
        const response = await this.fetcher(this.url('/ldraw/manifest'))
        if (!response.ok) throw new Error(`The library manifest answered ${response.status}`)
        const body = (await response.json()) as { version: string; label: string | null }
        this.label = body.label
        return body.version
      })()
      // A failed read (offline, server down) is retried on the next lookup.
      request.catch(() => {
        if (this.manifestRequest === request) this.manifestRequest = null
      })
      this.manifestRequest = request
    }
    return this.manifestRequest
  }

  /** Remember every file a bundle carries, so its references resolve without more requests. */
  seed(bundle: Pick<LdrawBundle, 'files' | 'missing'>): void {
    for (const [key, text] of Object.entries(bundle.files)) this.files.set(key, text)
    for (const key of bundle.missing) if (!this.files.has(key)) this.files.set(key, null)
  }

  async load(name: string): Promise<string | null> {
    const key = referenceKey(name)
    const known = this.files.get(key)
    if (known !== undefined) return known
    let request = this.pending.get(key)
    if (!request) {
      request = this.fetchBundle(key).finally(() => this.pending.delete(key))
      this.pending.set(key, request)
    }
    await request
    return this.files.get(key) ?? null
  }

  private async fetchBundle(key: string, retry = true): Promise<void> {
    let version: string
    try {
      version = await this.manifest()
    } catch {
      return // Unreachable: leave the name unresolved, but do not remember it as missing.
    }
    const query = `?name=${encodeURIComponent(key)}${this.hires ? '&hires=1' : ''}`
    const response = await this.fetcher(this.url(`/ldraw/v/${version}/bundle${query}`)).catch(() => null)
    if (!response) return
    if (response.status === 410 && retry) {
      // The library changed: everything known may be stale.
      this.manifestRequest = null
      this.files.clear()
      return this.fetchBundle(key, false)
    }
    if (response.status === 404) {
      this.files.set(key, null)
      return
    }
    if (!response.ok) return
    this.seed((await response.json()) as LdrawBundle)
    if (!this.files.has(key)) this.files.set(key, null)
  }

  /** A published part's model, as the site draws it. Its whole tree is remembered. */
  async loadPart(slug: string): Promise<PartModelBundle | null> {
    const query = this.hires ? '?hires=1' : ''
    const response = await this.fetcher(this.url(`/parts/${encodeURIComponent(slug)}/model/bundle${query}`)).catch(
      () => null,
    )
    if (!response || !response.ok) return null
    const bundle = (await response.json()) as PartModelBundle
    this.seed(bundle)
    return bundle
  }
}
