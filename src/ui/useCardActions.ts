import { useCallback } from 'react'
import { useDb } from '../app/providers'
import { moveOnBoard, slideNext, type ActionResult } from '../data/boardActions'
import { safeWrite } from '../data/safeWrite'
import { openCheck } from '../lib/checkGate'
import { now } from '../lib/clock'
import type { Column } from '../rules/board'
import { useFlash, usePowerUp, useToast } from './primitives'

/**
 * A card's Done and Slide, the same whether they come from the Board (a button, a drag, d, s) or from a shortcut on
 * Today (ruling 23 K1): one write, one set of refusals ("Doing is full", a learning card opens its check), and the same
 * XP feedback. `onRefused` lets the Board bounce the card; the shortcut screens only need the toast.
 */
export function useCardActions(onRefused?: (id: string) => void) {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])

  const report = useCallback((id: string, res: ActionResult | undefined, onSuccess?: () => void) => {
    if (!res) return
    if (!res.ok) {
      if (res.reason === 'check_required') return openCheck(id)
      if (!res.message) return
      toast(res.message, 'danger')
      onRefused?.(id)
      return
    }
    if (res.xpDelta > 0) {
      flash()
      powerUp()
      toast(`+${res.xpDelta} xp · Saved`)
    }
    onSuccess?.()
  }, [toast, flash, powerUp, onRefused])

  const move = useCallback(async (id: string, to: Column, onSuccess?: () => void) =>
    report(id, await safeWrite(() => moveOnBoard(d, id, to, now()), onError), onSuccess), [d, report, onError])
  const slide = useCallback(async (id: string, current: number, onSuccess?: () => void) =>
    report(id, await safeWrite(() => slideNext(d, id, now(), current), onError), onSuccess), [d, report, onError])

  return { report, move, slide }
}
