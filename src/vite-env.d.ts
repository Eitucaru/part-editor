/// <reference types="vite/client" />

// Provides typings for `import.meta.env` (used to distinguish the dev server,
// which serves the LDraw library, from a packaged build, which cannot).

interface ImportMetaEnv {
  /** Library API root, e.g. `https://minibrickcraze.com/api/v1`; unset uses `/ldraw`. */
  readonly VITE_LDRAW_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
