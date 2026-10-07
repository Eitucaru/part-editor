import { useCallback, useEffect, useRef, useState } from 'react'
import './site.css'
import { useEditorStore } from '../store/editorStore'
import { SiteApi, SiteError, type SitePart } from './site-api'

/** One client for the page: a new one per render would restart loading the draft on every render. */
const siteApi = new SiteApi()

/** Changes are saved this long after the last edit. */
const AUTOSAVE_DELAY = 4000

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string; stale: boolean }
  | { kind: 'completed'; files: string[] }

/** The draft's file count as the site will store it: the main model and one file per extra `0 FILE`. */
function fileNames(text: string): string[] {
  return [...text.matchAll(/^\s*0\s+FILE\s+(.+?)\s*$/gim)].map((m) => m[1]!)
}

/**
 * The site copy's draft bar: which part is open, whether its draft is saved, and marking it complete.
 * `?draft=<part id>` opens (or starts) the part's draft; edits are saved automatically. Without it
 * the bar is not shown.
 */
export function SiteBar({ api = siteApi }: { api?: SiteApi }) {
  const partId = new URLSearchParams(window.location.search).get('draft')
  const [part, setPart] = useState<SitePart | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [confirming, setConfirming] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const code = useEditorStore((state) => state.code)
  // What the site holds: the text and revision of the last save this copy made or loaded.
  const saved = useRef<{ text: string; revision: number } | null>(null)
  const saving = useRef<Promise<boolean> | null>(null)
  const dirty = saved.current !== null && code !== saved.current.text

  useEffect(() => {
    if (!partId) return
    let current = true
    api.start(partId).then(
      ({ part: loaded, draft }) => {
        if (!current || !draft) return
        setPart(loaded)
        saved.current = { text: draft.text, revision: draft.revision }
        useEditorStore.getState().setCode(draft.text, undefined, `Open draft of ${loaded.name}`)
        // The store may normalise line endings; compare against what it now holds.
        saved.current.text = useEditorStore.getState().code
        setStatus({ kind: 'ready' })
        document.title = `${loaded.name} · Part Editor`
      },
      (error: unknown) => current && setStatus({ kind: 'failed', message: messageOf(error), stale: false }),
    )
    return () => {
      current = false
    }
  }, [api, partId])

  /** Save now; resolves false when the site refused it. One save runs at a time. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!partId || !saved.current) return false
    if (saving.current) await saving.current
    const text = useEditorStore.getState().code
    if (text === saved.current.text) return true
    const run = (async () => {
      setStatus({ kind: 'saving' })
      try {
        const { draft } = await api.save(partId, saved.current!.revision, text)
        saved.current = { text, revision: draft.revision }
        setStatus({ kind: 'ready' })
        return true
      } catch (error) {
        setStatus({ kind: 'failed', message: messageOf(error), stale: error instanceof SiteError && error.status === 409 })
        return false
      }
    })()
    saving.current = run
    try {
      return await run
    } finally {
      saving.current = null
    }
  }, [api, partId])

  // Autosave a while after the last change, unless the last save was refused as stale.
  useEffect(() => {
    if (!dirty || status.kind === 'completed' || (status.kind === 'failed' && status.stale)) return
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [code, dirty, save, status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    const onLeave = (event: BeforeUnloadEvent) => {
      if (saved.current && useEditorStore.getState().code !== saved.current.text) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onLeave)
    }
  }, [save])

  async function complete() {
    if (!partId || !saved.current || !(await save())) return
    setStatus({ kind: 'saving' })
    try {
      const result = await api.complete(partId, saved.current.revision)
      setPart(result.part)
      setConfirming(false)
      setStatus({ kind: 'completed', files: result.files })
    } catch (error) {
      setStatus({ kind: 'failed', message: messageOf(error), stale: error instanceof SiteError && error.status === 409 })
    }
  }

  async function discard() {
    if (!partId || !window.confirm('Discard this draft? The part keeps the model it has now.')) return
    try {
      await api.discard(partId)
      saved.current = null
      window.location.href = part ? '/parts/' + encodeURIComponent(part.slug) : '/parts'
    } catch (error) {
      setStatus({ kind: 'failed', message: messageOf(error), stale: false })
    }
  }

  const state =
    status.kind === 'loading' ? 'Opening draft…'
      : status.kind === 'saving' ? 'Saving…'
        : status.kind === 'completed' ? 'Stored as the part’s model'
          : status.kind === 'failed' ? status.message
            : dirty ? 'Unsaved changes' : 'Draft saved'
  const files = fileNames(code)
  // Without a draft (`?part=` from "View in Part Editor"), the site copy is a viewer like the community one.
  if (!partId) return null

  return (
    <div className="site-bar">
      {part && <a className="site-bar-part" href={'/parts/' + encodeURIComponent(part.slug)} title="Back to the part page">← {part.name}</a>}
      <span className={'site-bar-state' + (status.kind === 'failed' ? ' failed' : '')} role="status">{state}</span>
      {status.kind === 'failed' && status.stale && <button type="button" onClick={() => window.location.reload()}>Reload draft</button>}
      {part && status.kind !== 'completed' && <>
        <button type="button" disabled={!dirty || status.kind === 'saving'} onClick={() => void save()} title="Ctrl+S">Save</button>
        <button type="button" className="primary" disabled={status.kind === 'saving'} onClick={() => { setAgreed(false); setConfirming(true) }}>Mark complete…</button>
        <button type="button" disabled={status.kind === 'saving'} onClick={() => void discard()}>Discard draft</button>
      </>}
      {confirming && part && (
        <div className="site-dialog-overlay" role="presentation" onClick={() => setConfirming(false)}>
          <div className="site-dialog" role="dialog" aria-modal="true" aria-labelledby="site-complete-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="site-complete-title">Store as the model of {part.name}</h2>
            <p>
              The draft becomes the part’s model file{files.length > 1 ? `, with ${files.length - 1} subfile${files.length > 2 ? 's' : ''} stored as files of their own` : ''}.
              Every editor who saved it is credited in its <code>0 Author:</code> line.
            </p>
            {files.length > 0 && <ul className="site-dialog-files">{files.map((name) => <li key={name}>{name}</li>)}</ul>}
            <label className="site-dialog-agree">
              <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
              <span>I publish this model under the <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution 4.0</a> licence, as every model made on the site is.</span>
            </label>
            <div className="site-dialog-actions">
              <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="primary" disabled={!agreed || status.kind === 'saving'} onClick={() => void complete()}>Store model</button>
            </div>
          </div>
        </div>
      )}
      {status.kind === 'completed' && part && <a className="site-bar-done" href={'/parts/' + encodeURIComponent(part.slug)}>View the part page</a>}
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The site could not be reached.'
}
