import { useEffect, useId, useState } from 'react'
import { useDb } from '../../app/providers'
import { recordBlankTest } from '../../data/projectActions'
import { safeWrite } from '../../data/safeWrite'
import type { BlankTest } from '../../data/types'
import { now } from '../../lib/clock'
import { fmtDayMonYear } from '../../lib/fmtDate'
import { useNow } from '../../lib/useNow'
import { stageLabel } from '../../rules/capstone'
import { blankRedoDue, countdown } from '../../rules/stageCubes'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from './Dialog'

/**
 * C-PROJECTS §2.8. 25-minute countdown on the app clock; Solved / Not yet enabled from Start.
 * Closing before an outcome discards the attempt (spec P-7); after an outcome both buttons go
 * aria-disabled so focus stays inside the dialog (spec P-8).
 */
export function BlankTestDialog({ stage, onClose, returnFocus }: { stage: number; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const d = useDb()
  const toast = useToast()
  const inputId = useId()
  useNow(1000)
  const [piece, setPiece] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [result, setResult] = useState<BlankTest | null>(null)
  const [again, setAgain] = useState(false)
  const [stoppedAt, setStoppedAt] = useState<number | null>(null) // cu-final row 26: the countdown stops at the verdict
  const title = `Blank test · ${stageLabel(stage)}`
  const clock = startedAt === null ? null : countdown(startedAt, Math.max(startedAt, stoppedAt ?? now()))

  useEffect(() => {
    if (startedAt !== null) document.querySelector<HTMLElement>('[data-testid="ai-blank-solved"]')?.focus()
  }, [startedAt])

  async function finish(outcome: BlankTest['outcome']) {
    if (startedAt === null) return
    // UAT cu-r3b P3-1: one attempt records one outcome; a second click says so instead of doing nothing.
    if (result) { setAgain(true); return }
    const at = now()
    const b = await safeWrite(() => recordBlankTest(d, { stage, piece, startedAt, outcome }, at), m => toast(m, 'danger'))
    if (b) { setStoppedAt(at); setResult(b) }
  }

  return (
    <Dialog title={title} testId="ai-blank-dialog" onClose={onClose} returnFocus={returnFocus}>
      <p className="p-rules">No video, no agent, blank file.</p>
      <div className="p-field">
        <label htmlFor={inputId}>What will you rebuild?</label>
        <input
          id={inputId}
          value={piece}
          required
          disabled={startedAt !== null}
          placeholder="e.g. micrograd backward pass"
          onChange={e => setPiece(e.target.value)}
        />
      </div>
      {clock === null ? (
        <div className="p-actions">
          <Button variant="accent" data-testid="ai-blank-start" disabled={!piece.trim()} onClick={() => setStartedAt(now())}>Start</Button>
        </div>
      ) : (
        <p className="p-timer" data-testid="ai-blank-timer">{clock.over ? "Time's up" : clock.text}</p>
      )}
      <div className="p-actions">
        <Button
          data-testid="ai-blank-solved"
          disabled={startedAt === null}
          aria-disabled={result !== null || undefined}
          onClick={() => void finish('solved')}
        >
          Solved
        </Button>
        <Button
          data-testid="ai-blank-notyet"
          disabled={startedAt === null}
          aria-disabled={result !== null || undefined}
          onClick={() => void finish('not_yet')}
        >
          Not yet
        </Button>
        <Button variant="quiet" data-testid="ai-blank-close" onClick={onClose}>Close</Button>
      </div>
      {again && result && (
        <p className="p-note" role="status" data-testid="ai-blank-recorded">
          This attempt is already recorded as {result.outcome === 'solved' ? 'Solved' : 'Not yet'}. Close this dialog and open a new Blank test to try again.
        </p>
      )}
      {result?.outcome === 'solved' && <p className="p-ok" data-testid="ai-blank-outcome">Solved · proof for {stageLabel(stage)}.</p>}
      {result?.outcome === 'not_yet' && (
        <p className="p-due" data-testid="ai-blank-redo-due">Redo due {fmtDayMonYear(blankRedoDue(result))}</p>
      )}
    </Dialog>
  )
}
