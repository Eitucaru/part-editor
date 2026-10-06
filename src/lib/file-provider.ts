import { resolveCandidates } from './path-resolver'
import type { LibraryFs } from './library-fs'
import { ServerLdrawProvider } from './server-library'

/** Abstraction over "where do referenced LDraw files come from". */
export interface LDrawFileProvider {
  load(name: string): Promise<string | null>
}

/** A source of text files addressed by a library-relative path. */
export interface TextSource {
  read(relPath: string): Promise<string | null>
}

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html')
}

/** Fetch a URL and return its text, or null on any failure/404/HTML. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const text = await response.text()
    return looksLikeHtml(text) ? null : text
  } catch {
    return null
  }
}

/**
 * Resolve a path against the page location instead of the domain root, so the
 * app keeps working when it is served from a sub-path such as
 * `user.github.io/part-editor/`.
 */
export function appUrl(relative: string): string {
  if (typeof document === 'undefined') return `/${relative}`
  try {
    return new URL(relative, document.baseURI).toString()
  } catch {
    return `/${relative}`
  }
}

/**
 * Resolves referenced files through the LDraw search paths (see
 * `resolveCandidates`). The resolution order is source-independent: an HTTP
 * source and a folder on disk behave identically.
 */
export class LibraryResolver {
  private cache = new Map<string, string | null>()

  constructor(private ldraw: TextSource | null) {}

  /** Drop every cached file (used when the library source is swapped). */
  reset(): void {
    this.cache.clear()
  }

  async load(name: string): Promise<string | null> {
    const clean = name.replace(/\\/g, '/')
    const cached = this.cache.get(clean)
    if (cached !== undefined) return cached

    const ldraw = this.ldraw
    if (ldraw) {
      for (const candidate of resolveCandidates(clean)) {
        const text = await ldraw.read(candidate)
        if (text !== null) {
          this.cache.set(clean, text)
          return text
        }
      }
    }

    this.cache.set(clean, null)
    return null
  }
}

/** Reads the library from a web server (`/ldraw` on the dev/preview server). */
export class HttpLdrawProvider implements LDrawFileProvider {
  private resolver: LibraryResolver

  constructor(ldrawBaseUrl = appUrl('ldraw')) {
    this.resolver = new LibraryResolver({ read: (rel) => fetchText(`${ldrawBaseUrl}/${rel}`) })
  }

  load(name: string): Promise<string | null> {
    return this.resolver.load(name)
  }

  reset(): void {
    this.resolver.reset()
  }
}

/**
 * Reads the library from a folder the user picked from their own disk.
 *
 * Used when the app is served statically (GitHub Pages, a plain file share…)
 * where no `/ldraw` endpoint exists: the browser cannot see the disk on its
 * own, so the folder has to be handed over explicitly, once per session (or
 * once per browser profile when the handle is persisted).
 */
export class DirectoryLdrawProvider implements LDrawFileProvider {
  private resolver: LibraryResolver

  constructor(ldraw: LibraryFs) {
    this.resolver = new LibraryResolver(ldraw)
  }

  load(name: string): Promise<string | null> {
    return this.resolver.load(name)
  }

  reset(): void {
    this.resolver.reset()
  }
}

/** In-memory provider used by tests and for virtual (project-local) files. */
export class MemoryLdrawProvider implements LDrawFileProvider {
  constructor(private files: Record<string, string> = {}) {}

  async load(name: string): Promise<string | null> {
    return this.files[name.replace(/\\/g, '/')] ?? null
  }
}

/* -------------------------------------------------------------------------- *
 * Active provider
 *
 * The scene, the store and the schematic pane all hold a reference to
 * `defaultLdrawProvider`, so that object is a stable *delegate*: swapping the
 * library (server → local folder, or back) never leaves a stale reference
 * behind.
 * -------------------------------------------------------------------------- */

let active: LDrawFileProvider | null = null
let serverFallback: HttpLdrawProvider | ServerLdrawProvider | null = null

/**
 * The library API this build reads from when no folder is attached (`VITE_LDRAW_API`, e.g.
 * `https://minibrickcraze.com/api/v1`), or null to use the dev server's `/ldraw` mount.
 */
export function libraryApiUrl(): string | null {
  const configured = import.meta.env.VITE_LDRAW_API
  return typeof configured === 'string' && configured.trim() ? configured.trim() : null
}

function defaultSource(): HttpLdrawProvider | ServerLdrawProvider {
  if (!serverFallback) {
    const api = libraryApiUrl()
    serverFallback = api ? new ServerLdrawProvider(api) : new HttpLdrawProvider()
  }
  return serverFallback
}

function currentProvider(): LDrawFileProvider {
  return active ?? defaultSource()
}

/** The site library, when this build reads from one. */
export function serverLibrary(): ServerLdrawProvider | null {
  const source = defaultSource()
  return source instanceof ServerLdrawProvider ? source : null
}

/** Shared provider used by the scene and the store. */
export const defaultLdrawProvider: LDrawFileProvider = {
  load: (name) => currentProvider().load(name),
}

/**
 * Swap the active library. Pass `null` to go back to the default source (the
 * site library API, or the Vite dev/preview server).
 */
export function setLdrawProvider(provider: LDrawFileProvider | null): void {
  active = provider
}

/** The provider currently in use. */
export function getLdrawProvider(): LDrawFileProvider {
  return currentProvider()
}
