import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { learnLinks } from '../../content/dsaLearn'
import { useDesignSessions } from '../../data/designHooks'
import type { PlanJson, Redo, Session, Ticket } from '../../data/types'
import { planDesigns } from '../../rules/designs'
import type { DsaProblemView } from '../../rules/dsa'
import { DIFFICULTY_LABELS } from '../../rules/dsa'
import { designRedoRows, redoRows } from '../../rules/redoQueue'
import { todayDrawers, type DesignDrawer } from '../../rules/todayDrawers'
import { Drawer } from '../../ui/Drawer'
import { useTick } from '../../ui/useTick'
import { shownText } from '../../rules/ticketText'

const RUBRIC_PROMPT = '"I am designing [system]. Play the interviewer. Ask me the deep-dive questions one at a time and push on every hand-wave."'
const isWeb = (url: string) => /^https?:\/\//i.test(url)

function DigBox({ ticket }: { ticket: Ticket }) {
  const tick = useTick()
  const done = ticket.status === 'done'
  // The box flips as soon as it is clicked; the stored ticket (a live query) catches up a few ms later
  // and takes over. A failed write drops the optimistic value, so the box shows what is stored.
  const [optimistic, setOptimistic] = useState<{ checked: boolean; from: boolean } | null>(null)
  // Once the stored value changes (this write landed, or another window changed it), it alone decides.
  useEffect(() => setOptimistic(null), [done])
  const checked = optimistic && optimistic.from === done ? optimistic.checked : done
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} aria-label={`Done: ${ticket.title}`}
      className="dig-box" data-testid={`dig-tick-${ticket.id}`}
      onClick={() => {
        setOptimistic({ checked: !done, from: done })
        void tick(ticket).then(r => { if (!r?.ok) setOptimistic(null) }, () => setOptimistic(null))
      }}
    >
      <i />
    </button>
  )
}

function TaskRow({ ticket, tag }: { ticket: Ticket; tag: string }) {
  const links = ticket.links.filter(l => isWeb(l.url))
  return (
    <div role="listitem" className={`dig-task${ticket.status === 'done' ? ' done' : ''}`} data-testid={`dig-row-${ticket.id}`}>
      <DigBox ticket={ticket} />
      <div className="dig-task-main">
        {/* Rule 11 (Addendum 5): every ticket row exposes do-<ticketId>, named "Do: <title>". */}
        <p className="dig-task-p">
          <Link to={`/do/${ticket.id}`} className="dig-task-text" data-testid={`do-${ticket.id}`} aria-label={`Do: ${ticket.title}`}>{shownText(ticket.text) || ticket.title}</Link>
        </p>
        <div className="dig-task-meta">
          {tag && <span className="vital-label">{tag}</span>}
          {links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
        </div>
      </div>
    </div>
  )
}

function ProblemRow({ p }: { p: DsaProblemView }) {
  const nc = p.neetcode ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`neetcode ${p.name}`)}`
  return (
    <div className={`dig-problem${p.solved ? ' done' : ''}${p.ticket ? ' has-do' : ''}`} data-testid={`dig-row-${p.id}`}>
      {p.ticket ? <DigBox ticket={p.ticket} /> : <span className="dig-box" aria-hidden="true" />}
      <a className="dig-problem-link" href={p.url} target="_blank" rel="noopener noreferrer">
        <span className="dig-problem-num">{p.num}</span> {p.name} ↗
      </a>
      {/* ruling 24 S4: on phone these three share one row under the title (and wrap whole); on wider screens the wrapper is
          not a box, so they sit in the row's own columns */}
      <span className="dig-problem-meta">
        <a className="dig-nc" href={nc} target="_blank" rel="noopener noreferrer" title="NeetCode solution and video">NeetCode ↗</a>
        <span className={`dig-diff diff-${p.difficulty}`}>{DIFFICULTY_LABELS[p.difficulty]}{p.premium ? ' · premium' : ''}</span>
        {p.ticket && (
          <Link to={`/do/${p.ticket.id}`} className="dig-do" data-testid={`do-${p.ticket.id}`} aria-label={`Do: ${p.ticket.title}`}>Do ▸</Link>
        )}
      </span>
    </div>
  )
}

function DesignBody({ d }: { d: DesignDrawer }) {
  const it = d.item
  return (
    <>
      {it ? (
        <div className={`dig-task${it.done ? ' done' : ''}`} data-testid={`dig-row-${it.id}`}>
          {it.ticket ? <DigBox ticket={it.ticket} /> : <span className="dig-box" aria-hidden="true" />}
          <div className="dig-task-main dig-design">
            <div className="dig-design-head">
              <p className="dig-design-title">{it.title}</p>
              <span className={`dig-diff diff-${it.difficulty}`}>{DIFFICULTY_LABELS[it.difficulty]}</span>
            </div>
            <span className="vital-label">Must answer · 45 min, recorded</span>
            <ol className="dig-dives">{it.deepDives.map(q => <li key={q}>{q}</li>)}</ol>
            <div className="dig-task-meta">
              {it.refs.filter(r => isWeb(r.url)).map(r => <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">{r.label} ↗</a>)}
            </div>
          </div>
        </div>
      ) : (
        <p className="drawer-note">Tier complete. Redo the one you scored lowest on, or open the Designs tab for the next tier.</p>
      )}
      <div className="dig-well"><span className="vital-label">Rubric prompt</span><p className="dig-rubric">{RUBRIC_PROMPT}</p></div>
    </>
  )
}

/** README-dashboard "Today" §4 + PL "Today": This sprint · Left behind · Redo · DSA · {design day}. */
export function DigIn({ plan, tickets, sprint, redos, sessions, nowMs }: {
  plan: PlanJson; tickets: Ticket[]; sprint: number; redos: Redo[]; sessions: Session[]; nowMs: number
}) {
  const m = todayDrawers(plan, tickets, sprint)
  const designSessions = useDesignSessions()
  // C-INTEGRATION §7: ticket redos first, then due redesigns (read side only, no schema/XP change).
  const rows = redoRows(redos, tickets, sessions, nowMs)
  const designRows = designRedoRows(planDesigns(plan), designSessions ?? [], nowMs)
  const redoCount = rows.length + designRows.length
  const navigate = useNavigate()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => () => setOpen(o => ({ ...o, [k]: !o[k] }))
  const learn = m.dsa ? learnLinks(m.dsa.topic.sprint, plan.learner) : []
  return (
    <div className="dig-in">
      <span className="vital-label">Dig in · tap a row to open</span>
      <Drawer id="tasks" tone="accent" {...m.tasks} open={!!open.tasks} onToggle={toggle('tasks')}>
        {m.tasks.ai.length + m.tasks.interview.length === 0 ? (
          // shell-today-board M12: an empty drawer says so instead of showing bare group headings
          <p className="drawer-empty" data-testid="drawer-empty">Nothing here this sprint</p>
        ) : (
          <>
            <span className="vital-label">AI · {m.tasks.focusAi}</span>
            <div role="list" className="dig-rows">{m.tasks.ai.map(t => <TaskRow key={t.id} ticket={t} tag="" />)}</div>
            <span className="vital-label dig-group">Interview · {m.tasks.focusInterview}</span>
            <div role="list" className="dig-rows">{m.tasks.interview.map(t => <TaskRow key={t.id} ticket={t} tag="" />)}</div>
          </>
        )}
      </Drawer>
      {m.carry && (
        <Drawer id="carry" tone="danger" {...m.carry} open={!!open.carry} onToggle={toggle('carry')}>
          <div role="list" className="dig-rows">{m.carry.rows.map(r => <TaskRow key={r.ticket.id} ticket={r.ticket} tag={r.tag} />)}</div>
        </Drawer>
      )}
      {redoCount > 0 && (
        <Drawer
          id="redo" testId="today-redo-drawer" toggleTestId="today-redo-toggle" tone="accent"
          title={`Redo · ${redoCount}`} sub="Spaced redos due today or earlier"
          cubes={Array.from({ length: redoCount }, () => false)} done={0} total={redoCount}
          open={!!open.redo} onToggle={toggle('redo')}
        >
          {rows.map(r => (
            <button
              key={r.ticketId} type="button" className="redo-row" data-testid={`today-redo-row-${r.ticketId}`}
              aria-label={`Redo ${r.title}`} aria-describedby={`today-redo-detail-${r.ticketId}`}
              onClick={() => navigate(r.to)}
            >
              <span id={`today-redo-detail-${r.ticketId}`}>{r.text}</span>
            </button>
          ))}
          {designRows.map(r => (
            <Link
              key={`design-${r.designId}`} className="redo-row" data-testid={`today-redo-design-${r.designId}`}
              to={r.to} aria-label={`Redesign ${r.title}`}
            >
              {r.text}
            </Link>
          ))}
        </Drawer>
      )}
      {m.dsa && (
        <Drawer id="dsa" tone="rival" {...m.dsa} open={!!open.dsa} onToggle={toggle('dsa')}>
          <p className="drawer-note">{m.dsa.topic.note}</p>
          {learn.length > 0 && (
            <div className="dig-well">
              <span className="vital-label">Study</span>
              {learn.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
            </div>
          )}
          {m.dsa.topic.problems.map(p => <ProblemRow key={p.id} p={p} />)}
        </Drawer>
      )}
      {m.design && (
        <Drawer id="design" tone="design" {...m.design} open={!!open.design} onToggle={toggle('design')}>
          <DesignBody d={m.design} />
        </Drawer>
      )}
    </div>
  )
}
