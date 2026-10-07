import { useRef, useState } from 'react'
import { useDb } from '../../app/providers'
import { useCheckAttempts, useChildren } from '../../data/hooks'
import { approveBrief, saveLinkCheck } from '../../data/briefActions'
import { safeWrite } from '../../data/safeWrite'
import type { Brief, Ticket } from '../../data/types'
import { checkLinks } from '../../lib/linkcheck'
import { deliverableOf, LINK_UNVERIFIED_HINT, linkVerdict, minutesLabel, needsCheck, stepUrls } from '../../rules/brief'
import { attemptScore } from '../../rules/check'
import { Button, Panel, useFlash, usePowerUp, useToast } from '../../ui/primitives'
import { BriefEditor } from './BriefEditor'
import { CheckDialog } from './CheckDialog'
import { DeliverableDialog } from './DeliverableDialog'
import { WithFileRefs } from '../../ui/FileRefs'
import './brief.css'

type Open = null | 'edit' | 'check' | 'deliver'

const DAY_LABEL = { focus: 'Focus day', light: 'Light day', long: 'Long day' } as const

function Steps({ brief }: { brief: Brief }) {
  const by = new Map((brief.linkCheck ?? []).map(l => [l.url, l]))
  return (
    <ol className="brief-steps">
      {brief.steps.map((s, i) => {
        const r = s.url ? by.get(s.url) : undefined
        return (
          <li key={i}>
            <WithFileRefs text={s.text} />
            {s.url && /^https?:\/\//i.test(s.url) && (
              <>
                {' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                {r && linkVerdict(r) === 'ok' && <span className="brief-link-ok" data-testid="link-ok">link ok</span>}
                {/* cu-4 P3-4: a 403 from a host that is up is not a broken link */}
                {r && linkVerdict(r) === 'unverified' && (
                  <span className="brief-link-unverified" data-testid="link-unverified" title={LINK_UNVERIFIED_HINT}>can&apos;t verify ({r.status})</span>
                )}
                {r && linkVerdict(r) === 'broken' && <span className="brief-link-broken" data-testid="link-broken">broken link{r.status ? ` (${r.status})` : ''}</span>}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The card's brief, in full and readable (spec §1): goal, numbered steps with their links, minutes,
 * what you'll learn, the outcome and the deliverable, with Edit / Approve / Check links / Split /
 * Mark done. Renders nothing until a brief exists, so the old statement stays the only text.
 */
export function CardBrief({ ticket, part }: { ticket: Ticket; part?: { n: number; of: number; minutes: number } }) {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const attempts = useCheckAttempts(ticket.id)
  const kids = useChildren(ticket.children)
  const [open, setOpen] = useState<Open>(null)
  const [checking, setChecking] = useState(false)
  const doneRef = useRef<HTMLButtonElement>(null)
  const b = ticket.brief
  if (!b) return null
  const urls = stepUrls(b)
  const isDone = ticket.status === 'done'
  const container = (ticket.children?.length ?? 0) > 0
  const learning = needsCheck(ticket)
  // ruling 10 Q22: a split card keeps its check; it is taken here once every session is done
  const kidsDone = !!kids && kids.length > 0 && kids.filter(k => !k.archived).every(k => k.status === 'done')
  const containerCheck = container && learning && ticket.checkPassedAt === undefined
  const onError = (m: string) => toast(m, 'danger')
  const close = () => setOpen(null)
  const done = (xp: number) => {
    if (xp > 0) {
      flash()
      powerUp()
      toast(`+${xp} xp · Saved`)
    }
  }

  async function approve() {
    const r = await safeWrite(() => approveBrief(d, ticket.id), onError)
    if (r && !r.ok) toast(r.message, 'danger')
  }

  async function linkCheck() {
    setChecking(true)
    try {
      const r = await checkLinks(urls)
      if (!r.ok) return toast(r.message, 'danger')
      const w = await safeWrite(() => saveLinkCheck(d, ticket.id, r.results), onError)
      if (w && !w.ok) toast(w.message, 'danger')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Panel className="brief" data-testid="card-brief" aria-label="Card brief">
      {/* D3.2 / M8: the status and source chips sit in the h2 row's right slot */}
      <div className="brief-head">
        <h2 className="sr-panel-title">Brief</h2>
        <span className="brief-chips">
          <span className="brief-chip" data-status={b.status} data-testid="brief-status">{b.status === 'approved' ? 'Approved' : 'Draft'}</span>
          <span className="brief-chip">{b.source === 'edited' ? 'Edited by you' : 'AI draft'}</span>
        </span>
      </div>
      {/* ruling 20 S3: on a part's Do screen, the parent's brief with the part's place in it; it is edited on the parent */}
      {part && <p className="brief-part" data-testid="brief-part">Part {part.n} of {part.of} · {part.minutes} min · this brief covers the whole card</p>}
      <p className="brief-goal" data-testid="brief-goal"><WithFileRefs text={b.goal} /></p>
      <h3 className="brief-sub">Steps</h3>
      <Steps brief={b} />
      <p className="brief-meta">{minutesLabel(b.minutes)} · {DAY_LABEL[b.dayType]}</p>
      {b.learn.length > 0 && (
        <>
          <h3 className="brief-sub">What you&apos;ll learn</h3>
          <ul className="brief-list">{b.learn.map((l, i) => <li key={i}><WithFileRefs text={l} /></li>)}</ul>
        </>
      )}
      <h3 className="brief-sub">Outcome</h3>
      <p className="brief-text"><WithFileRefs text={b.outcome} /></p>
      <h3 className="brief-sub">Deliverable</h3>
      <p className="brief-text" data-testid="brief-deliverable"><WithFileRefs text={(deliverableOf(ticket, b) ?? b.deliverable).prompt} /></p>
      {!part && ticket.deliverable && (
        <>
          <h3 className="brief-sub">Handed in</h3>
          <p className="brief-text" data-testid="deliverable-text">{ticket.deliverable.text}</p>
          {ticket.deliverable.feedback?.map((f, i) => <p key={i} className="brief-note">{f}</p>)}
        </>
      )}
      {!part && attempts && attempts.length > 0 && (
        <>
          <h3 className="brief-sub">Check attempts</h3>
          <ul className="brief-attempts" data-testid="check-attempts">
            {attempts.map((a, i) => (
              <li key={a.id} className="brief-attempt" data-testid="check-attempt">
                Attempt {i + 1} · {attemptScore(a.feedback)}
                <dl>
                  {b.questions.map(q => {
                    const ans = a.answers.find(x => x.id === q.id)
                    const fb = a.feedback.find(x => x.id === q.id)
                    return (
                      <div key={q.id}>
                        <dt>{q.q}</dt>
                        <dd>
                          {q.kind === 'mcq' ? (ans?.choice !== undefined ? q.choices?.[ans.choice] : '') : ans?.answer}
                          {fb?.correction ? ` — ${fb.correction}${fb.pointer ? ` (${fb.pointer})` : ''}` : ''}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {!part && <div className="brief-actions">
        <Button onClick={() => setOpen('edit')}>Edit brief</Button>
        {b.status === 'draft' && <Button variant="accent" onClick={() => void approve()}>Approve</Button>}
        {urls.length > 0 && <Button disabled={checking} onClick={() => void linkCheck()}>Check links</Button>}
        {/* D3.2: one accent: Approve while Draft, Mark done once Approved */}
        {containerCheck && kidsDone && <Button ref={doneRef} variant={b.status === 'draft' ? 'control' : 'accent'} onClick={() => setOpen('check')}>Mark done</Button>}
        {!isDone && !container && <Button ref={doneRef} variant={b.status === 'draft' ? 'control' : 'accent'} onClick={() => setOpen(learning ? 'check' : 'deliver')}>Mark done</Button>}
      </div>}
      {open === 'edit' && <BriefEditor ticket={ticket} brief={b} onClose={close} returnFocus={() => null} />}
      {open === 'check' && <CheckDialog ticket={ticket} brief={b} onClose={close} onDone={done} returnFocus={() => doneRef.current} />}
      {open === 'deliver' && <DeliverableDialog ticket={ticket} brief={b} onClose={close} onDone={done} returnFocus={() => doneRef.current} />}
    </Panel>
  )
}
