import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useDb } from '../../app/providers'
import { safeWrite } from '../../data/safeWrite'
import type { Ticket } from '../../data/types'
import { moveToSprint, setPinned } from '../../data/workloadActions'
import { now } from '../../lib/clock'
import { Button, useToast } from '../../ui/primitives'
import './brief.css'

/**
 * Always-visible tools on a Board card (the hover rail hides its buttons): Pin, which keeps rebalancing
 * away from the card, and "Move to sprint…", a menu of sprints (Addendum 1 Q12, Q13).
 */
export function CardTools({ ticket, lastSprint }: { ticket: Ticket; lastSprint: number }) {
  const d = useDb()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const onError = (m: string) => toast(m, 'danger')

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    // shell-today-board A3: Esc closes the menu wherever focus is (WebKit never focuses a clicked button)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      opener.current?.focus()
    }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true) }
  }, [open])

  // A3: opening moves focus to "Sprint <current+1>" (the order stays ascending), else the first item
  useEffect(() => {
    if (!open) return
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    ;(items.find(b => b.dataset.sprint === String(ticket.sprint + 1)) ?? items[0])?.focus()
  }, [open, ticket.sprint])

  function onMenuKey(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    e.preventDefault()
    items[j]?.focus()
  }

  if (ticket.status === 'done') return null

  async function move(to: number) {
    setOpen(false)
    opener.current?.focus()
    const r = await safeWrite(() => moveToSprint(d, ticket.id, to, now()), onError)
    if (!r) return
    if (!r.ok) toast(r.message, 'warn')
  }

  return (
    <div className="bd-tools" ref={box}>
      <Button className="pin-btn" aria-pressed={!!ticket.pinned} onClick={() => void safeWrite(() => setPinned(d, ticket.id, !ticket.pinned), onError)}>
        {ticket.pinned ? 'Unpin' : 'Pin'}
      </Button>
      <Button ref={opener} aria-haspopup="menu" aria-expanded={open} title="Move to sprint…" onClick={() => setOpen(o => !o)}>Move to sprint…</Button>
      {open && (
        <div className="bd-menu sc" role="menu" aria-label="Move to sprint" ref={menu} onKeyDown={onMenuKey}>
          {Array.from({ length: lastSprint }, (_, i) => i + 1).filter(n => n !== ticket.sprint).map(n => (
            <Button key={n} role="menuitem" data-sprint={n} onClick={() => void move(n)}>Sprint {n}</Button>
          ))}
        </div>
      )}
    </div>
  )
}
