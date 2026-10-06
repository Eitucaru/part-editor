/** Projects and tools Part Editor v2 is built on, for the credits modal. */

export interface CreditLink {
  /** Short label for the link (e.g. an example or docs page). */
  label: string
  url: string
}

export interface CreditProject {
  /** Display name. */
  name: string
  /** Short "what it is" line shown in the modal. */
  description: string
  /** What it contributes to this app. */
  role: string
  /** Link to the project's source / home page. */
  url: string
  /** Additional related links (examples, docs, …) shown under the entry. */
  links?: CreditLink[]
}

export interface CreditCategory {
  title: string
  projects: CreditProject[]
}

/**
 * The compact badge shown in the top-right corner (mirrors Part Editor v1's
 * "React + Three.js + Monaco").
 */
export const BUILT_WITH_LABEL = 'React · Three.js · Monaco'

/**
 * Ordered by how central each item is to this project: the LDraw format and
 * the .conn format first, then the Three.js renderer and its LDraw
 * loader, then the supporting editor, UI, build and test tooling.
 */
export const CREDIT_CATEGORIES: CreditCategory[] = [
  {
    title: 'Formats & references',
    projects: [
      {
        name: 'LDraw',
        description: 'Open standard for LEGO CAD models.',
        role: 'The file format, parts library and primitives this editor reads and writes.',
        url: 'https://www.ldraw.org/',
      },
      {
        name: 'BrickLink Studio connectivity (.conn)',
        description: 'Connector format Studio needs for a custom part to snap and connect.',
        role: 'Read and written for compatibility. The format is undocumented; it was reverse engineered (see docs/TECHNICAL/connectivity.md).',
        url: 'https://www.bricklink.com/v3/studio/download.page',
      },
    ],
  },
  {
    title: 'Frameworks & libraries',
    projects: [
      {
        name: 'Three.js',
        description: 'JavaScript 3D library on top of WebGL.',
        role: 'Renders the LDraw scene, grid, gizmos and connector markers.',
        url: 'https://threejs.org/',
        links: [
          { label: 'LDrawLoader example', url: 'https://threejs.org/examples/webgl_loader_ldraw.html' },
          { label: 'LDrawLoader – three.js docs', url: 'https://threejs.org/docs/#LDrawLoader' },
        ],
      },
      {
        name: 'buildinginstructions.js',
        description: 'Render LEGO building instructions in the browser with three.js.',
        role: 'The three.js LDraw renderer used as the reference for LDraw geometry and rendering.',
        url: 'https://github.com/LasseD/buildinginstructions.js',
      },
      {
        name: 'Monaco Editor',
        description: 'The code editor that powers VS Code.',
        role: 'Text editor with LDraw syntax highlighting and live-sync.',
        url: 'https://microsoft.github.io/monaco-editor/',
      },
      {
        name: 'React',
        description: 'JavaScript library for building user interfaces.',
        role: 'Component framework behind the editor, toolbars, menus and modals.',
        url: 'https://react.dev/',
      },
      {
        name: 'TypeScript',
        description: 'Typed superset of JavaScript.',
        role: 'The language the entire codebase is written in.',
        url: 'https://www.typescriptlang.org/',
      },
      {
        name: 'Vite',
        description: 'Next-generation front-end build tool.',
        role: 'Development server and production bundler.',
        url: 'https://vitejs.dev/',
      },
      {
        name: 'Zustand',
        description: 'A small, fast state-management solution.',
        role: 'Document store, selection, history and settings.',
        url: 'https://github.com/pmndrs/zustand',
      },
      {
        name: 'react-resizable-panels',
        description: 'Resizable split-panel layout components.',
        role: 'The resizable editor / viewport split.',
        url: 'https://github.com/bvaughn/react-resizable-panels',
      },
      {
        name: 'Vitest',
        description: 'A fast unit-test framework for Vite projects.',
        role: 'Runs the core, lib and store test suites.',
        url: 'https://vitest.dev/',
      },
    ],
  },
]
