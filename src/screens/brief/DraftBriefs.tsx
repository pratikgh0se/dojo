import { useEffect } from 'react'
import { useDb } from '../../app/providers'
import { draftSprint, type DraftSummary } from '../../data/briefActions'
import {
  clearDraftJob, getDraftStore, isShownInline, patchDraftJob, registerInline, setDraftJob, setLastDraftFailure, useDraftStore, type DraftJob,
} from '../../data/draftJob'
import { safeWrite } from '../../data/safeWrite'
import { isReadOnly, READ_ONLY_MESSAGE } from '../../data/writer'
import { now } from '../../lib/clock'
import { AiError } from '../../ui/ai/AiStates'
import { Button, useToast } from '../../ui/primitives'
import './brief.css'

/**
 * "Draft briefs for Sprint N" (spec §1): every unfinished card of the sprint without a brief, one at a
 * time, with progress. A failed card is skipped (nothing partial is saved) and the rest carry on; running
 * it again resumes with whatever is still missing.
 */
export function DraftBriefs({ sprint }: { sprint: number }) {
  const d = useDb()
  const toast = useToast()
  // UAT J7: the run outlives this component; its progress is in the draft-job store.
  const { job } = useDraftStore()
  useEffect(() => registerInline(sprint), [sprint])
  // a "nothing to draft" note belongs to the Board it was shown on: it goes when the sprint changes or the Board closes
  useEffect(() => () => { if (getDraftStore().job?.noop) setDraftJob(null) }, [sprint])
  const busy = job?.busy ?? false
  const mine = job?.sprint === sprint ? job : null

  async function run() {
    if (getDraftStore().job?.busy) return
    if (isReadOnly()) return void toast(READ_ONLY_MESSAGE, 'danger')
    setDraftJob({ sprint, busy: true, text: 'Drafting…', summary: null, failure: null, seen: false })
    try {
      const sum: DraftSummary | undefined = await safeWrite(
        () => draftSprint(d, sprint, {
          now,
          onProgress: p => patchDraftJob({ text: `Drafting ${Math.min(p.done + (p.title ? 1 : 0), p.total)} of ${p.total}${p.title ? `: ${p.title}` : ''}` }),
        }),
        m => toast(m, 'danger'),
      )
      if (!sum) return setDraftJob(null)
      // ruling 20 S7: remember why nothing could be drafted (Do screens say what drafting needs); any success clears it
      setLastDraftFailure(sum.drafted > 0 || !sum.firstError ? null : sum.firstError.code)
      // UAT cu-3 P3-1: with nothing to draft there is no result to show or dismiss, only the reason
      if (sum.total === 0) {
        return patchDraftJob({ text: noBriefsNeededText(sprint), summary: draftSummaryText(sprint, sum), failure: null, seen: isShownInline(sprint), noop: true })
      }
      patchDraftJob({
        // UAT r3 P2: a run that drafted nothing failed; it is not "Done"
        text: sum.failed > 0 && sum.drafted === 0 ? 'Failed' : 'Done',
        summary: draftSummaryText(sprint, sum),
        failure: sum.failed > 0 && sum.firstError
          ? { error: { code: sum.firstError.code, message: sum.firstError.error }, count: sum.failed, total: sum.total, drafted: sum.drafted }
          : null,
        seen: isShownInline(sprint),
      })
    } finally {
      patchDraftJob({ busy: false })
    }
  }

  return (
    <div className="bd-draft">
      <Button disabled={busy} onClick={() => void run()}>Draft briefs for Sprint {sprint}</Button>
      {/* UAT cu-8 P3-5: when the failure line below says what happened, a visible "Failed" beside the button says it twice; it stays for assistive tech */}
      {mine && <p className={mine.failure && !mine.busy ? 'bd-progress vh' : 'bd-progress'} role="status" data-testid="brief-progress">{mine.text}</p>}
      {mine && !mine.busy && !mine.noop && (
        <Button variant="quiet" className="bd-dismiss" aria-label="Dismiss the drafting result" data-testid="brief-dismiss" onClick={clearDraftJob}>×</Button>
      )}
      {mine?.failure && (
        <div className="bd-failure">
          <p className="brief-err" data-testid="brief-failed">{draftFailureText(mine.failure)}</p>
          <AiError failure={mine.failure.error} onRetry={() => void run()} />
        </div>
      )}
    </div>
  )
}

/** What "Draft briefs" says when every card of the sprint has one already (nothing runs, nothing is asked of the AI). */
export const noBriefsNeededText = (sprint: number): string => `Every card in Sprint ${sprint} already has a brief`

/** The Board's failure line (UAT r3 P2): all failed, or how many of how many were drafted. Never "the others were". */
export function draftFailureText(f: NonNullable<DraftJob['failure']>): string {
  if (f.drafted === 0) return f.total === 1 ? 'The card could not be drafted.' : `None of the ${f.total} cards could be drafted.`
  return `${f.drafted} of ${f.total} drafted; ${f.count} couldn't be.`
}

/** The global indicator's completion line (UAT J7). */
export function draftSummaryText(sprint: number, sum: DraftSummary): string {
  if (sum.total === 0) return `Sprint ${sprint}: every card already has a brief`
  if (sum.failed > 0 && sum.drafted === 0) return `Sprint ${sprint}: no briefs drafted; none of the ${sum.total} cards could be (see the Board)`
  if (sum.failed > 0) return `Sprint ${sprint}: ${sum.drafted} of ${sum.total} briefs drafted; ${sum.failed} couldn't be (retry on the Board)`
  return `Drafted ${sum.drafted} ${sum.drafted === 1 ? 'brief' : 'briefs'} for Sprint ${sprint}`
}
