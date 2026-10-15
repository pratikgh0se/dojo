import { useEffect, useMemo, useRef, useState } from 'react'
import { useDb, usePlanV2 } from '../app/providers'
import { moveTicket } from '../data/boardActions'
import { finishProblem, saveBlockedNote } from '../data/kanbanActions'
import { useSettings, useTickets } from '../data/hooks'
import { safeWrite } from '../data/safeWrite'
import type { Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { now } from '../lib/clock'
import { useNow } from '../lib/useNow'
import {
  BACKLOG_PAGE, buildBoard, columnOfStatus, COLUMN_NAME, decideDrop, filterBoard, hoursText, KCOLUMNS, sprintHeader, type KColumn,
} from '../rules/kanban'
import { budgetsOf, careerLaneOf } from '../rules/prefs'
import { laneChips, type LaneFilter } from '../rules/queue'
import { useCompleteTicket } from '../study/useCompleteTicket'
import { Glyph } from '../ui/Glyph'
import { Loading } from '../ui/Loading'
import { Button, useToast } from '../ui/primitives'
import { KanbanCard, type CardHandlers } from './kanban/KanbanCard'
import { OutcomeDialog, type ProblemOutcome } from './kanban/OutcomeDialog'
import { useCardDrag } from './kanban/useCardDrag'
import './kanban.css'

const CHIP_LABEL: Record<string, string> = { all: 'All', path: 'AI', dsa: 'DSA', design: 'Design', career: 'Career' }
const DOING_SOFT_CAP = 3
const EMPTY: Record<KColumn, string> = {
  todo: 'Nothing is waiting.', backlog: 'Backlog is empty.', doing: 'Nothing in progress.', blocked: 'Nothing blocked.',
  help: 'Nothing needs help.', done: 'Nothing finished this sprint yet.',
}

/** The Board (board.md): this sprint's tickets as six columns. It holds no state of its own; a move writes the ticket's status. */
export function Board() {
  const d = useDb()
  const toast = useToast()
  const complete = useCompleteTicket()
  const tickets = useTickets()
  const settings = useSettings()
  const plan = usePlanV2()
  const nowMs = useNow(60_000)
  const readOnly = isReadOnly()
  const [lane, setLane] = useState<LaneFilter>('all')
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [backlogShown, setBacklogShown] = useState(BACKLOG_PAGE)
  const [editing, setEditing] = useState<{ id: string; prefill: string } | null>(null)
  const [outcomeId, setOutcomeId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  /** the card to focus once it shows the status it is moving to (null: now); it lapses after a few seconds */
  const refocus = useRef<{ id: string; status: string | null; at: number } | null>(null)
  const focusLater = (id: string, status: string | null = null) => { refocus.current = { id, status, at: Date.now() } }
  const latest = useRef<Ticket[]>([])
  const busy = useRef(false)
  latest.current = tickets ?? []

  const careerLane = careerLaneOf(settings)
  const model = useMemo(
    () => (tickets && settings ? buildBoard({ tickets, careerLane, startDate: settings.startDate, budgets: budgetsOf(settings), nowMs }) : undefined),
    [tickets, settings, careerLane, nowMs],
  )
  const chips = useMemo(() => (tickets ? laneChips({ tickets, careerLane, phases: plan?.phases ?? [] }) : []), [tickets, careerLane, plan])
  // a lane that vanished (Career switched off while it was the filter) reads as All
  const activeLane: LaneFilter = chips.some(c => c.lane === lane) ? lane : 'all'

  // BOARD-37: exactly "Moved <title> to <Column>."
  const say = (title: string, to: KColumn) => setSaid(`Moved ${title} to ${COLUMN_NAME[to]}.`)
  const ticketOf = (id: string): Ticket | undefined => latest.current.find(x => x.id === id)

  async function applyMove(from: Ticket, to: KColumn) {
    if (readOnly || busy.current) return
    const t = ticketOf(from.id) ?? from
    const dec = decideDrop(t, to)
    if (dec.do === 'none') return
    if (dec.do === 'toast') { toast(dec.message, 'warn'); return }
    setMenuId(null)
    if (dec.do === 'outcome') { setOutcomeId(t.id); return }
    busy.current = true
    try {
      if (dec.do === 'complete') {
        setEditing(null)
        focusLater(t.id, 'done')
        if (await complete(t)) say(t.title, 'done')
        else refocus.current = null
        return
      }
      const r = await safeWrite(() => moveTicket(d, t.id, dec.status, now()), m => toast(m, 'danger'))
      if (!r) return
      if (!r.ok) { toast(r.message, 'danger'); return }
      say(t.title, dec.status)
      if (dec.editor) setEditing({ id: t.id, prefill: dec.editor.prefill })
      else { setEditing(null); focusLater(t.id, dec.status) }
    } catch {
      toast('Could not move that ticket. Try again.', 'danger')
    } finally {
      busy.current = false
    }
  }

  async function chooseOutcome(o: ProblemOutcome) {
    const id = outcomeId
    setOutcomeId(null)
    const t = id ? ticketOf(id) : undefined
    if (!t || readOnly) return
    focusLater(t.id, o === 'gave_up' ? 'todo' : 'done')
    try {
      const r = await safeWrite(() => finishProblem(d, t.id, o, now()), m => toast(m, 'danger'))
      if (!r) return
      if (!r.ok) { toast(r.message, 'danger'); return }
      if (o === 'gave_up') { toast('Back in To do. It comes back in Review in 3 days.'); say(t.title, 'todo') }
      else { toast(r.xpDelta > 0 ? `+${r.xpDelta} xp · Saved` : 'Saved'); say(t.title, 'done') }
    } catch {
      toast('Could not finish that ticket. Try again.', 'danger')
    }
  }

  async function saveNote(t: Ticket, text: string) {
    focusLater(t.id)
    setEditing(null)
    try {
      const r = await safeWrite(() => saveBlockedNote(d, t.id, text), m => toast(m, 'danger'))
      if (r && !r.ok) toast(r.message, 'danger')
    } catch {
      toast('Could not save that. Try again.', 'danger')
    }
  }

  const { drag, onPointerDown, suppressClick } = useCardDrag({
    enabled: !readOnly,
    scroller,
    onDrop: (id, to) => { const t = ticketOf(id); if (t && to) void applyMove(t, to) },
  })

  const handlers: CardHandlers = {
    onPointerDown, suppressClick, onMenu: setMenuId,
    onMove: (t, to) => void applyMove(t, to),
    onEditNote: t => setEditing({ id: t.id, prefill: t.blockedNote ?? '' }),
    onSaveNote: (t, text) => void saveNote(t, text),
    onSkipNote: t => { focusLater(t.id); setEditing(null) },
  }

  // focus follows a moved card, and returns to it when the reason editor or the outcome dialog closes (BOARD-33)
  useEffect(() => {
    const want = refocus.current
    if (!want || editing || outcomeId) return
    if (Date.now() - want.at > 5000) { refocus.current = null; return }
    const el = document.querySelector<HTMLElement>(`[data-testid="kanban-card-${want.id}"]`)
    if (el && (want.status === null || el.getAttribute('data-status') === want.status)) { refocus.current = null; el.focus() }
  })
  // the editor belongs to a blocked or need-help card: if the card has moved on, it closes
  // (the editor opens as the status is written, a moment before the live query shows it: it closes only after the card was seen parked)
  const seenParked = useRef<string | null>(null)
  useEffect(() => {
    if (!editing || !tickets) { seenParked.current = null; return }
    const t = tickets.find(x => x.id === editing.id)
    if (t && (t.status === 'blocked' || t.status === 'help')) seenParked.current = t.id
    else if (!t || seenParked.current === editing.id) { seenParked.current = null; setEditing(null) }
  }, [editing, tickets])

  if (!model || !tickets) return <Loading />
  const view = filterBoard(model, activeLane)
  const byColumn: Record<KColumn, Ticket[]> = {
    todo: view.todo, backlog: backlogOpen ? view.backlog.slice(0, backlogShown) : [], doing: view.doing, blocked: view.blocked, help: view.help, done: view.done,
  }
  const backlogLeft = view.backlog.length - backlogShown

  return (
    <div className="kb">
      <div className="kb-panel">
        <header className="kb-head">
          <h1
            className="kb-sprint" data-testid="kanban-sprint" data-sprint={model.sprint.n} data-start={model.sprint.start} data-end={model.sprint.end}
          >
            {sprintHeader(model.sprint)}
          </h1>
          <p className="kb-stats">
            <span data-testid="kanban-progress" data-done={model.progress.done} data-total={model.progress.total}>{model.progress.done} of {model.progress.total} done</span>
            <span
              className="mono" data-testid="kanban-hours" data-done-min={model.hours.doneMin} data-budget-min={model.hours.budgetMin} data-remaining-min={model.hours.remainingMin}
            >
              {hoursText(model.hours.doneMin)} of {hoursText(model.hours.budgetMin)}
            </span>
          </p>
        </header>
        <div className="kb-chips" role="group" aria-label="Lane">
          {chips.map(c => (
            <button
              key={c.lane} type="button" className="kb-chip" data-testid={`kanban-lane-${c.lane}`} aria-pressed={activeLane === c.lane}
              onClick={() => { setLane(c.lane); setBacklogShown(BACKLOG_PAGE) }}
            >
              {c.lane !== 'all' && <i className="kb-dot" data-lane={c.lane} />}
              {CHIP_LABEL[c.lane]} {c.done ? <span>done</span> : <span className="mono">{c.open}</span>}
            </button>
          ))}
        </div>
        <div className="vh" role="status" aria-live="polite" data-testid="kanban-live">{said}</div>
        <div className="kb-cols" ref={scroller} data-testid="kanban-columns" data-backlog={backlogOpen ? 'open' : 'closed'} role="group" aria-label="Board columns">
          {KCOLUMNS.map(c => {
            const cards = byColumn[c]
            const count = view.count[c]
            return (
              <section
                key={c} className="kb-col" data-testid={`kanban-col-${c}`} data-column={c} data-count={count} data-over={drag?.over === c ? 'true' : undefined}
                aria-labelledby={`kb-h-${c}`}
              >
                <h2 className="kb-colhead" id={`kb-h-${c}`} data-testid={`kanban-col-title-${c}`}>
                  {c === 'backlog' ? (
                    <button
                      type="button" className="kb-toggle" data-testid="kanban-backlog-toggle" aria-expanded={backlogOpen}
                      onClick={() => { setBacklogOpen(o => !o); setBacklogShown(BACKLOG_PAGE) }}
                    >
                      <Glyph name={backlogOpen ? 'chevronD' : 'chevronR'} size={2} />{COLUMN_NAME[c]} <span className="mono">{count}</span>
                    </button>
                  ) : <>{COLUMN_NAME[c]} <span className="mono">{count}</span></>}
                </h2>
                {c === 'doing' && model.doingCount > DOING_SOFT_CAP && (
                  <p className="kb-warn" data-testid="kanban-doing-warning">More than {DOING_SOFT_CAP} tickets are in progress. Nothing stops you; finish one when it suits you.</p>
                )}
                {(c !== 'backlog' || backlogOpen) && (
                  <>
                    {count === 0 && (
                      <p className="kb-empty" data-testid={`kanban-empty-${c}`} data-empty="true">
                        {c === 'todo' && view.backlog.length > 0 ? "This sprint's hours are all planned." : EMPTY[c]}
                      </p>
                    )}
                    <ul className="kb-list">
                      {cards.map(t => (
                        <KanbanCard
                          key={t.id} t={t} column={c === 'todo' || c === 'backlog' ? c : columnOfStatus(t)} readOnly={readOnly} dragging={drag?.id === t.id}
                          editing={editing?.id === t.id ? editing : null} menuOpen={menuId === t.id} h={handlers}
                        />
                      ))}
                    </ul>
                    {c === 'backlog' && backlogLeft > 0 && (
                      <Button variant="quiet" className="kb-more" data-testid="kanban-backlog-more" onClick={() => setBacklogShown(n => n + BACKLOG_PAGE)}>
                        {backlogLeft} more
                      </Button>
                    )}
                  </>
                )}
              </section>
            )
          })}
        </div>
      </div>
      {drag && <div className="kb-ghost" style={{ left: drag.x + 14, top: drag.y + 14 }} aria-hidden="true">{drag.title}</div>}
      {outcomeId && <OutcomeDialog onChoose={o => void chooseOutcome(o)} onCancel={() => { focusLater(outcomeId); setOutcomeId(null) }} />}
    </div>
  )
}
