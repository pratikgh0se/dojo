import { useState } from 'react'
import { useDb } from '../../../app/providers'
import { runChecks, setupLab } from '../../../data/labActions'
import { useUserHome } from '../../../data/labHooks'
import type { LabCheckResult, Ticket } from '../../../data/types'
import { now } from '../../../lib/clock'
import { latestRun } from '../../../rules/lab'
import { withHelp } from '../../../rules/labHints'
import { labErrorText, labFolder, runProblem, splitChecks, STATUS_WORD, summaryLine } from '../../../rules/labView'
import { Glyph } from '../../../ui/Glyph'
import { Button, useToast } from '../../../ui/primitives'
import '../lab.css'
import { HintLadder } from './HintLadder'
import { LabReview } from './LabReview'
import type { LabTicket } from './useLabTicket'

const MARK = { pass: 'check', fail: 'close', skip: 'minus' } as const

function CheckList({ rows }: { rows: readonly LabCheckResult[] }) {
  return (
    <ul className="dk-lab-checks">
      {rows.map(c => (
        <li key={c.id} className="dk-lab-check" data-testid={`ticket-check-${c.id}`} data-status={c.status}>
          <span className="dk-lab-mark"><Glyph name={MARK[c.status]} size={2} />{STATUS_WORD[c.status]}</span>{' '}
          <span className="dk-lab-name" data-testid={`ticket-check-name-${c.id}`} data-content="plan">{c.name}</span>{' '}
          {c.detail && <span className="dk-lab-detail" data-testid={`ticket-check-detail-${c.id}`} data-content="learner">{c.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

/** The lab block of a build ticket (labs.md): set up, run the checks, read the results, the milestone, hints and the review. */
export function LabPanel({ ticket, lab, readOnly }: { ticket: Ticket; lab: LabTicket; readOnly: boolean }) {
  const d = useDb()
  const toast = useToast()
  const userHome = useUserHome()
  const [busy, setBusy] = useState<'setup' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  const [tailOpen, setTailOpen] = useState(false)

  if (lab.state === 'loading') return null
  if (lab.state === 'missing') {
    return (
      <section className="dk-box sr-panel" data-testid="ticket-lab-block" data-state="missing" data-lab-id={lab.labId}>
        <p className="dk-meta" data-testid="ticket-lab-missing">{labErrorText('unknown_lab')}</p>
      </section>
    )
  }

  const setUp = lab.state === 'set-up' && !lost
  const row = lab.row
  const folder = row ? labFolder(row, userHome) : null
  const latest = latestRun(lab.runs)
  const problem = runProblem(latest, lab.info?.timeoutSec ?? 0)
  const groups = latest?.results ? splitChecks(latest.results.checks, lab.milestone?.checkIds ?? []) : null
  const shownError = error ?? problem
  const showTail = !!latest?.tail && (!!problem || tailOpen)

  async function doSetup() {
    if (busy) return
    setBusy('setup'); setError(null)
    try {
      const r = await setupLab(d, lab.labId, now())
      if (!r.ok) setError(labErrorText(r.code, r.message))
      else setLost(false)
    } catch { setError(labErrorText('')) } finally { setBusy(null) }
  }
  async function doRun() {
    if (busy) return
    setBusy('run'); setError(null); setTailOpen(false)
    try {
      const r = await runChecks(d, lab.labId, now())
      if (!r.ok) { setError(labErrorText(r.code, r.message)); if (r.code === 'not_set_up') setLost(true) }
    } catch { setError(labErrorText('')) } finally { setBusy(null) }
  }
  async function copyFolder() {
    if (!folder) return
    try { await navigator.clipboard.writeText(folder); toast('Copied.') } catch { toast('Copy failed. Select the folder and copy it by hand.', 'warn') }
  }

  return (
    <section className="dk-box sr-panel" data-testid="ticket-lab-block" data-state={setUp ? 'set-up' : 'not-set-up'} data-lab-id={lab.labId} data-running={busy === 'run' ? 'true' : undefined} aria-label="Lab">
      <div className="dk-trow">
        <span className="dk-cap">Lab{lab.info ? <> · <span data-content="plan">{lab.info.title}</span></> : null}</span>
        {withHelp(row?.hints ?? []) && <span className="dk-chip" data-testid="ticket-lab-help">With help</span>}
      </div>
      {!setUp ? (
        <div className="dk-lab-row">
          <p className="dk-meta">Dojo makes a git folder for this lab from its template. You edit it in your own editor.</p>
          <Button data-testid="ticket-lab-setup" disabled={readOnly || busy !== null} onClick={() => void doSetup()}>Set up lab</Button>
        </div>
      ) : (
        <>
          <div className="dk-lab-path">
            <code data-testid="ticket-lab-path">{folder}</code>
            <Button variant="quiet" data-testid="ticket-lab-path-copy" aria-label="Copy the lab folder" onClick={() => void copyFolder()}><Glyph name="copy" /> Copy</Button>
          </div>
          <div className="dk-lab-row">
            <Button data-testid="ticket-lab-run" disabled={readOnly || busy !== null} onClick={() => void doRun()}>Run checks</Button>
            {busy === 'run' && <span className="dk-meta" role="status">Running the checks. This can take a few seconds.</span>}
          </div>
          <div data-testid="ticket-check-results" aria-live="polite">
            {!latest && <p className="dk-meta" data-testid="ticket-check-none">No checks run yet.</p>}
            {latest?.results && groups && (
              <>
                <p className="dk-meta" data-testid="ticket-check-summary">{summaryLine(latest.results.summary)}</p>
                {groups.own.length > 0 && <CheckList rows={groups.own} />}
                {groups.later.length > 0 && (
                  <div className="dk-lab-later" data-testid="ticket-check-later">
                    <h3 className="dk-cap">Later milestones</h3>
                    <CheckList rows={groups.later} />
                  </div>
                )}
              </>
            )}
            {latest?.tail && !problem && <Button variant="quiet" data-testid="ticket-check-tail-toggle" onClick={() => setTailOpen(o => !o)}>{tailOpen ? 'Hide output' : 'Show output'}</Button>}
            {showTail && <pre className="dk-lab-tail" data-testid="ticket-check-tail" data-content="learner">{latest!.tail}</pre>}
          </div>
        </>
      )}
      {shownError && <p className="dk-lab-error" role="alert" data-testid="ticket-lab-error">{shownError}</p>}
      {lab.milestone && (
        <p className="dk-meta" id="ticket-lab-milestone" data-testid="ticket-lab-milestone" data-passed={lab.passed ? 'true' : 'false'}>
          {lab.passed ? 'Milestone passed' : 'Milestone not passed yet'}
        </p>
      )}
      {setUp && <HintLadder ticket={ticket} labId={lab.labId} hints={row?.hints ?? []} readOnly={readOnly} />}
      <LabReview lab={lab} readOnly={readOnly} onLost={() => setLost(true)} />
    </section>
  )
}
