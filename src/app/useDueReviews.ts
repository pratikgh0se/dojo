import { useMemo } from 'react'
import { useBankExtra, useRedos, useTickets } from '../data/hooks'
import { useNow } from '../lib/useNow'
import { bankAreaResolver } from '../rules/bankQuestions'
import { reviewCards, type ReviewCard } from '../rules/reviewQueue'
import { usePlanV2 } from './providers'

/** The cards that are due now, oldest first; undefined while the data loads. The nav badge, the Today chip and Review read this. */
export function useDueReviews(): ReviewCard[] | undefined {
  const redos = useRedos()
  const tickets = useTickets()
  const extra = useBankExtra()
  const plan = usePlanV2()
  const nowMs = useNow(60_000)
  return useMemo(() => {
    if (!redos || !tickets || !extra) return undefined
    const nodes = (plan?.nodes ?? []).map(n => ({ id: n.id, area: n.area, title: n.title }))
    return reviewCards({ redos, tickets, nowMs, bankArea: bankAreaResolver(plan?.qbank, extra, nodes) })
  }, [redos, tickets, extra, plan, nowMs])
}
