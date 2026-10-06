import { useCallback, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react'
import { registerLdrawLanguage } from '../lib/monaco-ldraw'
import { modelBlockOffset } from '../lib/workspace'
import { useEditorStore } from '../store/editorStore'

type MonacoEditor = Parameters<OnMount>[0]

/** The LDraw text editor, kept in sync with the document store. */
export function EditorPane() {
  const activeCode = useEditorStore((state) => state.activeCode)
  const previewActiveCode = useEditorStore((state) => state.previewActiveCode)
  const setActiveCode = useEditorStore((state) => state.setActiveCode)
  const selectedVertices = useEditorStore((state) => state.selectedVertices)
  const selectedVertex = useEditorStore((state) => state.selectedVertex)
  const code = useEditorStore((state) => state.code)
  const fileNames = useEditorStore((state) => state.fileNames)
  const activeFileIndex = useEditorStore((state) => state.activeFileIndex)

  const editorRef = useRef<MonacoEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const vertexDecorations = useRef<string[]>([])

  /** Highlight the source lines of the currently selected vertices. */
  const applyVertexHighlights = useCallback(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return

    const state = useEditorStore.getState()
    const name = state.fileNames[state.activeFileIndex] ?? ''
    const offset = modelBlockOffset(state.code, name)
    const lineCount = model.getLineCount()

    const decorations = []
    const seen = new Set<number>()
    for (const sel of state.selectedVertices) {
      const local = sel.lineNumber - offset
      if (local < 1 || local > lineCount || seen.has(local)) continue
      seen.add(local)
      decorations.push({
        range: new monaco.Range(local, 1, local, 1),
        options: { isWholeLine: true, className: 'vertex-selected-line' },
      })
    }
    vertexDecorations.current = editor.deltaDecorations(vertexDecorations.current, decorations)
  }, [])

  useEffect(() => {
    // `previewActiveCode` is a trigger: Monaco's live value update (a full-range
    // edit) can re-render whole-line decorations at the wrong line, so re-apply
    // them once the preview content has landed.
    applyVertexHighlights()
  }, [applyVertexHighlights, selectedVertices, selectedVertex, code, previewActiveCode, fileNames, activeFileIndex])

  const beforeMount: BeforeMount = (monaco) => registerLdrawLanguage(monaco)

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    const model = editor.getModel()
    if (!model) return

    const activeWidgets: { widget: object; id: string }[] = []

    const clear = () => {
      for (const { widget } of activeWidgets) {
        editor.removeContentWidget(widget as Parameters<typeof editor.removeContentWidget>[0])
      }
      activeWidgets.length = 0
    }

    const rebuild = () => {
      clear()
      for (let line = 1; line <= model.getLineCount(); line++) {
        const text = model.getLineContent(line)
        const trimmed = text.trim()
        if (!/^1\s/.test(trimmed)) continue
        const name = trimmed.split(/\s+/).pop() ?? ''
        if (!name) continue
        const column = text.lastIndexOf(name) + name.length + 1

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'subfile-edit-btn'
        button.textContent = '✎'
        button.title = `Edit ${name}`
        button.addEventListener('click', (event) => {
          event.preventDefault()
          useEditorStore.getState().openSubfile(name)
        })

        const widget = {
          getId: () => `subfile-edit-${line}`,
          getDomNode: () => button,
          getPosition: () => ({
            position: { lineNumber: line, column },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }),
        }
        editor.addContentWidget(widget)
        activeWidgets.push({ widget, id: `subfile-edit-${line}` })
      }
    }

    rebuild()
    model.onDidChangeContent(() => rebuild())
    applyVertexHighlights()
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="ldraw"
      value={previewActiveCode ?? activeCode}
      onChange={(value) => setActiveCode(value ?? '')}
      beforeMount={beforeMount}
      onMount={onMount}
      theme="vs-dark"
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: 'off',
        scrollBeyondLastLine: false,
        tabSize: 2,
      }}
    />
  )
}
