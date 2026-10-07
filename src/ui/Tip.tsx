import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A tooltip the page draws itself, for the few controls whose `title` has to be seen (UAT cu-3 P2-1 the Undo button,
 * P3-4 the Week "↻ again" chip). The native `title` tooltip is the operating system's: in the desktop app it did not
 * appear for these two on a real hover. So such an element keeps its `title` (the native tooltip, and the description a
 * screen reader reads; the Undo button has the same words as its `aria-label` too) and gains `data-tip`: the page then
 * shows the same words in a small bubble just under the element, once the pointer has been on it a moment or at once on
 * keyboard focus. The bubble sits below the element, never over it, so it can never take the pointer from it.
 */
export const TIP_DELAY_MS = 350

/**
 * The attributes a control with a seen tooltip carries: the `data-tip` the bubble reads, and the same words as its
 * accessible description. NOT a native `title`: the operating system draws its own tooltip from a `title` after a
 * moment, so the pointer would see two boxes (UAT cu-final rows 1, 4, 9). `side: 'above'` puts it over the element (for one with controls beside and below it); `side: 'right'` puts the bubble beside the
 * element instead of under it, for a control with other controls below it (the Do timer, Retreat).
 */
export const tipProps = (text: string, side?: 'right' | 'above'): { 'data-tip': string; 'aria-description': string; 'data-tip-side'?: 'right' | 'above' } =>
  ({ 'data-tip': text, 'aria-description': text, ...(side ? { 'data-tip-side': side } : {}) })

/** Focus that came by keyboard (a click that focuses a button shows no tooltip); an engine without :focus-visible says yes. */
function keyboardFocused(el: HTMLElement): boolean {
  try { return el.matches(':focus-visible') } catch { return true }
}

const SIDE = 8
const GAP = 6

function Bubble({ text, anchor, side }: { text: string; anchor: DOMRect; side?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (side === 'right' && anchor.right + GAP + w <= window.innerWidth - SIDE) {
      // beside the element, level with its top: nothing under it is covered
      setPos({ left: anchor.right + GAP, top: Math.max(SIDE, Math.min(anchor.top, window.innerHeight - h - SIDE)) })
      return
    }
    if (side === 'above' && anchor.top - GAP - h >= SIDE) {
      // over the element, for one whose neighbours below and beside are controls (the Do "This attempt" line, UAT cu-final2 row 1)
      setPos({ left: Math.max(SIDE, Math.min(anchor.left, window.innerWidth - w - SIDE)), top: anchor.top - GAP - h })
      return
    }
    const left = Math.max(SIDE, Math.min(anchor.left, window.innerWidth - w - SIDE))
    const below = anchor.bottom + GAP
    const top = below + h > window.innerHeight - SIDE && anchor.top - GAP - h >= SIDE ? anchor.top - GAP - h : below
    setPos({ left, top })
  }, [text, anchor, side])
  return createPortal(
    <div ref={ref} className="tip" data-testid="tip" aria-hidden="true" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {text}
    </div>,
    document.body,
  )
}

/** Mounted once in the Shell: shows the `data-tip` text of the element the pointer rests on or the keyboard has reached. */
export function TipHost() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect; side?: string } | null>(null)
  useEffect(() => {
    let timer: number | undefined
    let target: HTMLElement | null = null
    // A click or a key press dismisses the bubble for as long as the pointer stays still; the resting-pointer probe below
    // must not bring it straight back.
    let dismissed = false
    let shown = false
    const hide = () => {
      window.clearTimeout(timer)
      target = null
      shown = false
      setTip(null)
    }
    const dismiss = () => { dismissed = true; hide() }
    const show = (el: HTMLElement, delay: number) => {
      window.clearTimeout(timer)
      target = el
      const open = () => {
        const text = el.dataset.tip
        if (text && el.isConnected) { shown = true; setTip({ text, anchor: el.getBoundingClientRect(), side: el.dataset.tipSide }) }
        else target = null // nothing was shown: let the next move or probe start it again
      }
      if (delay > 0) timer = window.setTimeout(() => { timer = undefined; open() }, delay)
      else open()
    }
    const holder = (n: EventTarget | null): HTMLElement | null => (n instanceof Element ? n.closest<HTMLElement>('[data-tip]') : null)
    let pt: { x: number; y: number } | null = null
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (e.type === 'pointermove' && pt && pt.x === e.clientX && pt.y === e.clientY) return
      if (e.type === 'pointermove') dismissed = false
      pt = { x: e.clientX, y: e.clientY }
      armPoll()
      const el = holder(e.target)
      if (el === target && (shown || timer !== undefined)) return
      if (el) show(el, TIP_DELAY_MS)
      else hide()
    }
    // UAT cu-r1 A21/A43: a control that appears (Retreat after Spar starts) or turns enabled (Undo after a move) under a
    // pointer that is already resting there gets no pointerover. So when the page changes, look at what is under the
    // last known pointer position and, if it carries a tip nobody is showing, start it.
    let raf = 0
    const probe = () => {
      raf = 0
      if (!pt || target || dismissed) return
      const el = typeof document.elementFromPoint === 'function' ? holder(document.elementFromPoint(pt.x, pt.y)) : null
      if (el) show(el, TIP_DELAY_MS)
    }
    // Safety net: a pointer that rests on a control whose tip is not up gets it, whatever event was missed or swallowed
    // (UAT cu-final2 rows 1, 2, 4: a real resting cursor on small targets saw nothing).
    // It runs only for a few seconds after the last pointer event, then stops: a permanent interval would keep waking the
    // page for nothing (and a fake clock in the e2e suite pays for every extra timer it has to fire).
    let poll: number | undefined
    let pollLeft = 0
    const armPoll = () => {
      pollLeft = 12
      if (poll === undefined) poll = window.setInterval(() => {
        if (--pollLeft <= 0) { window.clearInterval(poll); poll = undefined }
        if (!raf && pt && !target && !dismissed) raf = window.requestAnimationFrame(probe)
      }, 400)
    }
    const mo = new MutationObserver(() => { if (!raf && pt && !target) raf = window.requestAnimationFrame(probe) })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'data-tip'] })
    const onOut = (e: PointerEvent) => { if (!e.relatedTarget) { pt = null; hide() } } // the pointer left the window
    const onFocus = (e: FocusEvent) => {
      const el = holder(e.target)
      if (el && keyboardFocused(el)) show(el, 0)
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointermove', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    // Only a scroll that moves the anchor (the page, or a container holding it) hides the bubble; an unrelated pane scrolling
    // used to take it away for good from a pointer that was not moving.
    const onScroll = (e: Event) => {
      const sc = e.target
      if (!target || !(sc instanceof Node) || sc === document || sc.contains(target)) hide()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      mo.disconnect()
      if (raf) window.cancelAnimationFrame(raf)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointermove', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
  return tip ? <Bubble text={tip.text} anchor={tip.anchor} side={tip.side} /> : null
}
