import { memo } from 'react'
import type { DragEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../../data/types'
import { sessionLabel } from '../../lib/timer'
import { useNow } from '../../lib/useNow'
import type { Study } from '../../rules/studySession'
import { Glyph } from '../../ui/Glyph'
import { Pips } from '../../ui/Pips'
import { Button } from '../../ui/primitives'
import { KIND_GLYPH, KIND_LABEL, LANE_LABEL, minutesLabel, tagLane, verbWord } from '../../rules/ticketMeta'

export interface RowProps {
  ticket: Ticket
  active: boolean
  readOnly: boolean
  /** the running session when it belongs to this ticket (only that row ticks) */
  session: Study | null
  accent?: boolean
  doing?: boolean
  /** Doing rows: the skill topic under the title, and the focus minutes logged on the ticket */
  sub?: string
  focusMin?: number
  onHover: (id: string | null) => void
  onFocusRow: (id: string | null) => void
  onStart: (t: Ticket) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropBefore: (id: string) => void
  onStep: (t: Ticket, dir: -1 | 1) => void
}

/** The one drag payload type a row sets; a drop only reacts to it, so a foreign drag (a file, a link) is ignored. */
export const ROW_DRAG_TYPE = 'text/plain'
export function isRowDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(ROW_DRAG_TYPE)
}

/** mm:ss left on the running session; the only part of the screen that re-renders each second. */
function ResumeText({ session }: { session: Study }) {
  const t = useNow(1000)
  return <>{verbWord('RESUME', sessionLabel(session, t))}</>
}

/** One ticket: kind glyph, title link, lane tag, estimate, and (hover or focus) the one row action. */
export const PathRow = memo(function PathRow(p: RowProps) {
  const t = p.ticket
  const lane = tagLane(t)
  const done = t.status === 'done'
  // PATH-32: a blocked or need-help row is a quiet row: not a drag source, not a drop target, no accent, no Resume
  const parked = t.status === 'blocked' || t.status === 'help'
  const noDrag = done || parked
  const focusMin = p.focusMin ?? 0
  const title = (
    <Link
      to={`/do/${t.id}`} className="pq-title" data-testid={`do-${t.id}`} data-content="plan" draggable={false}
      onKeyDown={e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); p.onStep(t, e.key === 'ArrowUp' ? -1 : 1) }
      }}
    >
      {t.title}
    </Link>
  )
  return (
    <li
      className="pq-row" data-testid={`row-${t.id}`} data-ticket-id={t.id} data-lane={lane} data-kind={t.kind} data-status={t.status}
      draggable={!p.readOnly && !noDrag}
      onMouseEnter={() => p.onHover(t.id)}
      onMouseLeave={() => p.onHover(null)}
      onFocus={() => p.onFocusRow(t.id)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onFocusRow(null) }}
      onDragStart={e => {
        if (p.readOnly || noDrag) { e.preventDefault(); return }
        e.dataTransfer?.setData(ROW_DRAG_TYPE, t.id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        p.onDragStart(t.id)
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={e => { if (!noDrag && !p.readOnly && isRowDrag(e)) e.preventDefault() }}
      onDrop={e => { if (!isRowDrag(e) || parked) return; e.preventDefault(); e.stopPropagation(); p.onDropBefore(t.id) }}
    >
      <span className="pq-kind" data-testid="path-row-kind" data-kind={t.kind}><Glyph name={KIND_GLYPH[t.kind]} size={3} /></span>
      {p.doing && p.sub ? (
        <div className="pq-main">{title}<span className="pq-sub" data-content="plan">{p.sub}</span></div>
      ) : parked && t.blockedNote ? (
        <div className="pq-main">{title}<span className="pq-sub" data-testid="path-row-note" data-content="learner">{t.blockedNote}</span></div>
      ) : title}
      <span className="pq-lane" data-testid="path-row-lane" data-lane={lane}>{LANE_LABEL[lane]}</span>
      {p.doing && (
        <Pips
          className="pq-meter" count={9} on={Math.min(9, Math.max(focusMin > 0 ? 1 : 0, Math.round((focusMin / Math.max(1, t.estMin)) * 9)))}
          label={`${Math.round(focusMin)} of ${t.estMin} min focused`}
        />
      )}
      <span className="pq-est" data-testid="path-row-est">{minutesLabel(t.estMin)}</span>
      <span className="pq-act">
        {p.doing ? (
          <Button
            variant={p.accent ? 'accent' : 'control'} data-testid={`path-row-resume-${t.id}`} {...(p.accent ? { 'data-accent': 'primary' } : {})}
            disabled={p.readOnly} onClick={() => p.onStart(t)}
          >
            {p.session ? <ResumeText session={p.session} /> : verbWord('RESUME', KIND_LABEL[t.kind])}
          </Button>
        ) : p.active && !done && !p.readOnly ? (
          <Button variant="quiet" data-testid={`path-row-start-${t.id}`} onClick={() => p.onStart(t)}>Start</Button>
        ) : null}
      </span>
    </li>
  )
})
