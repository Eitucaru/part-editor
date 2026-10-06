import type { Monaco } from '@monaco-editor/react'

/**
 * Register the `ldraw` language with a light Monarch grammar so the editor
 * highlights comments (type 0), line types (1–5), numbers, and file names.
 */
export function registerLdrawLanguage(monaco: Monaco): void {
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === 'ldraw')) return

  monaco.languages.register({ id: 'ldraw' })
  monaco.languages.setMonarchTokensProvider('ldraw', {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^0(\s.*)?$/, 'comment'],
        [/^[1-5]\b/, 'keyword'],
        [/\b(?:16|24)\b/, 'number'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/[a-zA-Z0-9_./\\-]+/, 'string'],
      ],
    },
  })
}
