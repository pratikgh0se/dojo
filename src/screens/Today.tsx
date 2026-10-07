import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { TODAY_KEYS, useScreenKeys } from '../app/legend'
import { usePlan } from '../app/providers'
import type { SettingsRow } from '../data/db'
import { useFocusEvents, useRedos, useSessions, useSettings, useTickets } from '../data/hooks'
import type { PlanJson, Redo, Session, StoredEvent, Ticket } from '../data/types'
import { now } from '../lib/clock'
import { isActivatable, isPlainKey, isSpaceActivated, isStrayBackgroundKey, isTypingTarget } from '../lib/keys'
import { useNow } from '../lib/useNow'
import { isStudyPaused } from '../rules/studySession'
import { pauseSession, resumeSession } from '../study/controls'
import { useStudy } from '../study/useStudy'
import { nowTileModel } from '../rules/nowTile'
import { currentSprint } from '../rules/sprint'
import { nextSlideTarget } from '../rules/slide'
import { coreMinutesOf, plannedMinutes } from '../rules/workload'
import { useToast } from '../ui/primitives'
import { useCardActions } from '../ui/useCardActions'
import { useSparTimer } from '../ui/useSparTimer'
import { DigIn } from './today/DigIn'
import { HealthPanel } from './today/HealthPanel'
import { NowTile } from './today/NowTile'
import { VitalsRow } from './today/VitalsRow'
import { WorkloadPanel } from './today/WorkloadPanel'
import './today.css'
import { Loading } from '../ui/Loading'

export function Today() {
  const plan = usePlan()
  const tickets = useTickets()
  const sessions = useSessions()
  const settings = useSettings()
  const redos = useRedos()
  // every logged focus minute: the panels pick their own window (today, the last 7 days), the pace needs the first one's date
  const events = useFocusEvents(0)
  if (!tickets || !sessions || !settings || !redos || !events) return <Loading />
  return <TodayBody plan={plan} tickets={tickets} sessions={sessions} settings={settings} redos={redos} events={events} />
}

function TodayBody({ plan, tickets, sessions, settings, redos, events }: {
  plan: PlanJson; tickets: Ticket[]; sessions: Session[]; settings: SettingsRow; redos: Redo[]; events: StoredEvent[]
}) {
  const t = useNow(60_000)
  const navigate = useNavigate()
  const model = nowTileModel({ nowMs: t, startDate: settings.startDate, plan, tickets })
  const primaryId = model.primaryId
  const spar = useSparTimer(primaryId)
  // ruling 24 S1: a running study session is the tile's running state (on another card it names that card), and space
  // pauses/resumes it, never a timer under it
  const session = useStudy()
  const elsewhere = session && session.ticketId !== primaryId ? tickets.find(x => x.id === session.ticketId)?.title ?? session.ticketId : null
  const toast = useToast()
  const { move, slide } = useCardActions()
  // ruling 23 K1: with a NOW item, the legend's keys are live (Enter, space, d, s); with none (a rest day) they are not listed
  useScreenKeys(primaryId ? TODAY_KEYS : [])

  // The handler reads the latest state through a ref, so the window listener is added once.
  const act = useRef<(e: KeyboardEvent) => void>(() => {})
  act.current = e => {
    if (e.defaultPrevented || !primaryId || !isPlainKey(e) || isTypingTarget(e.target) || (e.key !== 'Enter' && isStrayBackgroundKey())) return
    if (e.key === 'Enter') {
      if (isActivatable(e.target)) return
      e.preventDefault()
      navigate(`/do/${primaryId}`)
    } else if (e.key === ' ') {
      // Space never scrolls Today while the legend says "space timer"; a button the browser activates keeps its own Space
      if (e.shiftKey || isSpaceActivated(e.target)) return
      e.preventDefault()
      if (e.repeat) return
      if (session) (isStudyPaused(session) ? resumeSession : pauseSession)(now())
      else spar.toggle()
    } else if ((e.key === 'd' || e.key === 's') && !e.repeat) {
      e.preventDefault()
      if (e.key === 'd') void move(primaryId, 'done')
      else {
        const cur = currentSprint(t, settings.startDate)
        const tk = tickets.find(x => x.id === primaryId)
        void slide(primaryId, cur, tk ? () => toast(`Slid ${tk.title} to Sprint ${nextSlideTarget(tk, cur)}`) : undefined)
      }
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => act.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="today">
      <NowTile model={model} spar={spar} session={session} sessionCard={elsewhere} />
      <VitalsRow
        plan={plan} tickets={tickets} sessions={sessions} settings={settings}
        sprint={model.sprint} dayInSprint={model.dayInSprint} nowMs={t} events={events}
      />
      <HealthPanel
        tickets={tickets} sprint={model.sprint} dayInSprint={model.dayInSprint}
        nowLabel={model.phase === 'before' ? `S${model.sprint}` : 'NOW'} events={events} nowMs={t} budget={coreMinutesOf(settings)}
      />
      <WorkloadPanel tickets={tickets} sprint={model.sprint} budget={coreMinutesOf(settings)} planned={plannedMinutes(tickets, model.sprint)} nowMs={t} events={events} />
      <DigIn plan={plan} tickets={tickets} sprint={model.sprint} redos={redos} sessions={sessions} nowMs={t} />
    </div>
  )
}
