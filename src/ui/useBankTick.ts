import { useCallback } from 'react'
import { useDb } from '../app/providers'
import type { BankTabId } from '../content/banks/meta'
import { toggleBankItem } from '../data/bankActions'
import type { ActionResult } from '../data/boardActions'
import { safeWrite } from '../data/safeWrite'
import { now } from '../lib/clock'
import type { ItemView } from '../rules/banks'
import { currentSprint } from '../rules/sprint'
import { useFlash, usePowerUp, useToast } from './primitives'

/** Tick or untick a bank item exactly like a Board tick: flash, power-up and `+N xp · Saved` on a tick. */
export function useBankTick(startDate: string): (item: ItemView, bank: BankTabId) => Promise<ActionResult | undefined> {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  return useCallback(
    async (item: ItemView, bank: BankTabId) => {
      const t = now()
      const sprint = startDate ? currentSprint(t, startDate) : 1
      const res = await safeWrite(() => toggleBankItem(d, item, bank, t, sprint), m => toast(m, 'danger'))
      if (!res) return res
      if (!res.ok) {
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
    [d, toast, flash, powerUp, startDate],
  )
}
