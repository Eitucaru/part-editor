/// <reference types="vite/client" />

// Provides typings for `import.meta.env` (used to distinguish the dev server,
// which serves the LDraw library, from a packaged build, which cannot).

interface ImportMetaEnv {
  /** Library API root, e.g. `https://minibrickcraze.com/api/v1`; unset uses `/ldraw`. */
  readonly VITE_LDRAW_API?: string
  /** `minibrickcraze` builds the site copy: part drafts, saving and a bundled Monaco. */
  readonly VITE_SITE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
