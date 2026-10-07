import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/providers'
import type { SuggestSlideContext, SuggestSlideOutput } from '../../ai/types'
import { callJob } from '../../data/aiActions'
import { slideTicketsTo } from '../../data/boardActions'
import { safeWrite } from '../../data/safeWrite'
import type { Ticket } from '../../data/types'
import { now } from '../../lib/clock'
import { activeTicketIds } from '../../lib/studyStore'
import type { LoadCheck } from '../../rules/load'
import { slideCandidates } from '../../rules/rungContent'
import { TOTAL_SPRINTS } from '../../rules/sprint'
import { sprintTaskWork } from '../../rules/vitals'
import { AiError, AiLoader, type AiFailure } from '../../ui/ai/AiStates'
import { Button, useToast } from '../../ui/primitives'

type Row = { id: string; title: string; reason: string }
type State = { k: 'idle' } | { k: 'loading' } | { k: 'error'; failure: AiFailure } | { k: 'rows'; rows: Row[] }

/** PL "Today": Load check → Ask what to slide (job suggest_slide) → Slide these. Only when Heavy (C-LADDER §3.5). */
export function SlideAsk({ tickets, sprint, load }: { tickets: Ticket[]; sprint: number; load: LoadCheck }) {
  const d = useDb()
  const toast = useToast()
  const [s, setS] = useState<State>({ k: 'idle' })
  const askRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const wasRows = useRef(false)
  // Move focus into the panel the moment it opens, and back to the trigger button once it closes
  // again (Cancel or a successful Slide these both return to 'idle') - otherwise focus is
  // stranded on a button that just disappeared or unmounted.
  useEffect(() => {
    if (s.k === 'rows' && !wasRows.current) panelRef.current?.focus()
    else if (s.k !== 'rows' && wasRows.current) askRef.current?.focus()
    wasRows.current = s.k === 'rows'
  }, [s.k])
  if (!load.heavy || sprint >= TOTAL_SPRINTS) return null
  const to = sprint + 1

  async function ask() {
    const candidates = slideCandidates(tickets, sprint, activeTicketIds())
    const nextSprint = slideCandidates(sprintTaskWork(tickets, to), to)
    setS({ k: 'loading' })
    const context: SuggestSlideContext = { tickets: candidates, count: Math.max(0, load.due - load.cap), ...(load.pace !== null ? { pace: load.pace } : {}), nextSprint }
    const r = await callJob(d, 'suggest_slide', { ticket: null, context }, now())
    if (!r.ok) {
      setS({ k: 'error', failure: { code: r.code, message: r.error } })
      return
    }
    const byId = new Map(candidates.map(c => [c.id, c]))
    const rows = (r.output as SuggestSlideOutput).slide
      .filter(x => byId.has(x.id))
      .map(x => ({ id: x.id, title: byId.get(x.id)!.title, reason: x.reason }))
    setS({ k: 'rows', rows })
  }

  async function confirm(rows: Row[]) {
    const res = await safeWrite(() => slideTicketsTo(d, rows.map(r => r.id), to, now(), sprint), m => toast(m, 'danger'))
    setS({ k: 'idle' })
    if (!res) return
    if (res.ok) toast(`Slid ${res.count ?? rows.length} to sprint ${to}`)
    else toast(res.message, 'warn')
  }

  return (
    <div className="slide-ask">
      <Button ref={askRef} data-testid="ai-slide-ask" disabled={s.k === 'loading'} onClick={() => void ask()}>Ask what to slide</Button>
      {s.k === 'loading' && <AiLoader />}
      {s.k === 'error' && <AiError failure={s.failure} onRetry={() => void ask()} />}
      {s.k === 'rows' && (
        <section ref={panelRef} tabIndex={-1} className="slide-panel" aria-label="Suggested slides" data-testid="ai-slide-panel">
          <ul className="slide-rows">
            {s.rows.map(r => (
              <li key={r.id} data-testid={`ai-slide-row-${r.id}`}>
                <span className="slide-title">{r.title}</span>
                <span className="slide-reason" data-testid={`ai-slide-reason-${r.id}`}>{r.reason}</span>
              </li>
            ))}
          </ul>
          <div className="slide-actions">
            <Button variant="accent" data-testid="ai-slide-confirm" onClick={() => void confirm(s.rows)}>Slide these</Button>
            <Button variant="quiet" data-testid="ai-slide-cancel" onClick={() => setS({ k: 'idle' })}>Cancel</Button>
          </div>
        </section>
      )}
    </div>
  )
}
