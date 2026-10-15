import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Glyph } from '../../ui/Glyph'

/**
 * The gear: Settings, Guide and the shortcuts overlay (SHELL-14). Esc closes it and puts focus back on the gear; a route
 * change, a click elsewhere and focus leaving it close it too. The links are plain router links (the screen switches at once, R18).
 */
export function GearMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const key = useLocation().key
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pointerIn = useRef(false) // a mouse/touch press is in progress inside the gear
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const down = (e: globalThis.MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const up = () => { pointerIn.current = false }
    document.addEventListener('mousedown', down)
    document.addEventListener('mouseup', up)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up); pointerIn.current = false }
  }, [open])
  useEffect(() => { setOpen(false) }, [key])
  const close = (restore: boolean) => { setOpen(false); if (restore) btn.current?.focus() }
  const move = (dir: 1 | -1) => {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + dir + items.length) % items.length]?.focus()
  }
  return (
    <div className="sh-gear" ref={root}
      // Safari (and iOS/iPadOS) does not focus a link or button on mousedown, so the focused item blurs with relatedTarget null
      // before the click lands: a blur during a press inside the gear is not focus leaving it.
      onMouseDown={() => { pointerIn.current = true }}
      onBlur={e => { if (open && !pointerIn.current && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false) }}
    >
      <button ref={btn} type="button" className="sh-ibtn" data-testid="shell-gear" aria-label="Settings and help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Glyph name="build" size={3} />
      </button>
      {open && (
        <div
          className="sh-menu sr-panel" role="menu" aria-label="Settings and help" data-testid="shell-gear-menu"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); close(true) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
          }}
        >
          <Link role="menuitem" className="sh-mi" data-testid="shell-menu-settings" to="/settings" onClick={() => close(false)}><Glyph name="build" size={3} />Settings</Link>
          <Link role="menuitem" className="sh-mi" data-testid="shell-menu-guide" to="/guide" onClick={() => close(false)}><Glyph name="info" size={3} />Guide</Link>
          <button type="button" role="menuitem" className="sh-mi" data-testid="shell-menu-shortcuts" onClick={() => { close(true); onShortcuts() }}><Glyph name="terminal" size={3} />Shortcuts <span className="sh-key mono">?</span></button>
        </div>
      )}
    </div>
  )
}
