import { useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isCoarsePointer, isTextEntry } from '../../lib/coarsePointer'
import './projects.css'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

// Background inert while any Dialog is open: everything under document.body that isn't a dialog's
// own portal (the rest of the app, and any dialog opened before this one) is unreachable to
// pointer, the a11y tree and Tab, without hiding it. A shared open-dialog count plus a full
// recompute from the live DOM (rather than each instance snapshotting+restoring its own siblings)
// keeps this correct even when nested dialogs (e.g. a confirm inside the artifact dialog) unmount
// together in a single commit, in whichever order their cleanups happen to run.
let openDialogCount = 0
/** shell-today-board A4: open dialogs by open order (render order: a nested confirm renders after its parent). */
const openBackdrops = new Map<Element, number>()
let openSeq = 0

function applyBackgroundInert(): void {
  // Only the most recently opened dialog stays live; a dialog under a nested confirm is inert too.
  let top: Element | null = null
  let best = -1
  for (const [el, order] of openBackdrops) if (el.isConnected && order > best) { best = order; top = el }
  for (const el of document.body.children) {
    if (el instanceof HTMLElement) el.inert = openDialogCount > 0 && el !== top && !el.hasAttribute('data-live-region')
  }
}

export interface DialogProps {
  title: string
  testId?: string
  role?: 'dialog' | 'alertdialog'
  onClose: () => void
  /** Where focus goes when the dialog unmounts; falls back to the element focused before it opened. */
  returnFocus?: () => HTMLElement | null
  /** First element to focus; defaults to the first focusable control. */
  initialFocus?: () => HTMLElement | null
  headerExtra?: ReactNode
  children: ReactNode
}

/**
 * Modal dialog (C-PROJECTS §2.5, §2.8): named by its heading, focus trapped, Esc closes,
 * keys never reach the global shortcut handler (Review Focus #2), focus returns on unmount.
 */
export function Dialog({ title, testId, role = 'dialog', onClose, returnFocus, initialFocus, headerExtra, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [order] = useState(() => ++openSeq)
  const titleId = useId()
  const returnRef = useRef(returnFocus)
  returnRef.current = returnFocus
  const initialRef = useRef(initialFocus)

  // Declared (and so cleaned up) before the focus-restore effect below: an inert ancestor refuses
  // focus() entirely, so un-inerting must happen before we try to return focus to it.
  useEffect(() => {
    const backdrop = ref.current?.parentElement
    openDialogCount++
    if (backdrop) openBackdrops.set(backdrop, order)
    applyBackgroundInert()
    return () => {
      openDialogCount--
      if (backdrop) openBackdrops.delete(backdrop)
      applyBackgroundInert()
    }
  }, [order])

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    if (root) {
      const first = initialRef.current?.() ?? focusables(root)[0] ?? root
      // ruling 18 F3: on touch, never open onto a text field (the keyboard would cover the dialog)
      ;(isCoarsePointer() && isTextEntry(first) ? root : first).focus()
    }
    return () => {
      const target = returnRef.current?.() ?? before
      if (target && target.isConnected) target.focus()
    }
  }, [])

  // A focused control that becomes really `disabled` mid-dialog (e.g. Grade section's Request
  // grade button while its job runs) is blurred straight to <body> by the browser itself — no
  // focusout/focusin fires for it, so it can't be caught that way — which breaks the Tab-trap
  // above and leaves Escape unheard (its keydown handler never fires once focus is outside this
  // subtree). Watch whichever of this dialog's own descendants currently has focus for exactly
  // that transition, and step focus back into the dialog the instant it goes disabled.
  useEffect(() => {
    let observer: MutationObserver | null = null
    function watch(el: Element | null) {
      observer?.disconnect()
      observer = null
      if (!(el instanceof HTMLElement) || !ref.current?.contains(el)) return
      observer = new MutationObserver(() => {
        // UAT cu-r3 A12: focusing the first control scrolled the dialog back to its top when a grade result arrived; keep the scroll.
        if ((el as HTMLButtonElement).disabled) (focusables(ref.current!)[0] ?? ref.current)?.focus({ preventScroll: true })
      })
      observer.observe(el, { attributes: true, attributeFilter: ['disabled'] })
    }
    watch(document.activeElement)
    function onFocusIn(e: FocusEvent) {
      watch(e.target instanceof Element ? e.target : null)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      observer?.disconnect()
    }
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const list = focusables(ref.current)
    if (list.length === 0) {
      e.preventDefault()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // UAT cu-3p P3-16: the dialog's actions row sticks to the bottom of its scroll area (projects.css). A field that takes focus
  // (a Tab to it) is scrolled into view by the browser only when it is wholly out of sight, so one half under the row would
  // stay half under it: bring it clear (scroll-padding on the dialog keeps it above the row).
  function onFocus(e: ReactFocusEvent<HTMLDivElement>) {
    const bar = ref.current?.querySelector<HTMLElement>('.p-actions:not(.p-subsection .p-actions)')
    const t = e.target
    if (!bar || bar.contains(t)) return
    const r = t.getBoundingClientRect()
    const b = bar.getBoundingClientRect()
    if (r.bottom > b.top && r.top < b.bottom) t.scrollIntoView({ block: 'nearest' })
  }

  return createPortal(
    <div className="p-backdrop">
      <div
        ref={ref}
        className={`p-dialog${role === 'alertdialog' ? ' p-alertdialog' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        <div className="p-dialog-head">
          <h2 id={titleId} className="p-dialog-title">{title}</h2>
          {headerExtra}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
