/**
 * Minimal static file server, used to check a packaged build locally.
 *
 *   node scripts/serve-static.mjs [root] [port]
 *
 * Point it at the *parent* of the app folder (`dist-pages`) so the sub-path is
 * exercised exactly like on GitHub Pages: http://localhost:4173/part-editor/
 */
import { createReadStream, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'dist-pages')
const port = Number(process.argv[3] ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.dat': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json',
}

const server = createServer(async (request, response) => {
  const urlPath = decodeURIComponent((request.url ?? '/').split('?')[0])
  let target = path.normalize(path.join(root, urlPath))
  if (!target.startsWith(root)) {
    response.statusCode = 403
    response.end('Forbidden')
    return
  }
  try {
    if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html')
  } catch {
    response.statusCode = 404
    response.end('Not found')
    return
  }
  response.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream')
  createReadStream(target)
    .on('error', () => {
      response.statusCode = 404
      response.end('Not found')
    })
    .pipe(response)
})

server.listen(port, () => {
  console.log(`Serving ${root} on http://localhost:${port}/`)
})
