import { useEffect, useState } from 'react'
import { useDb } from '../../app/providers'
import { OPEN_CHECK_EVENT } from '../../lib/checkGate'
import { needsCheck } from '../../rules/brief'
import type { Ticket } from '../../data/types'
import { useFlash, usePowerUp, useToast } from '../../ui/primitives'
import { CheckDialog } from './CheckDialog'

/** Opens "Check your understanding" when a completion path asks for it (see lib/checkGate). Lives in the shell, loaded lazily. */
export function CheckGate() {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  useEffect(() => {
    const on = (e: Event) => {
      void d.tickets.get(String((e as CustomEvent).detail)).then(t => { if (t && needsCheck(t)) setTicket(t) })
    }
    window.addEventListener(OPEN_CHECK_EVENT, on)
    return () => window.removeEventListener(OPEN_CHECK_EVENT, on)
  }, [d])
  if (!ticket?.brief) return null
  return (
    <CheckDialog
      ticket={ticket} brief={ticket.brief} onClose={() => setTicket(null)} returnFocus={() => null}
      onDone={xp => { if (xp > 0) { flash(); powerUp(); toast(`+${xp} xp · Saved`) } }}
    />
  )
}
