/**
 * Site features of the MiniBrickCraze copy (`npm run build:site`). `@site` resolves here only in that
 * build (vite.config.ts); every other build gets `disabled.ts`, so none of this, nor the bundled
 * Monaco, reaches the community copy.
 */
import type { ComponentType } from 'react'
import { SiteBar as Bar } from './SiteBar'

/** Resolves once the editor may mount: the site copy bundles Monaco first. */
export const ready: Promise<unknown> = import('./monaco-local')
export const SiteBar: ComponentType | null = Bar
