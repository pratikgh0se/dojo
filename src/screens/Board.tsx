import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BOARD_CARD_KEYS, BOARD_INSIDE_KEYS, useScreenKeys } from '../app/legend'
import { useDb } from '../app/providers'
import { slideTicketTo } from '../data/boardActions'
import { useEvents, useSettings, useTickets } from '../data/hooks'
import { safeWrite } from '../data/safeWrite'
import type { Ticket } from '../data/types'
import { now } from '../lib/clock'
import { isTypingTarget } from '../lib/keys'
import { useNow } from '../lib/useNow'
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import {
  boardColumns, COLUMNS, COLUMN_LABELS, cardMeta, cardsText, columnCount, columnOf, countedCards, debtBar, groupLineText, shortSource, stepColumn, stripLength, type Column,
} from '../rules/board'
import { originLabel } from '../rules/bankTickets'
import { currentSprint } from '../rules/sprint'
import { Button, useToast } from '../ui/primitives'
import { tipProps } from '../ui/Tip'
import { useCardActions } from '../ui/useCardActions'
import { BoardActions } from './BoardActions'
import { CardTools } from './brief/CardTools'
import { DraftBriefs } from './brief/DraftBriefs'
import { RebalanceDialog } from './brief/RebalanceDialog'
import { coreMinutesOf, overBudgetText, plannedMinutes, rebalanceProposal } from '../rules/workload'
import { isContainer, minutesOf } from '../rules/brief'
import './board.css'
import { Loading } from '../ui/Loading'

const allowDrop = (e: DragEvent<HTMLElement>) => e.preventDefault()

/** `from`: the column (id) or the moved card (slot), so the effect waits until the move has landed. */
type PendingFocus = { kind: 'id'; id: string; from: Column } | { kind: 'slot'; column: Column; index: number; moved: string }

const EMPTY_COLS: Record<Column, Ticket[]> = { slid: [], todo: [], doing: [], done: [] }

/** UAT r2 J7: more pointer travel than this between press and release is a drag, not a click. */
const CLICK_SLOP_PX = 6

export function Board() {
  const d = useDb()
  const tickets = useTickets()
  const settings = useSettings()
  const events = useEvents()
  const t = useNow(60_000)
  const toast = useToast()
  const navigate = useNavigate()
  // UAT cu-3p P3-7: the sprint on screen is part of the address (/board?sprint=3), so Back from a card's Do page (a history
  // step, or the path Do noted) returns to the sprint it was opened from, not to the current one. The current sprint is the
  // plain /board. A pick replaces the entry: browsing sprints adds no history.
  const [params, setParams] = useSearchParams()
  const asked = /^\d+$/.test(params.get('sprint') ?? '') ? Number(params.get('sprint')) : null
  const picked = asked !== null && asked >= 1 ? asked : null
  const [bouncing, setBouncing] = useState<string | null>(null)
  // ruling 23 K1: the legend lists the card keys only while a card (or a control inside one) has focus
  const [cardFocus, setCardFocus] = useState<'none' | 'card' | 'inside'>('none')
  useScreenKeys(cardFocus === 'card' ? BOARD_CARD_KEYS : cardFocus === 'inside' ? BOARD_INSIDE_KEYS : [])
  /** What holds focus: a card, a control inside one, or neither. Read from the DOM, so a card that unmounts under focus counts. */
  function syncCardFocus() {
    const a = document.activeElement
    const card = a instanceof HTMLElement ? a.closest<HTMLElement>('article.card') : null
    setCardFocus(!card ? 'none' : a === card ? 'card' : isTypingTarget(a) ? 'none' : 'inside')
  }
  useEffect(syncCardFocus)
  const { report, move, slide } = useCardActions(id => {
    setBouncing(id)
    window.setTimeout(() => setBouncing(b => (b === id ? null : b)), 480)
  })
  const [rebalancing, setRebalancing] = useState(false)
  const dragId = useRef<string | null>(null)
  /** where the pointer went down on a card (UAT r2 J7: click vs drag) */
  const press = useRef<{ x: number; y: number } | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  // The write's promise and the live query race: bump a counter with each request so the effect also runs
  // when the re-render already happened; `from`/`moved` stop it acting before the move lands.
  const [focusReq, setFocusReq] = useState(0)
  const wantFocus = (p: PendingFocus) => { pendingFocus.current = p; setFocusReq(n => n + 1) }
  const rootRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLElement>(null)
  const phone = useMediaQuery(NARROW_QUERY)
  // ui-board B3 phone: columns stack, each header is a toggle; only Todo and Doing start open.
  const [openCols, setOpenCols] = useState<Record<Column, boolean>>({ slid: false, todo: true, doing: true, done: false })

  const current = tickets && settings ? currentSprint(t, settings.startDate) : 0
  const len = tickets ? stripLength(tickets) : 0
  const sel = picked === null ? current : Math.min(picked, Math.max(len, 1))
  const setPicked = (n: number) => setParams(n === current ? {} : { sprint: String(n) }, { replace: true })
  const cols = tickets ? boardColumns(tickets, sel) : EMPTY_COLS
  const debt = tickets ? debtBar(tickets, sel) : { own: 0, slidIn: 0, avg: 0 }
  const budget = coreMinutesOf(settings)
  const planned = tickets ? plannedMinutes(tickets, sel) : 0
  const over = planned > budget

  // After a successful keyboard move, the card's DOM node is re-parented under a
  // different column <section> (React unmounts/remounts it), which drops focus to
  // <body>. Re-focus the moved card by id, or, when it left the viewed sprint (slide),
  // the sibling that took its place, else the previous sibling, else the column itself.
  useEffect(() => {
    const pending = pendingFocus.current
    const root = rootRef.current
    if (!pending || !root) return
    if (pending.kind === 'id') {
      const moved = tickets?.find(x => x.id === pending.id)
      if (moved && columnOf(moved) === pending.from) return // not landed yet
      const el = root.querySelector<HTMLElement>(`[data-testid="card-${pending.id}"]`)
      if (el) {
        el.focus()
        pendingFocus.current = null
        return
      }
      // Not rendered: wait while the move is still landing; once the ticket is in its new column and that
      // column is collapsed (phone), focus the column's toggle and drop the pending focus (G4 review 4).
      const tk = tickets?.find(x => x.id === pending.id)
      if (!tk) return
      const col = columnOf(tk)
      if (!phone || openCols[col]) return
      root.querySelector<HTMLElement>(`[data-testid="col-${col}"] h2 > button`)?.focus()
      pendingFocus.current = null
      return
    }
    const list = countedCards(cols[pending.column])
    if (list.some(x => x.id === pending.moved)) return // not landed yet
    const target = list[pending.index] ?? list[pending.index - 1]
    if (target) {
      root.querySelector<HTMLElement>(`[data-testid="card-${target.id}"]`)?.focus()
    } else {
      root.querySelector<HTMLElement>(`[data-testid="col-${pending.column}"]`)?.focus()
    }
    pendingFocus.current = null
  }, [tickets, cols, phone, openCols, focusReq])

  if (!tickets || !settings) return <Loading />

  const onError = (m: string) => toast(m, 'danger')

  const slideTo = async (id: string, sprint: number) =>
    report(id, await safeWrite(() => slideTicketTo(d, id, sprint, now(), current), onError))

  function takeDrag(e: DragEvent<HTMLElement>): string | null {
    const id = dragId.current ?? e.dataTransfer?.getData('text/plain') ?? null
    dragId.current = null
    return id || null
  }

  function onStripKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = e.key === 'ArrowRight' ? Math.min(len, sel + 1) : Math.max(1, sel - 1)
    setPicked(n)
    stripRef.current?.querySelector<HTMLElement>(`[data-sprint="${n}"]`)?.focus()
  }

  // UAT r2 J7: a mouse click on a card opens it, as Enter does. Not a click on its own controls (rail, tools, a
  // dialog), and not the end of a drag: past a few pixels of movement it was a drag (native DnD needs more anyway).
  function onCardClick(e: MouseEvent<HTMLElement>, tk: Ticket) {
    const p = press.current
    press.current = null
    if (tk.origin !== 'plan' && !tk.childOf) return
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, dialog, [role="menu"], [role="dialog"]')) return
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) return
    navigate(`/do/${tk.id}`)
  }

  // Ruling 23 K1: the card keys act on the card that holds focus: the card itself, or a control inside it (Slide ›, Pin,
  // a menu). Enter opens the card only when the card itself is focused; on a control it stays that control's own.
  function onCardKey(e: KeyboardEvent<HTMLElement>, tk: Ticket) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement
    const own = e.target === e.currentTarget
    // not from a portal'd dialog, not while typing in a field or a native menu of the card
    if (!e.currentTarget.contains(t) || (!own && (isTypingTarget(t) || t.closest('dialog, [role="menu"], [role="dialog"]')))) return
    if (e.key === 'Enter') {
      if (!own || (tk.origin !== 'plan' && !tk.childOf)) return
      e.preventDefault()
      navigate(`/do/${tk.id}`)
      return
    }
    if (e.repeat) return // a held key must not carry on to the next card once this one has moved
    if (e.key === 'd') {
      e.preventDefault()
      void move(tk.id, 'done', () => wantFocus({ kind: 'id', id: tk.id, from: columnOf(tk) }))
    } else if (e.key === 's') {
      e.preventDefault()
      const column = columnOf(tk)
      const index = countedCards(cols[column]).findIndex(x => x.id === tk.id)
      void slide(tk.id, current, () => wantFocus({ kind: 'slot', column, index, moved: tk.id }))
    } else if (e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault()
      void move(tk.id, stepColumn(tk, 1), () => wantFocus({ kind: 'id', id: tk.id, from: columnOf(tk) }))
    } else if (e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault()
      void move(tk.id, stepColumn(tk, -1), () => wantFocus({ kind: 'id', id: tk.id, from: columnOf(tk) }))
    }
  }

  return (
    <div className="board" ref={rootRef} onFocus={syncCardFocus} onBlur={e => { if (!e.relatedTarget) setCardFocus('none') }}>
      <div className="board-head">
        <h1 className="screen-title board-title">
          Sprint <span data-testid="board-sprint">S{sel}</span>
          {sel === current && <span className="now-tag"> · now</span>}
        </h1>
        <BoardActions sprint={sel} current={current} tickets={tickets} events={events} />
      </div>
      <DraftBriefs sprint={sel} />
      {over && (
        <div className="bd-rebalance" data-testid="bd-rebalance">
          <p>{overBudgetText(sel, planned, budget)}</p>
          <Button data-testid="rebalance-open" onClick={() => setRebalancing(true)}>Rebalance?</Button>
        </div>
      )}
      {rebalancing && <RebalanceDialog proposal={rebalanceProposal(tickets, sel, budget)} onClose={() => setRebalancing(false)} />}

      {/* ui-board B1.3: navigation "Sprints" of buttons; one row on desktop, 36 per row on tablet, 18 on phone. */}
      <nav className="strip" aria-label="Sprints" onKeyDown={onStripKey} data-testid="strip" ref={stripRef} style={{ ['--strip-n' as string]: Math.max(72, len) }}>
        {Array.from({ length: len }, (_, i) => i + 1).map(n => (
          <button
            type="button"
            key={n}
            aria-label={`Sprint ${n}`}
            aria-current={n === sel ? 'true' : undefined}
            data-testid={`strip-${n}`}
            data-sprint={n}
            {...tipProps(`Sprint ${n}${n === current ? ' · now' : ''}`)}
            tabIndex={n === sel ? 0 : -1}
            className={`strip-cell${n === sel ? ' sel' : ''}${n === current ? ' now' : ''}`}
            onClick={() => setPicked(n)}
            onDragOver={allowDrop}
            onDrop={e => {
              e.preventDefault()
              const id = takeDrag(e)
              if (id) void slideTo(id, n)
            }}
          />
        ))}
      </nav>

      <div className="debt" aria-label={`Plan items: ${debt.own} own, ${debt.slidIn} slid in, plan average ${debt.avg}`}>
        <div className="debt-bar">
          {Array.from({ length: debt.own }, (_, i) => <span key={`o${i}`} className="debt-seg own" />)}
          {Array.from({ length: debt.slidIn }, (_, i) => <span key={`s${i}`} className="debt-seg slid" />)}
          <span className="debt-avg" style={{ left: debt.avg * 12 }} />
        </div>
        {/* UAT J2: the ruling-3 legend texts stay; a lead says what is counted and each has its plain words as a tooltip */}
        <div className="debt-legend">
          {/* ruling 20 S4: these count plan items (a split card once), and the label says so */}
          <span className="debt-lead">Plan items this sprint:</span>
          <span data-testid="debt-own" title="plan items planned for this sprint (a split card counts once)">own {debt.own}</span>
          <span data-testid="debt-slid" title="cards slid in from earlier sprints">slid in {debt.slidIn}</span>
          <span data-testid="debt-avg" title="the plan's average cards per sprint (the line on the bar)">plan avg {debt.avg}</span>
        </div>
      </div>

      <div className="columns">
        {COLUMNS.map(c => {
          const shown = !phone || openCols[c]
          const head = (
            <>
              {/* ruling 20 S4 (see columnCount): Todo, Doing and Slid in count cards, a split card's parts included;
                  Done counts problems, a split card once */}
              <span className="col-head-text" data-testid={`head-${c}`} {...tipProps(`${cardsText(columnCount(c, cols[c]))} in ${COLUMN_LABELS[c]}, Sprint ${sel}`)}>
                {COLUMN_LABELS[c]} <span className="col-count" data-testid={`count-${c}`}>{columnCount(c, cols[c])}</span>
              </span>
              {c === 'todo' && <span className="col-min"> · {countedCards(cols.todo).reduce((a, x) => a + minutesOf(x), 0)} min</span>}
            </>
          )
          return (
            <section
              key={c}
              className={`col col-${c}${shown ? "" : " col-closed"}`}
              data-testid={`col-${c}`}
              aria-label={COLUMN_LABELS[c]}
              tabIndex={-1}
              onDragOver={allowDrop}
              onDrop={e => {
                e.preventDefault()
                const id = takeDrag(e)
                if (id) void move(id, c)
              }}
            >
              <h2 className="col-head">
                {phone ? (
                  <button
                    type="button" className="col-toggle" aria-expanded={shown} aria-controls={`col-body-${c}`}
                    onClick={() => setOpenCols(o => ({ ...o, [c]: !o[c] }))}
                  >
                    <span>{head}</span>
                    {/* shell-today-board M19: the glyph is drawn by CSS, outside the heading's text */}
                    <span className="col-caret" aria-hidden="true" data-caret={shown ? '−' : '+'} />
                  </button>
                ) : head}
              </h2>
              {shown && (
                <div className="col-body" id={`col-body-${c}`}>
                  {cols[c].length === 0 && <p className="col-empty">{c === 'slid' ? 'Nothing slid in' : 'Drop cards here'}</p>}
                  {cols[c].map(tk => isContainer(tk) ? (
                    // ruling 20 S4: the split card is an uncounted group line above its parts, not a card
                    <Link key={tk.id} to={`/do/${tk.id}`} className="card-group" data-testid={`group-${tk.id}`} title="Open the split card">
                      {groupLineText(tk, tickets)}
                    </Link>
                  ) : (
                    <article
                      key={tk.id}
                      className={`card track-${tk.track}${columnOf(tk) === 'slid' ? ' slid' : ''}${bouncing === tk.id ? ' bounce' : ''}`}
                      data-testid={`card-${tk.id}`}
                      tabIndex={0}
                      draggable
                      aria-label={tk.title}
                      onDragStart={e => {
                        dragId.current = tk.id
                        e.dataTransfer?.setData('text/plain', tk.id)
                      }}
                      onKeyDown={e => onCardKey(e, tk)}
                      onMouseDown={e => { press.current = { x: e.clientX, y: e.clientY } }}
                      onClick={e => onCardClick(e, tk)}
                      data-opens={tk.origin === 'plan' || tk.childOf ? 'true' : undefined}
                    >
                      <p className="card-title" title={tk.title}>{tk.title}</p>
                      <p className="card-meta">{cardMeta(tk)}</p>
                      <div className="card-chips">
                        {/* cu-final row 10: the brief chip LEADS the row, before any source or bank chip (a card with a resource chip had it on a second row) */}
                        {tk.brief && <span className="chip chip-brief" data-testid="brief-chip">brief · {tk.brief.status}</span>}
                        {/* UAT cu-6 P3-8: a Hello Interview item's source and its bank are the same words: one chip, the bank's */}
                        {tk.links[0] && shortSource(tk.links[0].label).toLowerCase() !== originLabel(tk.origin)?.toLowerCase() && <span className="chip chip-src" title={tk.links[0].label}>{shortSource(tk.links[0].label)}</span>}
                        {originLabel(tk.origin) && <span className="chip bank-chip" data-testid="bank-chip">{originLabel(tk.origin)}</span>}
                        {/* cu-3 P3-2: the chip's place is kept when unpinned (board.css .pin-ghost), so pinning moves nothing */}
                        {tk.pinned ? <span className="chip">Pinned</span> : <span className="chip pin-ghost" aria-hidden="true" />}
                      </div>
                      <CardTools ticket={tk} lastSprint={Math.max(len, sel)} />
                      <div className="rail">
                        {(tk.origin === 'plan' || tk.childOf) && (
                          <Link to={`/do/${tk.id}`} className="sr-btn sr-btn-control" data-testid={`do-${tk.id}`} aria-label={`Do: ${tk.title}`}>Do ▸</Link>
                        )}
                        {tk.status !== 'done' && <Button onClick={() => void slide(tk.id, current)}>Slide ›</Button>}
                        {tk.status !== 'done' && <Button onClick={() => void move(tk.id, 'done')}>Done ✓</Button>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
