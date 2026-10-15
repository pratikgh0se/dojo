import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { KIT_FAMILIES } from '../../../content/diagramKit'
import { FAMILY_GLYPHS } from './familyGlyphs'

/** The family's representative 7 x 7 glyph (the one the canvas draws for that kind), drawn in the button's text colour. */
function FamilyGlyph({ family }: { family: string }) {
  const rows = FAMILY_GLYPHS[family] ?? []
  return (
    <svg className="kit-fam-glyph" width="21" height="21" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  )
}

/**
 * The palette (mockup 7b, DESIGN-23): one row of family buttons, a divider and the four tools. A family button opens a flyout with that
 * family's `Add <kind>` tiles under it, over the canvas; one family is open at a time. Activating a tile (or dropping a dragged one on the
 * canvas) adds the node and closes the flyout; so do Escape (focus goes back to the family button), the same family again, a click
 * outside the palette and tabbing out of it. Families are one tab stop with the arrows moving between them; inside a flyout the tiles
 * are one tab stop with the arrows moving between them. A tile can be dragged out of the flyout onto the canvas.
 */
export function Palette({
  locked, onAdd, onDrop, tools,
}: { locked: boolean; onAdd: (kind: string) => void; onDrop: (kind: string, clientX: number, clientY: number) => boolean; tools?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const [activeFamily, setActiveFamily] = useState<string>(KIT_FAMILIES[0].family)
  const [activeKind, setActiveKind] = useState<string>(KIT_FAMILIES[0].kinds[0])
  const [left, setLeft] = useState(0)
  const [ghost, setGhost] = useState<{ kind: string; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const flyout = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: string; x: number; y: number; moved: boolean } | null>(null)
  const swallow = useRef(false)
  const families = KIT_FAMILIES.map(f => f.family)
  const openFamily = KIT_FAMILIES.find(f => f.family === open) ?? null

  const familyButton = (f: string) => ref.current?.querySelector<HTMLButtonElement>(`[data-testid="kit-family-${f}"]`) ?? null
  const close = (refocus: boolean) => {
    const f = open
    setOpen(null)
    if (refocus && f) familyButton(f)?.focus()
  }
  const toggle = (f: string) => {
    setActiveFamily(f)
    if (open === f) { setOpen(null); return }
    setActiveKind(KIT_FAMILIES.find(x => x.family === f)!.kinds[0])
    setOpen(f)
  }

  // Anchor the flyout under its button, kept inside the palette's width (a phone's flyout is full width in the flow, kit.css).
  useLayoutEffect(() => {
    if (!open) return
    const root = ref.current
    const btn = familyButton(open)
    const fly = flyout.current
    if (!root || !btn || !fly) return
    const r = root.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    setLeft(Math.max(0, Math.min(b.left - r.left, r.width - fly.offsetWidth)))
  }, [open])
  // Focus moves into the flyout when it opens, so Enter and the arrows work at once.
  useEffect(() => {
    if (open) flyout.current?.querySelector<HTMLButtonElement>(`[data-kind="${activeKind}"]`)?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // A press outside the palette closes the flyout; so does a locked canvas.
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(null) }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open])
  useEffect(() => { if (locked) setOpen(null) }, [locked])

  const onFamilyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = families.indexOf(activeFamily)
    const to: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: families.length - 1 }
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      flyout.current?.querySelector<HTMLButtonElement>(`[data-kind="${activeKind}"]`)?.focus()
      return
    }
    if (!(e.key in to)) return
    e.preventDefault()
    const f = families[Math.max(0, Math.min(families.length - 1, to[e.key]))]
    setActiveFamily(f)
    familyButton(f)?.focus()
  }
  const onTileKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!openFamily) return
    const kinds = openFamily.kinds
    const i = kinds.indexOf(activeKind)
    const to: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: kinds.length - 1 }
    if (!(e.key in to)) return
    e.preventDefault()
    const k = kinds[Math.max(0, Math.min(kinds.length - 1, to[e.key]))]
    setActiveKind(k)
    flyout.current?.querySelector<HTMLButtonElement>(`[data-kind="${k}"]`)?.focus()
  }
  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(true) }
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
      if (onDrop(g.kind, ev.clientX, ev.clientY)) setOpen(null)
    }
    const up = (ev: PointerEvent) => end(ev, true)
    const cancel = (ev: PointerEvent) => end(ev, false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
  return (
    // The row of families and tools is the scroller on a phone (it is one tab stop through its family buttons, so axe's
    // `scrollable-region-focusable` holds); the flyout sits outside it so the row never clips it.
    <div
      ref={ref} className="kit-palette" data-testid="kit-palette" role="region" aria-label="Node palette"
      onKeyDown={onRootKey} onBlur={e => { if (open && e.relatedTarget instanceof Node && !ref.current?.contains(e.relatedTarget)) setOpen(null) }}
    >
      <div className="kit-palette-row sc">
        <div role="toolbar" aria-label="Kit families" className="kit-families" onKeyDown={onFamilyKey}>
          {KIT_FAMILIES.map(f => (
            <button
              key={f.family} type="button" className="kit-fam" data-family={f.family} data-testid={`kit-family-${f.family}`}
              aria-label={f.family} title={f.family} aria-expanded={open === f.family} aria-controls={open === f.family ? 'kit-flyout' : undefined}
              tabIndex={f.family === activeFamily ? 0 : -1} disabled={locked}
              onFocus={() => setActiveFamily(f.family)} onClick={() => toggle(f.family)}
            >
              <FamilyGlyph family={f.family} />
            </button>
          ))}
        </div>
        <span className="kit-sep" aria-hidden="true" />
        {tools}
      </div>
      {openFamily && (
        <div
          ref={flyout} id="kit-flyout" role="toolbar" aria-label={`${openFamily.family} nodes`} className="kit-flyout" data-testid="kit-flyout"
          data-family={openFamily.family} style={{ left }} onKeyDown={onTileKey}
        >
          <span className="kit-flyout-name" aria-hidden="true">{openFamily.family}</span>
          {openFamily.kinds.map(k => (
            <button
              key={k} type="button" className="kit-kind" data-kind={k} data-testid={`kit-tile-${k}`} aria-label={`Add ${k}`} title={k}
              tabIndex={k === activeKind ? 0 : -1} disabled={locked}
              onFocus={() => setActiveKind(k)} onPointerDown={e => onPointerDown(e, k)}
              onClick={() => { if (swallow.current) { swallow.current = false; return } onAdd(k); setOpen(null) }}
            >
              {k}
            </button>
          ))}
        </div>
      )}
      {ghost && <span className="kit-ghost" aria-hidden="true" style={{ left: ghost.x + 8, top: ghost.y + 8 }}>{ghost.kind}</span>}
    </div>
  )
}
