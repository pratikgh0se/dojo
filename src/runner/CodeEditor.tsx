// The code editor (CodeMirror 6; Go or Python mode), lazy-loaded by CodePanel so the editor never weighs on the entry chunk.
// Its content element is the textbox named "Code" (C-RUNNER §4). Tab indents; Escape, then Tab, leaves it (editorKeymap.ts).
import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { go } from '@codemirror/legacy-modes/mode/go'
import { python } from '@codemirror/legacy-modes/mode/python'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { EDITOR_KEYS_HELP, tabKeys } from './editorKeymap'

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sr-energy-accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sr-signal-ok)' },
  { tag: tags.number, color: 'var(--sr-label-warn)' },
  { tag: tags.comment, color: 'var(--sr-text-secondary)', fontStyle: 'italic' },
])

// F6.17: Space Mono 15 on a 24 px line; gutter numbers Space Mono 14 on the same 24 px line, so each number sits
// on its own line's baseline; min 360 / max 560 (phone 280 / 440) with internal scroll; long lines scroll, never wrap.
const theme = EditorView.theme({
  '&': { color: 'var(--sr-text-primary)', backgroundColor: 'var(--sr-surface-well)', fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'var(--sr-font-mono)', lineHeight: '24px', overflow: 'auto', minHeight: 'var(--code-min-h, 360px)', maxHeight: 'var(--code-max-h, 560px)' },
  '.cm-content': { fontFamily: 'var(--sr-font-mono)', caretColor: 'var(--sr-text-primary)', padding: '0' },
  '.cm-line': { lineHeight: '24px', padding: '0 12px 0 8px' },
  '.cm-content:focus-visible': { outline: '2px solid var(--sr-focus)', outlineOffset: '2px' },
  // F3.4 / M18: the sticky gutter sits on the sticky layer (10), not CodeMirror's default 200
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--sr-text-secondary)', border: 'none', fontFamily: 'var(--sr-font-mono)', zIndex: 10 },
  '.cm-gutterElement': { fontSize: '14px', lineHeight: '24px', padding: '0 8px 0 12px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-gutter.cm-lineNumbers .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
  '.cm-activeLine': { backgroundColor: 'var(--sr-surface-panel)' },
  // rerun F002 (F6.17): every gutter number is secondary, the active line's too
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--sr-text-secondary)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--sr-edge-mid)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--sr-text-primary)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
}, { dark: true })

export default function CodeEditor({ value, onChange, label = 'Code', lang = 'go' }: { value: string; onChange: (v: string) => void; label?: string; lang?: 'go' | 'py' }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), drawSelection(), bracketMatching(), EditorState.tabSize.of(4),
          StreamLanguage.define(lang === 'py' ? python : go), syntaxHighlighting(highlight), tabKeys(lang), keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-description': EDITOR_KEYS_HELP, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.updateListener.of(u => { if (u.docChanged) cb.current(u.state.doc.toString()) }),
          theme,
        ],
      }),
    })
    view.current = v
    // F6.17 / triage A11: CodeMirror measures its line heights when it is created; if Space Mono arrives
    // later the gutter keeps the fallback font's heights and its numbers drift (two per line). Measure
    // again once the fonts are ready, and whenever a font finishes loading.
    let live = true
    const remeasure = () => { if (live) v.requestMeasure() }
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    void fonts?.ready.then(remeasure)
    fonts?.addEventListener?.('loadingdone', remeasure)
    // and once the editor has a real box (it can mount before its lazily loaded stylesheet applies)
    const raf = typeof requestAnimationFrame === 'undefined' ? 0 : requestAnimationFrame(remeasure)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
    ro?.observe(v.dom)
    return () => {
      live = false
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      fonts?.removeEventListener?.('loadingdone', remeasure)
      v.destroy()
      view.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A value from outside (the saved code arriving after mount) replaces the document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} className="code-editor" data-testid="code-editor" />
}
