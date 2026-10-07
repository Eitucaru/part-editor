/**
 * The MiniBrickCraze copy of the editor (built with `VITE_SITE=minibrickcraze`) runs on the site's
 * own origin, so these requests carry the editor's session cookie. Every change also sends the
 * site's `x-mbc-request` header, which its CSRF check requires.
 */
export interface SitePart {
  id: string
  slug: string
  name: string
  /** The model file the part draws from now, if any. */
  modelFile: string | null
  modelStatus: 'notStarted' | 'inProgress' | 'modelled'
}

export interface SiteDraft {
  id: string
  /** `new` starts from an empty part, `edit` from the part's current model file. */
  kind: 'new' | 'edit'
  baseFile: string | null
  text: string
  revision: number
  updatedAt: string
  contributors: string[]
}

export interface DraftView {
  part: SitePart
  draft: SiteDraft | null
}

export interface CompletedModel {
  part: SitePart
  files: string[]
}

/** A refused request, with the server's own message where it gave one. */
export class SiteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>

export class SiteApi {
  constructor(private readonly base = '/api/v1', private readonly fetcher: SiteFetch = (input, init) => fetch(input, init)) {}

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.fetcher(this.base + path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'x-mbc-request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const answer = (await response.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(answer?.message) ? answer.message.join(' ') : answer?.message
      throw new SiteError(message || defaultMessage(response.status), response.status)
    }
    return (response.status === 204 ? null : await response.json()) as T
  }

  private draftPath(partId: string): string {
    return '/editor/parts/' + encodeURIComponent(partId) + '/model-draft'
  }

  /** The part and its open draft, if one exists. */
  view(partId: string): Promise<DraftView> {
    return this.request(this.draftPath(partId))
  }

  /** Open the part's draft, starting one from its current model (or an empty part) when there is none. */
  start(partId: string): Promise<DraftView> {
    return this.request(this.draftPath(partId), 'POST', {})
  }

  /** Save the draft; the revision is the one this copy last saw, so a stale save is refused (409). */
  save(partId: string, revision: number, text: string): Promise<{ draft: SiteDraft }> {
    return this.request(this.draftPath(partId), 'PUT', { revision, text })
  }

  /** Store the draft as the part's model, one file per `0 FILE` block, under CC BY 4.0. */
  complete(partId: string, revision: number): Promise<CompletedModel> {
    return this.request(this.draftPath(partId) + '/complete', 'POST', { revision, licence: 'CC-BY-4.0' })
  }

  /** Throw the draft away; the part keeps the model it had. */
  discard(partId: string): Promise<null> {
    return this.request(this.draftPath(partId), 'DELETE')
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Sign in on the site to edit parts.'
  if (status === 403) return 'Only editors can make or edit part models.'
  if (status === 404) return 'This part was not found.'
  if (status === 409) return 'The draft was changed in another window. Reload it before saving again.'
  return `The site answered ${status}.`
}
