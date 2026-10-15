import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigationType } from 'react-router-dom'
import { useDb, usePlanV2 } from '../app/providers'
import { useQueue } from '../data/flatHooks'
import { useFocusEvents, useTickets } from '../data/hooks'
import { reorderInLane } from '../data/queueActions'
import { safeWrite } from '../data/safeWrite'
import { startDoing } from '../data/sessionActions'
import type { Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { now } from '../lib/clock'
import { addLocalDays, startOfLocalDay } from '../lib/dates'
import { isQueued, pathWaitNote } from '../rules/dayMix'
import { globalKeyBlocked, takePathSearchAsk } from '../rules/keyScope'
import { clearPathFilter, loadPathFilter, savePathFilter } from '../rules/pathFilter'
import { DOING_SOFT_CAP, UP_NEXT_PER_LANE, tagLane, type LaneFilter } from '../rules/queue'
import { useStartTicket } from '../study/useStartTicket'
import { useStudy } from '../study/useStudy'
import { Glyph } from '../ui/Glyph'
import { Loading } from '../ui/Loading'
import { Button, useToast } from '../ui/primitives'
import { PathRow, ROW_DRAG_TYPE, isRowDrag } from './path/PathRow'
import './path.css'

const CHIP_LABEL: Record<string, string> = { all: 'All', path: 'AI', dsa: 'DSA', design: 'Design', career: 'Career' }
const DONE_STEP = 25
/** PATH-19: a Doing group of up to this many rows stays pinned under the top edge while Up next scrolls, so a row far down the list can be dropped on it without scrolling away from the row being dragged. */
const PIN_DOING_MAX = 1
// PATH-15: each "more" doubles the rows a lane shows (10, 20, 40, ...), so a lane of 220 open tickets is fully listed in five presses, not twenty-two
/** Longest we wait for the reordered list to arrive before giving up on restoring focus. */
const REFOCUS_MS = 2000

export function Path() {
  const d = useDb()
  const toast = useToast()
  const start = useStartTicket()
  const plan = usePlanV2()
  const study = useStudy()
  const tickets = useTickets()
  const focusEvents = useFocusEvents(0)
  const readOnly = isReadOnly()
  // NAV-40: Back (and a reload) finds the lane and the search as they were left; a screen reached any other way starts clean (NAV-41 forgets it)
  const navType = useNavigationType()
  const [kept] = useState(() => { if (navType === 'POP') return loadPathFilter(); clearPathFilter(); return { lane: 'all' as LaneFilter, query: '' } })
  const [lane, setLane] = useState<LaneFilter>(kept.lane)
  const [query, setQuery] = useState(kept.query)
  useEffect(() => { savePathFilter({ lane, query }) }, [lane, query])
  const [perLane, setPerLane] = useState(UP_NEXT_PER_LANE)
  const [doneOpen, setDoneOpen] = useState(false)
  const [doneLimit, setDoneLimit] = useState(DONE_STEP)
  // Keyboard focus outranks hover: each is tracked on its own, so the pointer passing over other rows never unmounts the focused row's Start
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [said, setSaid] = useState<ReactNode>('')
  const search = useRef<HTMLInputElement>(null)
  const refocus = useRef<{ id: string; order: string; timer: number } | null>(null)
  // PathRow is memoised: it gets these stable wrappers, which call the handlers of the latest render
  const live = useRef({ start: (_: Ticket) => {}, dropBefore: (_: string) => {}, step: (_: Ticket, __: -1 | 1) => {} })
  const onStart = useCallback((x: Ticket) => live.current.start(x), [])
  const onDropBefore = useCallback((id: string) => live.current.dropBefore(id), [])
  const onStep = useCallback((x: Ticket, dir: -1 | 1) => live.current.step(x, dir), [])
  const onDragEnd = useCallback(() => setDragId(null), [])
  const q = useQueue({ lane, search: query, perLane })

  // "/" jumps to the search box (the key is not typed into it). `screen-path` is on the page before the chunk and the queue have
  // loaded, so a press that arrives while the box is not drawn yet is remembered (here, or by the shell) and honoured once it is (PATH-10).
  const wantSearch = useRef(false)
  const loaded = !!q && !!tickets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || globalKeyBlocked(e)) return
      e.preventDefault()
      if (search.current) search.current.focus()
      else wantSearch.current = true
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!loaded) return
    if (takePathSearchAsk() || wantSearch.current) { wantSearch.current = false; search.current?.focus() }
  }, [loaded])

  // PATH-03: the lanes are consecutive blocks in the day-mix order (AI, DSA, Design, Career); each is already in effective order
  const rows = useMemo(() => (q ? q.view.upNext.flatMap(l => l.items) : []), [q])

  // PATH-31: a keyed row that moves is re-inserted and the browser drops its focus; give it back once the new order has rendered
  useEffect(() => {
    const r = refocus.current
    if (!r || rows.map(x => x.id).join('|') === r.order) return
    window.clearTimeout(r.timer)
    refocus.current = null
    document.querySelector<HTMLElement>(`[data-testid="do-${r.id}"]`)?.focus()
  }, [rows])
  useEffect(() => () => window.clearTimeout(refocus.current?.timer), [])

  if (!q || !tickets) return <Loading />
  const { view, chips } = q
  const byId = new Map(tickets.map(x => [x.id, x]))
  const phaseNote = lane === 'all' || lane === 'path' ? pathWaitNote(tickets, plan?.phases ?? []) : null
  const searching = query.trim() !== ''
  const laneItems = (ticket: Ticket) => view.upNext.find(l => l.lane === tagLane(ticket))?.items ?? []

  async function reorder(moved: Ticket, toIndex: number): Promise<boolean> {
    if (readOnly || searching) return false
    try {
      const r = await safeWrite(() => reorderInLane(d, moved.id, toIndex), m => toast(m, 'danger'))
      if (r && !r.ok) toast(r.message, 'danger')
      return !!r && r.ok
    } catch {
      toast('Could not move that ticket. Try again.', 'danger')
      return false
    }
  }
  async function toDoing(id: string) {
    const tk = byId.get(id)
    if (readOnly || !tk || !isQueued(tk)) return // PATH-32: a drag never moves a blocked or need-help ticket
    try {
      const res = await safeWrite(() => startDoing(d, id, now()), m => toast(m, 'danger'))
      if (res && !res.ok) toast(res.message, 'danger')
    } catch {
      toast('Could not start that ticket. Try again.', 'danger')
    }
  }
  function dropBefore(targetId: string) {
    const moved = dragId ? byId.get(dragId) : undefined
    const target = byId.get(targetId)
    setDragId(null)
    if (!moved || !target || moved.id === targetId || moved.status === 'done' || target.status === 'done') return
    if (moved.status === 'blocked' || moved.status === 'help' || target.status === 'blocked' || target.status === 'help') return
    // PATH-19: the pointer may be released over a Doing row; that is a drop on the Doing group
    if (target.status === 'doing') { if (moved.status !== 'doing') void toDoing(moved.id); return }
    if (moved.status === 'doing') return
    if (tagLane(moved) !== tagLane(target)) { setSaid('A ticket moves within its own lane.'); return }
    const items = laneItems(moved)
    const i = items.findIndex(x => x.id === moved.id)
    const j = items.findIndex(x => x.id === targetId)
    if (j < 0) return
    void reorder(moved, i >= 0 && i < j ? j - 1 : j)
  }
  function step(tk: Ticket, dir: -1 | 1) {
    if (readOnly || searching || !isQueued(tk)) return
    const items = laneItems(tk)
    const i = items.findIndex(x => x.id === tk.id)
    const to = i + dir
    if (i < 0 || to < 0 || to >= items.length) return
    window.clearTimeout(refocus.current?.timer)
    refocus.current = { id: tk.id, order: rows.map(x => x.id).join('|'), timer: window.setTimeout(() => { refocus.current = null }, REFOCUS_MS) }
    void reorder(tk, to).then(ok => {
      if (ok) setSaid(<>Moved <span data-content="plan">{tk.title}</span> {dir === -1 ? 'up' : 'down'}.</>)
    })
  }
  live.current = { start: x => void start(x), dropBefore, step }

  // the Doing row's subline is its skill topic; its pips are the focus minutes logged on it against its estimate
  const nodeTitle = new Map((plan?.nodes ?? []).map(n => [n.id, n.title]))
  const focusMin = new Map<string, number>()
  for (const e of focusEvents ?? []) if (e.t === 'focus') focusMin.set(e.id, (focusMin.get(e.id) ?? 0) + e.minutes)
  const doingProps = (tk: Ticket) => ({ sub: tk.node ? nodeTitle.get(tk.node) : undefined, focusMin: focusMin.get(tk.id) ?? 0 })

  const rowProps = (tk: Ticket) => ({
    ticket: tk, active: hoverId === tk.id || focusId === tk.id, readOnly, session: study && study.ticketId === tk.id ? study : null,
    onHover: setHoverId, onFocusRow: setFocusId, onStart, onDragStart: setDragId, onDragEnd, onDropBefore, onStep,
  })
  const nothingAtAll = tickets.every(x => x.archived)
  // "14 done · 3 this week": every finished ticket, and those finished since this Monday (local time)
  const finished = tickets.filter(x => !x.archived && x.status === 'done')
  const t0 = now()
  const weekStart = addLocalDays(startOfLocalDay(t0), -((new Date(t0).getDay() + 6) % 7))
  const thisWeek = finished.filter(x => x.doneAt !== undefined && x.doneAt >= weekStart).length
  // a search that only finds finished tickets opens Done, so the matches are not hidden behind the toggle
  const doneShown = doneOpen || (searching && view.done.length > 0 && view.doing.length + view.blocked.length + rows.length === 0)
  const noMatch = searching && view.doing.length + view.blocked.length + rows.length + view.done.length === 0

  return (
    <div className="pq">
      <div className="pq-card">
      <div className="pq-toolbar">
        <div className="pq-chips" role="group" aria-label="Lane">
          {chips.map(c => (
            <button
              key={c.lane} type="button" className="pq-chip" data-testid={`path-lane-${c.lane}`} aria-pressed={lane === c.lane}
              onClick={() => { setLane(c.lane); setPerLane(UP_NEXT_PER_LANE) }}
            >
              {c.lane !== 'all' && <i className="pq-dot" data-lane={c.lane} />}
              {CHIP_LABEL[c.lane]} {c.done ? <span>done</span> : <span className="mono">{c.open}</span>}
            </button>
          ))}
        </div>
        <label className="pq-search">
          <Glyph name="search" size={2} />
          <input ref={search} type="search" data-testid="path-search" aria-label="Search tickets" placeholder="Search tickets" value={query} onChange={e => setQuery(e.target.value)} />
          <kbd className="sh-kbd" aria-hidden="true">/</kbd>
        </label>
        {!nothingAtAll && <p className="pq-sum" data-testid="path-summary"><span className="mono pq-sum-ok">{finished.length}</span> done · <span className="mono">{thisWeek}</span> this week</p>}
      </div>
      <p className="vh" role="status" aria-live="polite" data-testid="path-live">{said}</p>

      {nothingAtAll ? (
        <div className="pq-empty" data-testid="path-empty" data-empty="true">
          <p>Nothing is queued yet.</p>
          <Link className="sr-btn" to="/">Go to Today</Link>
        </div>
      ) : noMatch ? (
        <div className="pq-empty" data-testid="path-no-match" data-empty="true">
          <p>No tickets match that search.</p>
          <Button data-testid="path-search-clear" onClick={() => { setQuery(''); setLane('all'); setPerLane(UP_NEXT_PER_LANE) }}>Clear search</Button>
        </div>
      ) : (
        <>
          <section
            className={`pq-group${view.doing.length === 0 ? ' pq-group-empty' : ''}${view.doing.length <= PIN_DOING_MAX ? ' pq-pin' : ''}`} data-testid="path-doing" aria-label="Doing"
            onDragOver={e => { if (isRowDrag(e)) e.preventDefault() }}
            onDrop={e => {
              if (!isRowDrag(e)) return
              e.preventDefault()
              const id = dragId ?? e.dataTransfer?.getData?.(ROW_DRAG_TYPE)
              setDragId(null)
              if (id) void toDoing(id)
            }}
          >
            <h2 className="pq-h" data-testid="path-doing-title">Doing <span className="mono">{view.doing.length}</span></h2>
            {view.doingOverCap && <p className="pq-warn" data-testid="path-doing-warning">More than {DOING_SOFT_CAP} tickets are in progress. Nothing stops you; finish one when it suits you.</p>}
            {view.doing.length === 0 && <p className="pq-quiet" data-testid="path-doing-idle">Nothing running, so start a ticket or drop one here</p>}
            <ul className="pq-list">
              {view.doing.map((tk, i) => <PathRow key={tk.id} {...rowProps(tk)} {...doingProps(tk)} doing accent={i === 0} />)}
            </ul>
          </section>

          {view.blocked.length > 0 && (
            <section className="pq-group" data-testid="path-blocked" aria-label="Blocked and need help">
              <h2 className="pq-h" data-testid="path-blocked-title">Blocked and need help <span className="mono">{view.blocked.length}</span></h2>
              <ul className="pq-list">
                {view.blocked.map(tk => <PathRow key={tk.id} {...rowProps(tk)} />)}
              </ul>
            </section>
          )}

          <section className="pq-group" data-testid="path-upnext" aria-label="Up next">
            <h2 className="pq-h" data-testid="path-upnext-title">Up next <span className="mono">{view.moreTotal > 0 ? `${rows.length} of ${rows.length + view.moreTotal}` : rows.length}</span></h2>
            {phaseNote && <p className="pq-note" data-testid="path-phase-note">{phaseNote}</p>}
            <ul className="pq-list">
              {rows.map(tk => <PathRow key={tk.id} {...rowProps(tk)} />)}
            </ul>
            {/* GLOBAL-09: a finished lane (or a finished queue) says so in one sentence, with at most one way out */}
            {rows.length === 0 && !searching && (
              <div className="pq-lane-empty" data-testid="path-lane-empty" data-empty="true">
                <p>{lane === 'all' ? 'Nothing is waiting in Up next.' : `Every ${CHIP_LABEL[lane]} ticket is done.`}</p>
                {lane !== 'all' && <Button onClick={() => { setLane('all'); setPerLane(UP_NEXT_PER_LANE) }}>Show all lanes</Button>}
              </div>
            )}
            {view.moreTotal > 0 && (
              <Button variant="quiet" className="pq-more" data-testid="path-upnext-more" onClick={() => setPerLane(n => n * 2)}>
                <Glyph name="chevronD" />{view.moreTotal} more
              </Button>
            )}
          </section>

          <section
            className="pq-group" data-testid="path-done" aria-label="Done"
            onDragOver={e => { if (isRowDrag(e)) e.preventDefault() }}
            onDrop={e => { if (!isRowDrag(e)) return; e.preventDefault(); setDragId(null); toast('A ticket is done when you finish it, not when it is dropped here.') }}
          >
            <h2 className="pq-h" data-testid="path-done-title">
              <button type="button" className="pq-donetoggle" data-testid="path-done-toggle" aria-expanded={doneShown} onClick={() => setDoneOpen(!doneShown)}>
                <Glyph name={doneShown ? 'chevronD' : 'chevronR'} />Done <span className="mono">{view.done.length}</span>
              </button>
            </h2>
            {doneShown && (
              <>
                <ul className="pq-list">
                  {view.done.slice(0, doneLimit).map(tk => <PathRow key={tk.id} {...rowProps(tk)} />)}
                </ul>
                {view.done.length > doneLimit && (
                  <Button variant="quiet" className="pq-more" data-testid="path-done-more" onClick={() => setDoneLimit(n => n + DONE_STEP)}>
                    <Glyph name="chevronD" />{view.done.length - doneLimit} more
                  </Button>
                )}
              </>
            )}
          </section>
        </>
      )}
      </div>
    </div>
  )
}
