import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { KIT_FAMILIES, KIT_KINDS } from '../../../content/diagramKit'

/** Toolbar of `Add <kind>` buttons in family groups; one tab stop, arrows move (roving tabindex); drag a button onto the canvas to place it. */
export function Palette({
  locked, onAdd, onDrop,
}: { locked: boolean; onAdd: (kind: string) => void; onDrop: (kind: string, clientX: number, clientY: number) => void }) {
  const [active, setActive] = useState<string>(KIT_KINDS[0])
  const [ghost, setGhost] = useState<{ kind: string; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: string; x: number; y: number; moved: boolean } | null>(null)
  const swallow = useRef(false)

  const focusKind = (k: string) => {
    setActive(k)
    ref.current?.querySelector<HTMLButtonElement>(`[data-kind="${k}"]`)?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = KIT_KINDS.indexOf(active)
    const to: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: KIT_KINDS.length - 1 }
    if (!(e.key in to)) return
    e.preventDefault()
    focusKind(KIT_KINDS[Math.max(0, Math.min(KIT_KINDS.length - 1, to[e.key]))])
  }
  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>, kind: string) => {
    swallow.current = false
    if (locked || e.button !== 0) return
    drag.current = { kind, x: e.clientX, y: e.clientY, moved: false }
    const move = (ev: PointerEvent) => {
      const g = drag.current
      if (!g) return
      if (Math.abs(ev.clientX - g.x) + Math.abs(ev.clientY - g.y) > 4) g.moved = true
      if (g.moved) setGhost({ kind: g.kind, x: ev.clientX, y: ev.clientY })
    }
    // Same cleanup for a normal release and for a cancelled gesture (e.g. the OS takes over for a
    // system gesture mid-drag): only 'pointerup' should ever complete the drop.
    const end = (ev: PointerEvent, dropped: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const g = drag.current
      drag.current = null
      setGhost(null)
      if (!dropped || !g?.moved) return
      swallow.current = true
      onDrop(g.kind, ev.clientX, ev.clientY)
    }
    const up = (ev: PointerEvent) => end(ev, true)
    const cancel = (ev: PointerEvent) => end(ev, false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
  return (
    // The toolbar's buttons use roving tabindex (only the active one is in tab order), so the
    // overflow-x scroller can't rely on a child for keyboard reach at narrow widths (D-59, axe
    // `scrollable-region-focusable`): it gets its own tabindex and name instead of the toolbar
    // itself becoming the scroll container.
    <div
      className="kit-palette sc" data-testid="kit-palette" tabIndex={0} role="region" aria-label="Node palette"
    >
      <div ref={ref} role="toolbar" aria-label="Node palette" className="kit-palette-toolbar" onKeyDown={onKey}>
        {KIT_FAMILIES.map(f => (
          <div key={f.family} role="group" aria-label={f.family} className="kit-family" data-testid={`kit-family-${f.family}`} data-family={f.family}>
            <span className="kit-family-name" aria-hidden="true">{f.family}</span>
            {f.kinds.map(k => (
              <button
                key={k} type="button" className="kit-kind" data-kind={k} aria-label={`Add ${k}`}
                tabIndex={k === active ? 0 : -1} disabled={locked}
                onFocus={() => setActive(k)} onPointerDown={e => onPointerDown(e, k)}
                onClick={() => { if (swallow.current) { swallow.current = false; return } onAdd(k) }}
              >
                {k}
              </button>
            ))}
          </div>
        ))}
        {ghost && <span className="kit-ghost" aria-hidden="true" style={{ left: ghost.x + 8, top: ghost.y + 8 }}>{ghost.kind}</span>}
      </div>
    </div>
  )
}
