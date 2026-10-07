import { useCallback, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { KIT_GRID } from '../../../content/diagramKit'

export interface PointerOpts {
  locked: boolean
  /** node drag only in 2D */
  enabled: boolean
  canvasRef: RefObject<HTMLDivElement>
  onMove: (id: string, dx: number, dy: number) => void
  onSelect: (id: string) => void
  onLinkStart: (id: string) => void
  onLinkEnd: (from: string, to: string | null) => void
}

export interface PointerEditing {
  dragOffset: { id: string; dx: number; dy: number } | null
  nodeHandlers: (id: string) => {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void
    onPointerMove: (e: RPointerEvent<HTMLElement>) => void
    onPointerUp: (e: RPointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
  }
  /** true once after a drag, so the click that follows a drag does not also select or link */
  consumeClick: () => boolean
  onPortPointerDown: (e: RPointerEvent<HTMLElement>, id: string) => void
  cellAt: (clientX: number, clientY: number) => { x: number; y: number } | null
}

/** Pointer events (not HTML5 drag and drop) so mouse, pen and Playwright's dragTo all behave the same. */
export function usePointerEditing(opts: PointerOpts): PointerEditing {
  const latest = useRef(opts)
  latest.current = opts
  const [dragOffset, setDragOffset] = useState<PointerEditing['dragOffset']>(null)
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const swallow = useRef(false)

  const cellAt = useCallback((clientX: number, clientY: number) => {
    const el = latest.current.canvasRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null
    // Offset is measured from the canvas's own border box (matching how a drop position is
    // described, e.g. Playwright's `targetPosition`) plus any scroll — not the content box, so a
    // border's width doesn't shift a boundary offset (e.g. 240) down into the previous cell.
    return {
      x: Math.max(0, Math.floor((clientX - r.left + el.scrollLeft) / KIT_GRID)),
      y: Math.max(0, Math.floor((clientY - r.top + el.scrollTop) / KIT_GRID)),
    }
  }, [])

  const nodeHandlers = (id: string) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      swallow.current = false
      const o = latest.current
      if (o.locked || !o.enabled || e.button !== 0) return
      drag.current = { id, x: e.clientX, y: e.clientY, moved: false }
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const g = drag.current
      if (!g || g.id !== id) return
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
      if (g.moved) setDragOffset({ id, dx, dy })
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const g = drag.current
      drag.current = null
      setDragOffset(null)
      if (!g || !g.moved) return
      swallow.current = true
      const cx = Math.round((e.clientX - g.x) / KIT_GRID)
      const cy = Math.round((e.clientY - g.y) / KIT_GRID)
      latest.current.onSelect(id)
      if (cx || cy) latest.current.onMove(id, cx, cy)
    },
    onPointerCancel: () => {
      drag.current = null
      setDragOffset(null)
    },
  })

  const consumeClick = () => {
    const s = swallow.current
    swallow.current = false
    return s
  }

  const onPortPointerDown = (e: RPointerEvent<HTMLElement>, id: string) => {
    if (latest.current.locked || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    latest.current.onLinkStart(id)
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up)
      const hit = (document.elementsFromPoint?.(ev.clientX, ev.clientY) ?? [])
        .map(el => (el as HTMLElement).dataset?.nodeId)
        .find((v): v is string => !!v)
      latest.current.onLinkEnd(id, hit && hit !== id ? hit : null)
    }
    window.addEventListener('pointerup', up)
  }

  return { dragOffset, nodeHandlers, consumeClick, onPortPointerDown, cellAt }
}
