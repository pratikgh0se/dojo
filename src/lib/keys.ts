export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true
}

export function isActivatable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.closest('button, a[href], [role="button"], [role="option"], [role="listbox"], [tabindex]') !== null
}

/** Controls the browser itself activates with Space (a link is not one: Space scrolls on it). */
export function isSpaceActivated(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.closest(
    'button, summary, input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="menuitem"]',
  ) !== null
}

/** A plain key press (no ctrl, meta or alt), as the app's single-letter shortcuts need. */
export function isPlainKey(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey
}

// A click on blank page background parks focus on <body>; letters typed afterwards are not aimed at any control, so the
// screens' single-letter card shortcuts (d, s, f, space) must not act on them (UAT cu-r2 A2#22). A Tab press, or a
// click or focus on a real control, makes the next keys deliberate again.
let strayBackground = false
if (typeof window !== 'undefined') {
  const onControl = (t: EventTarget | null) => isTypingTarget(t) || isActivatable(t) || (t instanceof HTMLElement && t.closest('.cm-editor') !== null)
  window.addEventListener('mousedown', e => { strayBackground = !onControl(e.target) }, true)
  window.addEventListener('focusin', e => { if (onControl(e.target)) strayBackground = false }, true)
  window.addEventListener('keydown', e => { if (e.key === 'Tab') strayBackground = false }, true)
}

/** True while the last pointer press landed on page background and no control has been focused since. */
export function isStrayBackgroundKey(): boolean {
  return strayBackground
}
