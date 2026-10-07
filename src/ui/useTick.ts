import { useCallback } from 'react'
import { useDb } from '../app/providers'
import { moveTicket, type ActionResult } from '../data/boardActions'
import { safeWrite } from '../data/safeWrite'
import type { Ticket } from '../data/types'
import { now } from '../lib/clock'
import { openCheck } from '../lib/checkGate'
import { useFlash, usePowerUp, useToast } from './primitives'

/** Tick (→ done) or untick (→ todo) exactly as the Board does; a tick flashes, powers Pom up and toasts "+N xp · Saved". */
export function useTick(): (t: Ticket) => Promise<ActionResult | undefined> {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  return useCallback(
    async (t: Ticket) => {
      const to = t.status === 'done' ? 'todo' : 'done'
      const res = await safeWrite(() => moveTicket(d, t.id, to, now()), m => toast(m, 'danger'))
      if (!res) return res
      if (!res.ok) {
        if (res.reason === 'check_required') { openCheck(t.id); return res }
        if (res.message) toast(res.message, 'danger')
        return res
      }
      if (res.xpDelta > 0) {
        flash()
        powerUp()
        toast(`+${res.xpDelta} xp · Saved`)
      }
      return res
    },
    [d, toast, flash, powerUp],
  )
}
