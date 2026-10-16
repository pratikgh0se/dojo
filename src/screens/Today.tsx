import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useScreenKeys } from '../app/legend'
import { usePlanV2 } from '../app/providers'
import type { SettingsRow } from '../data/db'
import { usePace, useTodayModel, type TodayModel } from '../data/flatHooks'
import { useFocusEvents, useSettings, useTickets } from '../data/hooks'
import type { Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { isActivatable } from '../lib/keys'
import { sessionLabel } from '../lib/timer'
import { useNow } from '../lib/useNow'
import { focusMinutesToday } from '../rules/focus'
import { globalKeyBlocked } from '../rules/keyScope'
import { LANE_LABEL, minutesLabel, tagLane } from '../rules/ticketMeta'
import { nodeTickets } from '../rules/skillTree'
import { DEFAULT_DUE_WEEKDAY, DEFAULT_TRY_MINUTES, TRY_MODEL_ID } from '../rules/ritual'
import { questView, todayHeading } from '../rules/todayModel'
import { headerXp, levelOf } from '../rules/xp'
import { useStartTicket } from '../study/useStartTicket'
import { useStudy } from '../study/useStudy'
import { Loading } from '../ui/Loading'
import { JournalCard } from './today/JournalCard'
import { PomCard } from './today/PomCard'
import { PickElse } from './today/PickElse'
import { QuestCard } from './today/QuestCard'
import { RitualPulse } from './today/RitualPulse'
import { RitualSlots } from './today/RitualSlots'
import { RitualWeekly } from './today/RitualWeekly'
import { StatsDrawer } from './today/StatsDrawer'
import './quest.css'

// W5: the new Today cards load as one lazy chunk, so the entry chunk (480 KB budget) does not carry them
const TodayRituals = lazy(() => import('./today/TodayExtras').then(m => ({ default: m.Rituals })))
const TodayFocus = lazy(() => import('./today/TodayExtras').then(m => ({ default: m.Focus })))
const TodayFloor = lazy(() => import('./today/TodayExtras').then(m => ({ default: m.Floor })))

export function Today() {
  const model = useTodayModel()
  const pace = usePace()
  const tickets = useTickets()
  const settings = useSettings()
  const events = useFocusEvents(0)
  if (!model || !pace || !tickets || !settings || !events) return <Loading />
  return <TodayBody model={model} paceLine={pace.line} tickets={tickets} settings={settings} events={events} />
}

function TodayBody({ model, paceLine, tickets, settings, events }: {
  model: TodayModel; paceLine: string; tickets: Ticket[]; settings: SettingsRow; events: NonNullable<ReturnType<typeof useFocusEvents>>
}) {
  const navigate = useNavigate()
  const start = useStartTicket()
  const study = useStudy()
  const plan = usePlanV2()
  const readOnly = isReadOnly()
  const [picking, setPicking] = useState(false)
  // W5 (RIT-52, RIT-53): while the Floor leads, the usual mix is collapsed behind a toggle; plain state, so a reload shows it collapsed again
  const [mixOpen, setMixOpen] = useState(false)
  const lead = model.lead ?? null
  // RIT-54: a started ticket on a restart day is shown (below the Floor card, with the accent); only the rest of the mix stays behind the toggle
  const resuming = model.next.kind === 'resume'
  const behindToggle = lead !== null && !mixOpen
  const collapsed = behindToggle && !resuming
  const pickRef = useRef<HTMLButtonElement>(null)
  const closePick = useCallback(() => { setPicking(false); pickRef.current?.focus() }, [])
  const phases = plan?.phases ?? []
  // TODAY-03: only a running or paused session is a timer reading; one that reached zero (over) or was parked (away) is not
  const live = study && !study.over && !study.away ? study : null
  // only a live session needs a one-second reading (RESUME mm:ss, the drawer's focus figure); otherwise a minute keeps the day and heading fresh
  const t = useNow(live ? 1000 : 60_000)
  const view = questView({
    action: model.next, mix: model.mix, pathNote: model.pathNote,
    studyLeft: live ? sessionLabel(live, t) : null, studyTicketId: live?.ticketId ?? null,
  })
  const head = todayHeading({ nowMs: t, startDate: settings.startDate, phase: view.ticket?.phase, phases })
  // the quest's skill topic and the learner's place in it (done tickets lit, the quest's own pip outlined)
  const questNode = view.ticket?.node ? plan?.nodes.find(n => n.id === view.ticket?.node) : undefined
  const topic = (() => {
    if (!questNode || !view.ticket) return null
    const ts = nodeTickets(questNode.id, tickets)
    return { title: questNode.title, done: ts.filter(x => x.status === 'done').length, total: ts.length, at: ts.findIndex(x => x.id === view.ticket?.id) }
  })()
  const dayZero = !tickets.some(x => x.status === 'done' || x.status === 'doing')
  // TODAY-18: another lane's first open ticket; started tickets live in the pick list, not here
  const questLane = view.ticket ? tagLane(view.ticket) : undefined
  const second = dayZero || (view.tone !== 'start' && view.tone !== 'resume')
    ? null
    : model.mix.items.find(x => x.id !== view.ticket?.id && x.status !== 'doing' && tagLane(x) !== questLane) ?? null

  // the legend lists Enter only while Enter has something to start
  useScreenKeys(collapsed || (view.button && !(readOnly && view.tone !== 'review')) ? ['Enter start'] : [])

  const go = () => {
    if (collapsed) navigate('/floor') // Enter acts on the button that holds the accent: today-floor-start while the Floor leads (RIT-62)
    else if (view.tone === 'review') navigate('/review')
    else if (view.ticket) void start(view.ticket)
  }
  const goRef = useRef(go)
  goRef.current = go

  // Enter on the page starts the quest, unless the key belongs to a field, a focused control or an open dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (!view.button && !collapsed) || globalKeyBlocked(e) || isActivatable(e.target)) return
      if (readOnly && view.tone !== 'review' && !collapsed) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      e.preventDefault()
      goRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.button, view.tone, readOnly, collapsed])

  // the weekly card reads its minutes and due day from the plan's ritual entry; the mockup's 30 minutes and Saturday when the plan has none
  const tryModel = plan?.rituals?.find(r => r.id === TRY_MODEL_ID)
  const budgetToday = model.budgets[new Date(t).getDay()] ?? 0
  const xp = headerXp(tickets)

  return (
    <div className="qc-page">
      <div className="qc-top">
        {head.day !== null && <span className="qc-day">Day {head.day}</span>}
        {head.phaseLine && <span className="qc-phase" data-content="plan">{head.phaseLine}</span>}
        {model.dueReviews > 0 && !dayZero && (
          <Link className="sr-btn sr-btn-quiet qc-chip" data-testid="today-review-chip" data-count={model.dueReviews} to="/review">Review: {model.dueReviews} due</Link>
        )}
      </div>
      <div className="qc-grid">
        <div className="qc-col">
          <Suspense fallback={null}><TodayFocus /></Suspense>
          {!collapsed && <QuestCard ref={pickRef} view={view} action={model.next.kind} count={model.dueReviews} readOnly={readOnly} picking={picking} topic={topic} onPick={() => (picking ? closePick() : setPicking(true))} onStart={go} />}
          {!collapsed && picking && <PickElse pick={model.pick} onClose={closePick} />}
          <Suspense fallback={null}><TodayFloor lead={lead} open={mixOpen} resuming={resuming} onToggle={() => setMixOpen(o => !o)} /></Suspense>
        </div>
        <div className="qc-col">
          {second && !behindToggle && (
            <section className="qc-second sr-panel" data-testid="today-second" aria-label="Also today">
              <span className="qc-cap">Also today</span>
              <span className="qc-stitle" data-testid="today-second-title" data-content="plan">{second.title}</span>
              <span className="mono qc-meta">{LANE_LABEL[tagLane(second)]} · {minutesLabel(second.estMin)}</span>
              <Link className="sr-btn sr-btn-quiet" to={`/do/${second.id}`}>Open</Link>
            </section>
          )}
          <PomCard xp={xp} formMax={settings.pomFormMax} />
          <RitualPulse nowMs={t} readOnly={readOnly} />
          <RitualWeekly tickets={tickets} nowMs={t} minutes={tryModel?.minutes ?? DEFAULT_TRY_MINUTES} dueWeekday={tryModel?.dueWeekday ?? DEFAULT_DUE_WEEKDAY} readOnly={readOnly} />
          <Suspense fallback={null}><TodayRituals tickets={tickets} nowMs={t} rituals={plan?.rituals ?? []} readOnly={readOnly} /></Suspense>
          {!dayZero && <RitualSlots tickets={tickets} nowMs={t} questId={view.ticket?.id} />}
          <JournalCard nowMs={t} />
        </div>
      </div>
      <StatsDrawer level={levelOf(xp)} xp={xp} focusToday={focusMinutesToday(events, t)} budgetToday={budgetToday} paceLine={paceLine} />
    </div>
  )
}
