import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScreenKeys } from '../../../app/legend'
import { useLeaveDo } from '../../../app/origin'
import { usePlanV2 } from '../../../app/providers'
import { useCheckAttempts } from '../../../data/hooks'
import type { Ticket } from '../../../data/types'
import { isReadOnly } from '../../../data/writer'
import { IDLE_TICK_MS, useSecondsNow } from '../../../lib/useNow'
import { CHECK_REDO_DAYS } from '../../../rules/check'
import { globalKeyBlocked } from '../../../rules/keyScope'
import { unlocksOf } from '../../../rules/skillView'
import { KIND_GLYPH, verbObject } from '../../../rules/ticketMeta'
import { baseXp } from '../../../rules/xp'
import { requestEndSession } from '../../../study/controls'
import { useCompleteTicket } from '../../../study/useCompleteTicket'
import { sessionRouteFor, useStartTicket } from '../../../study/useStartTicket'
import { useStudy } from '../../../study/useStudy'
import { LEARNER_NOTES_MAX, useTicketWork } from '../../../study/useTicketWork'
import { Glyph } from '../../../ui/Glyph'
import { Button, useToast } from '../../../ui/primitives'
import { FocusView } from '../study/FocusView'
import { BlockedNote } from '../BlockedNote'
import { BuildBody } from './BuildBody'
import { ResourceBody } from './ResourceBody'
import { TicketFacts } from './TicketFacts'
import { TicketTimer } from './TicketTimer'
import { useLabTicket } from './useLabTicket'
import '../ticket.css'

/** Every kind but a problem. One header, one timer, one accent button: Start, then Done. */
export function TicketView({ ticket }: { ticket: Ticket }) {
  const leave = useLeaveDo()
  const start = useStartTicket()
  const complete = useCompleteTicket()
  const toast = useToast()
  const study = useStudy()
  const plan = usePlanV2()
  const readOnly = isReadOnly()
  const work = useTicketWork(ticket)
  const attempts = useCheckAttempts(ticket.id)
  const labTicket = useLabTicket(ticket)
  const [focus, setFocus] = useState(false)
  const finishing = useRef(false)
  useScreenKeys(['F focus mode'])

  const mine = study && study.ticketId === ticket.id ? study : null
  const t = useSecondsNow(mine?.phaseStart, IDLE_TICK_MS)
  const design = ticket.kind === 'design' || ticket.kind === 'writeup'
  const ritual = ticket.kind === 'ritual'
  const done = ticket.status === 'done'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focus) { setFocus(false); return }
      if (e.key.toLowerCase() === 'f' && mine && !globalKeyBlocked(e)) { e.preventDefault(); setFocus(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, mine])
  useEffect(() => { if (!mine) setFocus(false) }, [mine])

  const node = useMemo(() => (ticket.node ? plan?.nodes.find(n => n.id === ticket.node) : undefined), [plan, ticket.node])
  const unlocks = node && plan ? unlocksOf(node.id, plan) : []

  if (focus && mine) {
    return <FocusView study={mine} now={t} cards={[ticket]} notes={work.notes} onNotes={work.setNotes} notesMax={LEARNER_NOTES_MAX} onEnd={requestEndSession} onExit={() => setFocus(false)} />
  }

  // flush never rejects (a failed save is a toast), so Done always runs
  // a second Done while the first is still saving or completing does nothing
  const finish = () => {
    if (finishing.current) return
    finishing.current = true
    void work.flush().catch(() => {}).then(() => complete(ticket)).catch(() => toast('Could not finish that ticket. Try again.', 'danger')).finally(() => { finishing.current = false })
  }
  // the action group (Start or Done, accent last) sits at the foot of the last card of the body, in the row with Reveal when there is one
  const actions = (
    <>
      {design ? (
        <Link
          className={`sr-btn ${done ? '' : 'sr-btn-accent'}`.trim()} {...(done ? {} : { 'data-accent': 'primary' })}
          data-testid="ticket-open-session" to={sessionRouteFor(ticket)}
        >
          {verbObject('OPEN', 'design')}
        </Link>
      ) : done ? (
        <span className="dk-done" data-testid="ticket-done-state"><Glyph name="check" size={3} /> Done.</span>
      ) : mine ? (
        <>
          {/* the escape comes BEFORE the accent: nothing focusable may follow the one accent in its group (GLOBAL-03). It never passes a milestone (LAB-23). */}
          {labTicket?.gated && !labTicket.passed && <Button variant="quiet" data-testid="ticket-lab-skip-checks" disabled={readOnly} onClick={finish}>Mark done without checks</Button>}
          <Button
            variant="accent" data-accent="primary" data-testid="ticket-done" disabled={readOnly || (labTicket?.doneLocked ?? false)}
            aria-describedby={labTicket?.milestone ? 'ticket-lab-milestone' : undefined} onClick={finish}
          >{verbObject('DONE', ticket.kind)}</Button>
        </>
      ) : (
        <>
          {/* R7: a ritual can be finished without a timer; Done is then the plain button and Start stays the accent, last */}
          {ritual && <Button data-testid="ticket-done" disabled={readOnly} onClick={finish}>{verbObject('DONE', ticket.kind)}</Button>}
          <Button variant="accent" data-accent="primary" data-testid="ticket-start" disabled={readOnly} onClick={() => void start(ticket)}>{verbObject('START', ticket.kind)}</Button>
        </>
      )}
    </>
  )
  // N4: before the start, the one START sits in the header card, under the title, so it is on screen without scrolling (it used to sit at the
  // foot of the notes, below the fold at 1280 x 800). Once started, Done sits at the foot of the last card of the body.
  const beforeStart = !design && !done && !mine
  const body = ticket.kind === 'build'
    ? <BuildBody ticket={ticket} work={work} readOnly={readOnly} actions={beforeStart ? undefined : actions} lab={labTicket} />
    : ritual || design
      ? null
      : <ResourceBody ticket={ticket} work={work} readOnly={readOnly} actions={beforeStart ? undefined : actions} />

  return (
    <div className="dk" data-testid="do-screen">
      <div className="dk-grid">
        <div className="dk-col">
          <section className="dk-card sr-panel">
            <button type="button" className="do-back" data-testid="do-back" onClick={leave}><Glyph name="chevronL" /> Back</button>
            <div className="dk-headrow">
              <div className="sr-tile dk-kind" data-testid="ticket-kind-tile" data-kind={ticket.kind} aria-hidden="true"><Glyph name={KIND_GLYPH[ticket.kind]} size={4} /></div>
              <div className="dk-headmain">
                <h1 className="dk-title" data-testid="do-title" data-content="plan">{ticket.title}</h1>
                <TicketFacts ticket={ticket}>
                  <span className="mono dk-meta" data-testid="do-ticket-xp" data-xp={ticket.xp}>{done ? ticket.xp : baseXp(ticket.kind, ticket.difficulty)} xp</span>
                </TicketFacts>
              </div>
            </div>
            <BlockedNote ticket={ticket} />
            {done && ticket.kind !== 'build' && attempts && attempts.length > 0 && (
              <p className="dk-meta" data-testid="ticket-check-status">
                {attempts[attempts.length - 1].passed ? 'Your answers were checked: all good.' : `Your answers were checked. They come back in Review in ${CHECK_REDO_DAYS} days.`}
              </p>
            )}
            {(ritual || design) && ticket.text && <p className="dk-text" data-content="plan">{ticket.text}</p>}
            {(!body || beforeStart) && <div className="dk-actions">{actions}</div>}
          </section>
          {body}
        </div>
        <div className="dk-col">
          {!design && <TicketTimer ticket={ticket} onFocusMode={() => setFocus(true)} />}
          {node && (
            <section className="dk-box sr-panel" data-testid="ticket-why">
              <span className="dk-cap">Why this ticket</span>
              <b data-content="plan">{node.title}</b>
              <p className="dk-meta" data-content="plan">{node.why}</p>
              {unlocks.length > 0 && (
                <div data-testid="ticket-unlocks">
                  <span className="dk-cap">Unlocks</span>
                  <ul className="dk-unl">{unlocks.map(n => <li key={n.id}><Glyph name="lock" /><span data-content="plan">{n.title}</span></li>)}</ul>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
