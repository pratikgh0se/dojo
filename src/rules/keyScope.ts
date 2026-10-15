/** Where the global keys (1 to 6, ?) must stay out of the way: text fields, editors and the design canvas. */
const SCOPES = '[data-no-global-keys], [data-testid="kit-canvas"], .cm-editor, [role="textbox"], [role="combobox"]'

type KeyLike = Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'ctrlKey' | 'metaKey' | 'altKey'> & { isComposing?: boolean }

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true
}

/** True when a plain key press should not be taken as a shortcut. */
export function globalKeyBlocked(e: KeyLike): boolean {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return true
  if (isTypingTarget(e.target)) return true
  // Element, not HTMLElement: a node drawn inside the canvas SVG takes focus too.
  return e.target instanceof Element && e.target.closest(SCOPES) !== null
}

/** Another dialog is open (a restore confirm, an artifact dialog) or Today's pick list: the digits and `?` must not act behind it. */
export const MODAL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-testid="today-pick-list"]'
export const modalOpen = (): boolean => typeof document !== 'undefined' && document.querySelector(MODAL) !== null

/** Ctrl+K or Cmd+K. It works inside text fields on purpose. */
export const isPaletteKey = (e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'

/**
 * PATH-10: "/" pressed on /path before Path's chunk and queue have loaded. The shell sees the key (it is always mounted) and
 * leaves a note; Path takes it when its search box is drawn. The note ends after a few seconds so a stale press never
 * steals focus later.
 */
let pathSearchAsked = 0
const PATH_SEARCH_ASK_MS = 8000
export function askPathSearch(): void { pathSearchAsked = Date.now() }
export function takePathSearchAsk(): boolean {
  const asked = pathSearchAsked !== 0 && Date.now() - pathSearchAsked < PATH_SEARCH_ASK_MS
  pathSearchAsked = 0
  return asked
}
