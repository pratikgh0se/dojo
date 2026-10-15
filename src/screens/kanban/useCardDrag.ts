import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { KColumn } from '../../rules/kanban'

/** BOARD-16: a press that moves the pointer no further than this is a click, not a drag. */
export const DRAG_SLOP_PX = 6
/** BOARD-47: on a touch screen a card drag starts only after a press held about this long; a swipe before that scrolls the board. */
export const TOUCH_HOLD_MS = 250
const EDGE_ZONE_PX = 56
const EDGE_STEP_PX = 18

export interface DragState { id: string; title: string; x: number; y: number; over: KColumn | null }

/** The column under a point (each column element is `.kb-col` with its `data-column`). */
export function columnAt(x: number, y: number): KColumn | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const col = el.closest('.kb-col')?.getAttribute('data-column')
    if (col) return col as KColumn
  }
  return null
}

/**
 * Pointer-event drag for the Board's cards (BOARD-17): a mouse starts a drag once it moves past the slop; a finger starts one after a
 * short hold and a swipe before it scrolls instead. The drop reports the column under the pointer at release (null outside every column).
 * `suppressClick()` is true just after a drag ended, so the click that follows a release does not open the card.
 */
export function useCardDrag(o: { enabled: boolean; scroller: RefObject<HTMLElement>; onDrop: (id: string, to: KColumn | null) => void }) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const suppress = useRef(false)
  const stop = useRef<(() => void) | null>(null)
  const latest = useRef(o)
  latest.current = o
  useEffect(() => () => stop.current?.(), [])
  // the click that follows a drag's release is swallowed; a new press ends that, so a click right after never goes missing
  useEffect(() => {
    const reset = () => { suppress.current = false }
    window.addEventListener('pointerdown', reset, true)
    return () => window.removeEventListener('pointerdown', reset, true)
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent, id: string, title: string) => {
    if (!latest.current.enabled || e.button !== 0 || !e.isPrimary) return
    if ((e.target as Element).closest('[data-nodrag]')) return
    stop.current?.()
    const pointerId = e.pointerId
    const touch = e.pointerType === 'touch'
    const startX = e.clientX
    const startY = e.clientY
    let x = startX
    let y = startY
    let active = false
    let hold = 0
    let edge = 0
    const prevent = (ev: TouchEvent) => { if (ev.cancelable) ev.preventDefault() }
    const tick = () => {
      const sc = latest.current.scroller.current
      if (!sc) return
      const r = sc.getBoundingClientRect()
      if (x < r.left + EDGE_ZONE_PX) sc.scrollLeft -= EDGE_STEP_PX
      else if (x > r.right - EDGE_ZONE_PX) sc.scrollLeft += EDGE_STEP_PX
      else return
      setDrag(d => (d ? { ...d, over: columnAt(x, y) } : d))
    }
    const begin = () => {
      active = true
      suppress.current = true
      document.body.classList.add('kb-dragging')
      document.addEventListener('touchmove', prevent, { passive: false })
      edge = window.setInterval(tick, 40)
      setDrag({ id, title, x, y, over: columnAt(x, y) })
    }
    const end = () => {
      window.clearTimeout(hold)
      window.clearInterval(edge)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.removeEventListener('touchmove', prevent)
      document.body.classList.remove('kb-dragging')
      setDrag(null)
      stop.current = null
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      x = ev.clientX
      y = ev.clientY
      if (!active) {
        if (Math.hypot(x - startX, y - startY) <= DRAG_SLOP_PX) return
        if (touch) { end(); return } // a swipe before the hold: the board scrolls
        begin()
      }
      setDrag(d => (d ? { ...d, x, y, over: columnAt(x, y) } : d))
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      x = ev.clientX
      y = ev.clientY
      const was = active
      const over = was ? columnAt(x, y) : null
      end()
      if (was) {
        window.setTimeout(() => { suppress.current = false }, 400)
        latest.current.onDrop(id, over)
      }
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const was = active
      end()
      if (was) window.setTimeout(() => { suppress.current = false }, 400)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    if (touch) hold = window.setTimeout(begin, TOUCH_HOLD_MS)
    stop.current = end
  }, [])

  return { drag, onPointerDown, suppressClick: () => suppress.current }
}
