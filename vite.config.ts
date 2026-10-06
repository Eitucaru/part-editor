import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Local LDraw library (parts, primitives, sub-parts).
const LDRAW_ROOT = process.env.LDRAW_LIBRARY_PATH ?? 'C:\\Program Files\\Studio 2.0\\ldraw'

/** Serve a static directory at a mount path with traversal protection. */
function staticServer(name: string, mount: string, root: string): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, _next) => {
    const urlPath = decodeURIComponent(req.url?.split('?')[0] ?? '')
    if (urlPath.includes('..')) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }
    const filePath = path.join(root, urlPath)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Cache-Control', 'no-cache')
      fs.createReadStream(filePath).pipe(res)
      return
    }
    res.statusCode = 404
    res.end('Not Found')
  }

  return {
    name,
    configureServer(server) {
      server.middlewares.use(mount, handler)
    },
    // Also serve the local library from `vite preview`, so the built app can be
    // exercised the same way as the dev build.
    configurePreviewServer(server) {
      server.middlewares.use(mount, handler)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // Serving the app from a sub-path (https://user.github.io/<repo>/) needs a
  // matching base so the emitted /assets URLs resolve. Build with
  // `VITE_BASE=/<repo>/ npm run build` instead of editing this file. Library
  // paths are resolved against the page location at runtime (see `appUrl`).
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    staticServer('serve-ldraw-library', '/ldraw', LDRAW_ROOT),
  ],
})
