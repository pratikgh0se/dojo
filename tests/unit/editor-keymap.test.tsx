// UAT cu-4 P2-1: Tab indents in the Go and Python editors, Shift+Tab outdents, and Escape then Tab is the way out.
import { fireEvent, render } from '@testing-library/react'
import { defaultKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import CodeEditor from '../../src/runner/CodeEditor'
import { EDITOR_KEYS_HELP, escapeArmsTab, indentOf, insertIndent, outdent, tabKeymap, tabKeys } from '../../src/runner/editorKeymap'

let views: EditorView[] = []
afterEach(() => { views.forEach(v => v.destroy()); views = [] })

function editor(doc: string, lang: 'go' | 'py', sel?: { anchor: number; head?: number }) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc, selection: sel ? EditorSelection.single(sel.anchor, sel.head) : undefined,
      extensions: [EditorState.tabSize.of(4), tabKeys(lang), keymap.of(defaultKeymap)],
    }),
  })
  views.push(view)
  return view
}
const key = (view: EditorView, k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(view.contentDOM, { key: k, code: k === 'Tab' ? 'Tab' : k, keyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 0, ...init })

describe('the keymap', () => {
  it('binds Tab, Shift+Tab and Escape, in that order of importance, and nothing that moves focus', () => {
    expect(tabKeymap.map(b => b.key)).toEqual(['Escape', 'Tab', 'Shift-Tab'])
    expect(indentOf('go')).toBe('\t')
    expect(indentOf('py')).toBe('    ')
    expect(EDITOR_KEYS_HELP).toMatch(/Tab indents/)
    expect(EDITOR_KEYS_HELP).toMatch(/Escape, then Tab/)
  })

  it('Tab at a caret inserts one tab in Go, at the caret, and keeps the caret after it', () => {
    const v = editor('func f() {\n}\n', 'go', { anchor: 11 })
    expect(insertIndent(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('func f() {\n\t}\n')
    expect(v.state.selection.main.head).toBe(12)
  })

  it('Tab in Python inserts spaces up to the next stop of four, whatever column the caret is in', () => {
    const v = editor('if x:\n  y', 'py', { anchor: 9 }) // column 3 on line 2
    insertIndent(v)
    expect(v.state.doc.toString()).toBe('if x:\n  y ')
    const w = editor('x', 'py', { anchor: 0 })
    insertIndent(w)
    expect(w.state.doc.toString()).toBe('    x')
  })

  it('Tab with several lines selected indents every one of them; Shift+Tab takes it back', () => {
    const v = editor('a\nb\nc', 'go', { anchor: 0, head: 5 })
    insertIndent(v)
    expect(v.state.doc.toString()).toBe('\ta\n\tb\n\tc')
    outdent(v)
    expect(v.state.doc.toString()).toBe('a\nb\nc')
  })

  it('Shift+Tab on a line with no indent is consumed and changes nothing', () => {
    const v = editor('a', 'go', { anchor: 0 })
    expect(outdent(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('a')
  })

  it('Tab typed into a real editor changes the text and the event is handled (the browser never moves focus)', () => {
    const v = editor('x', 'go', { anchor: 0 })
    v.focus()
    const notPrevented = key(v, 'Tab')
    expect(notPrevented).toBe(false) // preventDefault was called: the browser keeps focus where it is
    expect(v.state.doc.toString()).toBe('\tx')
    expect(key(v, 'Tab', { shiftKey: true })).toBe(false)
    expect(v.state.doc.toString()).toBe('x')
  })

  it('Escape is consumed (Do never sees it) and arms the way out; the very next Tab is left to the browser', () => {
    const v = editor('x', 'go', { anchor: 0 })
    expect(key(v, 'Escape')).toBe(false)
    // inside the window a Tab is not handled: no preventDefault, no indent, so focus moves on to Run
    expect(key(v, 'Tab')).toBe(true)
    expect(v.state.doc.toString()).toBe('x')
  })

  it('without the Escape, a Tab still indents (the way out is not on by default)', () => {
    const v = editor('x', 'go', { anchor: 0 })
    expect(key(v, 'Tab')).toBe(false)
    expect(v.state.doc.toString()).toBe('\tx')
  })

  it('a key typed after Escape closes the window again: Tab indents', () => {
    const v = editor('x', 'go', { anchor: 0 })
    key(v, 'Escape')
    key(v, 'ArrowRight', { keyCode: 39 }) // the caret moves to the end of "x"
    expect(key(v, 'Tab')).toBe(false)
    expect(v.state.doc.toString()).toBe('x\t')
  })

  it('Escape with a selection collapses it and still arms the way out', () => {
    const v = editor('abc', 'go', { anchor: 0, head: 3 })
    expect(escapeArmsTab(v)).toBe(true)
    expect(v.state.selection.main.empty).toBe(true)
    expect(key(v, 'Tab')).toBe(true)
  })
})

describe('the editor component', () => {
  it('names itself "Code", says how to leave it, and indents on Tab', () => {
    let text = 'a'
    const { container } = render(<CodeEditor value={text} onChange={v => { text = v }} lang="go" />)
    const content = container.querySelector<HTMLElement>('.cm-content')!
    expect(content).toHaveAttribute('aria-label', 'Code')
    expect(content).toHaveAttribute('aria-description', EDITOR_KEYS_HELP)
    content.focus()
    fireEvent.keyDown(content, { key: 'Tab', code: 'Tab', keyCode: 9 })
    expect(text).toBe('\ta')
  })
})
