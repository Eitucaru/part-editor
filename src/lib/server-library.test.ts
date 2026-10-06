import { describe, it, expect } from 'vitest'
import { ServerLdrawProvider, referenceKey } from './server-library'

/** A fake library API: records requested paths and answers from a table. */
function fakeServer(routes: Record<string, { status?: number; body?: unknown }>, version = { current: 'aaaaaaaaaaaaaaaa' }) {
  const requests: string[] = []
  const fetcher = async (url: string) => {
    const path = url.replace('https://site.example/api/v1', '')
    requests.push(path)
    if (path === '/ldraw/manifest')
      return new Response(JSON.stringify({ version: version.current, label: 'LDraw test' }), { status: 200 })
    const route = routes[path.replace(version.current, '{v}')]
    if (!route) return new Response('{}', { status: path.includes(version.current) ? 404 : 410 })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 })
  }
  return { requests, fetcher }
}

const brickBundle = {
  version: 'aaaaaaaaaaaaaaaa',
  root: '3001.dat',
  files: { '3001.dat': '1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/3001s01.dat', 's/3001s01.dat': '0 sub' },
  missing: ['stud.dat'],
  truncated: false,
}

describe('referenceKey', () => {
  it('keys references the way the server does', () => {
    expect(referenceKey('3001.DAT')).toBe('3001.dat')
    expect(referenceKey('S\\3001S01.dat')).toBe('s/3001s01.dat')
    expect(referenceKey('parts/s/3001s01.dat')).toBe('s/3001s01.dat')
    expect(referenceKey('p/48/4-4cyli.dat')).toBe('48/4-4cyli.dat')
    expect(referenceKey('ldraw/UnOfficial/parts/x.dat')).toBe('x.dat')
  })
})

describe('ServerLdrawProvider', () => {
  it('draws a part and its references from one bundle request', async () => {
    const server = fakeServer({ '/ldraw/v/{v}/bundle?name=3001.dat&hires=1': { body: brickBundle } })
    const provider = new ServerLdrawProvider('https://site.example/api/v1/', true, server.fetcher)
    expect(await provider.load('3001.dat')).toContain('s/3001s01.dat')
    expect(await provider.load('s\\3001s01.dat')).toBe('0 sub')
    // Listed as missing in the bundle: known absent, no further request.
    expect(await provider.load('stud.dat')).toBeNull()
    expect(server.requests).toEqual(['/ldraw/manifest', '/ldraw/v/aaaaaaaaaaaaaaaa/bundle?name=3001.dat&hires=1'])
    expect(provider.label).toBe('LDraw test')
  })

  it('asks once for a name requested twice at the same time, and remembers a 404', async () => {
    const server = fakeServer({})
    const provider = new ServerLdrawProvider('https://site.example/api/v1', false, server.fetcher)
    const [a, b] = await Promise.all([provider.load('nope.dat'), provider.load('NOPE.dat')])
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(await provider.load('nope.dat')).toBeNull()
    expect(server.requests.filter((path) => path.includes('bundle'))).toEqual([
      '/ldraw/v/aaaaaaaaaaaaaaaa/bundle?name=nope.dat',
    ])
  })

  it('reads the manifest again when the library changed (410)', async () => {
    const version = { current: 'aaaaaaaaaaaaaaaa' }
    const server = fakeServer({ '/ldraw/v/{v}/bundle?name=3001.dat&hires=1': { body: brickBundle } }, version)
    const provider = new ServerLdrawProvider('https://site.example/api/v1', true, server.fetcher)
    expect(await provider.load('s/3001s01.dat')).toBeNull() // primes the old version (404)
    version.current = 'bbbbbbbbbbbbbbbb'
    expect(await provider.load('3001.dat')).toContain('3001s01')
    expect(server.requests).toEqual([
      '/ldraw/manifest',
      '/ldraw/v/aaaaaaaaaaaaaaaa/bundle?name=s%2F3001s01.dat&hires=1',
      '/ldraw/v/aaaaaaaaaaaaaaaa/bundle?name=3001.dat&hires=1',
      '/ldraw/manifest',
      '/ldraw/v/bbbbbbbbbbbbbbbb/bundle?name=3001.dat&hires=1',
    ])
  })

  it('does not remember a name as missing while the server is unreachable', async () => {
    let online = false
    const server = fakeServer({ '/ldraw/v/{v}/bundle?name=3001.dat&hires=1': { body: brickBundle } })
    const provider = new ServerLdrawProvider('https://site.example/api/v1', true, async (url) => {
      if (!online) throw new TypeError('Failed to fetch')
      return server.fetcher(url)
    })
    expect(await provider.load('3001.dat')).toBeNull()
    online = true
    expect(await provider.load('3001.dat')).toContain('3001s01')
  })

  it('opens a published part and keeps its tree', async () => {
    const server = fakeServer({
      '/parts/brick-2x4/model/bundle?hires=1': {
        body: { ...brickBundle, part: { slug: 'brick-2x4' }, source: 'part' },
      },
    })
    const provider = new ServerLdrawProvider('https://site.example/api/v1', true, server.fetcher)
    const bundle = await provider.loadPart('brick-2x4')
    expect(bundle?.root).toBe('3001.dat')
    expect(await provider.load('s/3001s01.dat')).toBe('0 sub')
    expect(await provider.loadPart('unknown')).toBeNull()
    expect(server.requests.some((path) => path.includes('/ldraw/v/'))).toBe(false)
  })
})
