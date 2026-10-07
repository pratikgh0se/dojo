// Controller ruling 18 F3: on touch devices (`pointer: coarse`) moving focus into a text field when a dialog or focus
// mode opens pops the on-screen keyboard over it. There the dialog itself (or its heading) takes focus instead; a
// desktop keeps the first-field focus.
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

/** True for a control that brings up the on-screen keyboard when focused. */
export function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false
  if ((el as HTMLElement).isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(type)
}
