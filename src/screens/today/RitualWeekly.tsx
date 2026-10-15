import { useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDb } from '../../app/providers'
import { openWeekTicket } from '../../data/ritualActions'
import { safeWrite } from '../../data/safeWrite'
import type { Ticket } from '../../data/types'
import { READ_ONLY_MESSAGE } from '../../data/writer'
import { readJson, writeJson } from '../../lib/storage'
import { useMediaQuery, NARROW_QUERY } from '../../lib/useMediaQuery'
import {
  isoWeekOf, TRY_MODEL_ID, TRY_MODEL_TITLE, tryModelBody, tryModelPhoneBody, weekdayName, weekdayShort, weekStrip, weekTicketId,
} from '../../rules/ritual'
import { Glyph } from '../../ui/Glyph'
import { Button, useToast } from '../../ui/primitives'
import './ritual.css'

const KEY = 'dojo-ritual-skipped-week'
interface SkippedWeek { week: string; ids: string[] }
const isSkippedWeek = (v: unknown): v is SkippedWeek => typeof v === 'object' && v !== null && typeof (v as SkippedWeek).week === 'string' && Array.isArray((v as SkippedWeek).ids)

/** Whether a ritual was skipped for the ISO week `week` (`2026-W42`). A skip holds until the next Monday and is never counted. */
export function skippedThisWeek(id: string, week: string): boolean {
  const s = readJson(KEY, undefined, isSkippedWeek)
  return !!s && s.week === week && s.ids.includes(id)
}

/**
 * The weekly "Try a model" card: the Monday-first week strip with the due day marked, what to do, and Open / Skip this week.
 * The week's ticket does not exist until Open is pressed (nothing is written on page load); a done ticket turns the card to Done.
 */
export function RitualWeekly({ tickets, nowMs, minutes, dueWeekday, readOnly }: {
  tickets: readonly Ticket[]; nowMs: number; minutes: number; dueWeekday: number; readOnly: boolean
}) {
  const d = useDb()
  const toast = useToast()
  const navigate = useNavigate()
  const phone = useMediaQuery(NARROW_QUERY)
  const week = isoWeekOf(nowMs).key
  const [skippedKey, setSkippedKey] = useState<string | null>(() => (skippedThisWeek(TRY_MODEL_ID, week) ? week : null))
  const [busy, setBusy] = useState(false)
  if (skippedKey === week || (skippedKey === null && skippedThisWeek(TRY_MODEL_ID, week))) return null

  const id = weekTicketId(nowMs)
  const ticket = tickets.find(t => t.id === id && !t.archived)
  const done = ticket?.status === 'done'
  const cells = weekStrip({ nowMs, dueWeekday, doneAt: done ? ticket?.doneAt : undefined })
  const doneName = done && ticket?.doneAt !== undefined ? weekdayName(new Date(ticket.doneAt).getDay()) : weekdayName(dueWeekday)
  const doneShort = done && ticket?.doneAt !== undefined ? weekdayShort(new Date(ticket.doneAt).getDay()) : weekdayShort(dueWeekday)
  const status = done ? `Done ${phone ? doneShort : doneName}` : phone ? weekdayShort(dueWeekday) : `Due ${weekdayName(dueWeekday)}`

  const skip = () => { writeJson(KEY, { week, ids: [TRY_MODEL_ID] }); setSkippedKey(week) }
  const open = async (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (busy) return
    if (ticket) { navigate(`/do/${id}`); return }
    if (readOnly) { toast(READ_ONLY_MESSAGE, 'warn'); return }
    setBusy(true)
    try {
      const made = await safeWrite(() => openWeekTicket(d, nowMs, { minutes, dueWeekday }), m => toast(m, 'danger'))
      if (made) navigate(`/do/${made}`)
    } finally { setBusy(false) }
  }

  const statusEl = <h3 className="rt-status" data-testid="today-ritual-due" data-state={done ? 'done' : 'due'}>{status}</h3>
  return (
    <section className="rt-card sr-panel" data-testid={`today-ritual-${TRY_MODEL_ID}`} data-state={done ? 'done' : 'open'} aria-label={TRY_MODEL_TITLE}>
      <div className="rt-row">
        <span className="qc-cap rt-grow">{TRY_MODEL_TITLE} · weekly</span>
        {phone ? statusEl : done ? <span className="qc-cap rt-ok" data-testid="today-ritual-done">Done</span> : <Glyph name="calendar" className="rt-cal" />}
      </div>
      {!phone && statusEl}
      <div className="rt-week" data-testid="today-week" role="group" aria-label="This week">
        {cells.map((c, i) => (
          <span
            key={i} className="rt-cell" data-testid={`today-week-${i}`} data-state={c.state} data-today={c.today ? 'true' : undefined}
            role="img" aria-label={`${weekdayName((i + 1) % 7)}${c.today ? ', today' : ''}${c.state === 'due' ? ', due' : c.state === 'done' ? ', done' : ''}`}
          >{c.letter}</span>
        ))}
      </div>
      <p className="rt-copy">{phone ? tryModelPhoneBody(dueWeekday) : tryModelBody(minutes, dueWeekday)}</p>
      <div className="qc-ractions">
        {!done && <Button variant="quiet" data-testid={`today-ritual-skip-${TRY_MODEL_ID}`} onClick={skip}>Skip this week</Button>}
        <Link className="sr-btn sr-btn-quiet" data-testid={`today-ritual-open-${TRY_MODEL_ID}`} to={`/do/${id}`} onClick={e => void open(e)} aria-disabled={busy || undefined}>Open</Link>
      </div>
    </section>
  )
}
