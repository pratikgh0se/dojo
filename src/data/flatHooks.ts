import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlanV2 } from '../app/providers'
import { useNow } from '../lib/useNow'
import { dailyMix, nextAction, pathWaitNote, type DayMix, type NextAction } from '../rules/dayMix'
import { projectedEnd, paceLine, type Projection } from '../rules/pace'
import { budgetsOf, careerLaneOf } from '../rules/prefs'
import { laneChips, queueView, todayPickList, type LaneChip, type LaneFilter, type LaneQueue, type QueueView } from '../rules/queue'
import { redoRows } from '../rules/redoQueue'
import { useDb } from './dbContext'
import { useRedos, useSessions, useSettings, useTickets } from './hooks'
import type { StoredEvent, Ticket } from './types'

export interface TodayModel {
  mix: DayMix; next: NextAction; pathNote: string | null; budgets: number[]; careerLane: boolean; dueReviews: number
  pick: { doing: Ticket[]; lanes: LaneQueue[] }
}

/** Everything the Today screen renders: the day's mix, the one quest action, the phase note and the pick list. */
export function useTodayModel(): TodayModel | undefined {
  const tickets = useTickets()
  const settings = useSettings()
  const redos = useRedos()
  const sessions = useSessions()
  const plan = usePlanV2()
  const t = useNow(60_000)
  return useMemo(() => {
    if (!tickets || !settings || !redos || !sessions) return undefined
    const budgets = budgetsOf(settings, plan?.mix)
    const careerLane = careerLaneOf(settings)
    const phases = plan?.phases ?? []
    const date = new Date(t)
    const dueReviews = redoRows(redos, tickets, sessions, t).length
    const mix = dailyMix({ tickets, date, budgets, careerLane })
    const next = nextAction({ tickets, date, budgets, careerLane, dueReviews, phases })
    // The quest ticket appears nowhere in the pick list (TODAY-16).
    const quest = next.kind === 'resume' || next.kind === 'start' ? next.ticket.id : undefined
    return { mix, next, pathNote: pathWaitNote(tickets, phases), budgets, careerLane, dueReviews, pick: todayPickList({ tickets, careerLane, excludeId: quest }) }
  }, [tickets, settings, redos, sessions, plan, t])
}

export function useQueue(o: { lane?: LaneFilter; search?: string; perLane?: number }): { view: QueueView; chips: LaneChip[]; careerLane: boolean } | undefined {
  const tickets = useTickets()
  const settings = useSettings()
  const plan = usePlanV2()
  const { lane, search, perLane } = o
  return useMemo(() => {
    if (!tickets || !settings) return undefined
    const careerLane = careerLaneOf(settings)
    return {
      view: queueView({ tickets, careerLane, lane, search, perLane }),
      chips: laneChips({ tickets, careerLane, phases: plan?.phases ?? [] }),
      careerLane,
    }
  }, [tickets, settings, plan, lane, search, perLane])
}

export function usePace(): { projection: Projection; line: string; budgets: number[] } | undefined {
  const tickets = useTickets()
  const settings = useSettings()
  const plan = usePlanV2()
  const t = useNow(60_000)
  return useMemo(() => {
    if (!tickets || !settings) return undefined
    const budgets = budgetsOf(settings, plan?.mix)
    const projection = projectedEnd({ tickets, nodes: plan?.nodes, phases: plan?.phases, budgets, careerLane: careerLaneOf(settings), now: t })
    return { projection, line: paceLine(projection), budgets }
  }, [tickets, settings, plan, t])
}

const SEEN_KEY = 'dojo.planChangeSeen'
const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY) } catch { return null } }
const writeSeen = (v: string): void => { try { localStorage.setItem(SEEN_KEY, v) } catch { /* the notice may then show once more */ } }

/** The "plan changed" notice: the newest replan event, visible the first time this browser sees it (SHELL-24, MIG-22). */
export function usePlanChanged(): { event: StoredEvent | null; visible: boolean; dismiss: () => void } {
  const d = useDb()
  const event = useLiveQuery(async () => (await d.events.filter(e => e.t === 'replan').last()) ?? null, [d]) ?? null
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!event) return
    const mark = String((event as { at: number }).at)
    if (readSeen() === mark) return
    writeSeen(mark)
    setVisible(true)
  }, [event])
  const dismiss = useCallback(() => setVisible(false), [])
  return { event, visible, dismiss }
}
