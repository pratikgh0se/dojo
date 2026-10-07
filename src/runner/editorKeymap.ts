// The code editor's Tab and Escape keys (UAT cu-4 P2-1, F6.17).
//
// Tab indents. In a code editor Tab must never move focus on its own: a learner typing Go indents with it all day,
// and the page's focus order is not the place to look for the next control halfway through a function (cu-4: Tab
// jumped to Run and the next typed characters were lost).
//
// The accessible escape is CodeMirror's own tab-trap convention, kept as it ships:
//   - Escape, then Tab (within 2 s) moves focus on to the next control (Run);
//   - Ctrl+M (Shift+Alt+M on a Mac) turns "Tab moves focus" on and off for as long as the editor lives.
// Escape is consumed by the editor (it only arms the escape and drops a selection), so it never reaches Do's own
// "Esc leaves" key while the caret is in the code; once focus is on Run, Esc leaves as on the rest of the screen.
import { indentLess, indentMore, simplifySelection } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { EditorSelection, type Extension } from '@codemirror/state'
import { keymap, type Command, type KeyBinding } from '@codemirror/view'

/** CodeMirror's own window after Escape in which a Tab leaves the editor; the hint below says the same. */
export const TAB_ESCAPE_MS = 2000

/** What a screen reader hears after the editor's name (aria-description on the textbox). */
export const EDITOR_KEYS_HELP = 'Tab indents and Shift+Tab outdents. To leave the editor with the keyboard, press Escape, then Tab.'

/** Go indents with a tab, Python with four spaces. */
export const indentOf = (lang: 'go' | 'py') => (lang === 'py' ? '    ' : '\t')

/** Tab: nothing selected inserts one indent unit at the caret (a tab in Go, spaces to the next stop in Python); a selection indents its lines. */
export const insertIndent: Command = view => {
  const { state } = view
  if (state.selection.ranges.some(r => !r.empty)) return indentMore(view)
  const unit = state.facet(indentUnit)
  const spec = state.changeByRange(r => {
    const col = r.head - state.doc.lineAt(r.head).from
    const text = unit === '\t' ? '\t' : ' '.repeat(unit.length - (col % unit.length))
    return { changes: { from: r.head, insert: text }, range: EditorSelection.cursor(r.head + text.length) }
  })
  view.dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** Shift+Tab: outdent the caret's line or every selected line. Always consumed, so it never leaves the editor by accident. */
export const outdent: Command = view => {
  indentLess(view)
  return true
}

/** Escape: arm "Escape, then Tab" for TAB_ESCAPE_MS and drop a selection. Always consumed (see the header). */
export const escapeArmsTab: Command = view => {
  view.setTabFocusMode(TAB_ESCAPE_MS)
  simplifySelection(view)
  return true
}

export const tabKeymap: readonly KeyBinding[] = [
  { key: 'Escape', run: escapeArmsTab },
  { key: 'Tab', run: insertIndent },
  { key: 'Shift-Tab', run: outdent },
]

/** The editor's indent unit and its Tab / Shift+Tab / Escape keys. Goes before the default keymap. */
export function tabKeys(lang: 'go' | 'py'): Extension {
  return [indentUnit.of(indentOf(lang)), keymap.of(tabKeymap as KeyBinding[])]
}
