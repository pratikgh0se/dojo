import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/providers'
import { safeWrite } from '../../data/safeWrite'
import { splitIntoSessions } from '../../data/splitActions'
import type { Brief, Ticket } from '../../data/types'
import {
  canSplit, inPartsRange, offersSplit, partMinutes, partsRangeMessage, splitBodyText, splitMaxParts, SPLIT_MIN_PARTS, suggestedParts, suggestedText,
} from '../../rules/split'
import { Button, Panel, useToast } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'
import './brief.css'

/**
 * "Split into sessions" (Addendum 1 Q8, ruling 20 S2): Parts and Split. The body states exactly what Split creates
 * and follows Parts as it changes; the children stay in the parent's sprint.
 */
function SplitDialog({ ticket, brief, onClose }: { ticket: Ticket; brief: Brief | undefined; onClose: () => void }) {
  const d = useDb()
  const toast = useToast()
  const suggestion = brief?.splitSuggestion
  const max = splitMaxParts(ticket)
  const suggested = suggestedParts(ticket)
  const [parts, setParts] = useState(() => Math.min(max, Math.max(SPLIT_MIN_PARTS, suggestion?.length ?? suggested ?? 3)))
  // ruling 10 Q22: the dialog always opens; a card that can't be split says why here
  const blocked = canSplit(ticket, Math.min(max, Math.max(SPLIT_MIN_PARTS, parts)))
  const [error, setError] = useState<string | null>(blocked.ok ? null : blocked.message)
  const valid = inPartsRange(ticket, parts)
  const proposed = suggestion && suggestion.length === parts ? suggestion : null
  // ruling 20 S1: an even largest-remainder share (the brief's proposed titles are kept, its minutes are not)
  const minutes = valid ? partMinutes(ticket, parts) : []

  async function split() {
    setError(null)
    if (!valid) return setError(partsRangeMessage(ticket))
    const titles = proposed ? proposed.map(s => s.title) : []
    // ruling 18 F9: a started card splits too (time on it is no help taken); only used help rungs refuse
    const r = await safeWrite(() => splitIntoSessions(d, ticket.id, parts, titles), m => toast(m, 'danger'))
    if (!r) return
    if (!r.ok) return setError(r.message)
    toast(`Split into ${r.children.length} sessions`)
    onClose()
  }

  const check = (n: number) => setError(inPartsRange(ticket, n) ? null : partsRangeMessage(ticket))

  return (
    <Dialog title="Split into sessions" testId="split-dialog" onClose={onClose}>
      <div className="p-form">
        {/* ruling 20 S2: the body is the preview: exactly the sessions Split creates, live as Parts changes */}
        <p className="brief-text" data-testid="split-preview" aria-live="polite">
          {valid ? splitBodyText(minutes) : `Cut this card into ${SPLIT_MIN_PARTS} to ${max} sessions. Each session is its own card in the same sprint; this card is done when all of them are.`}
        </p>
        {suggested !== null && <p className="p-note" data-testid="split-suggested">{suggestedText(suggested)}</p>}
        <div className="p-field">
          <label htmlFor="sp-parts">Parts</label>
          {/* Q20: min/max expose the range; the app's own error fires on input, on blur and on Split (M4) */}
          <input id="sp-parts" type="number" min={SPLIT_MIN_PARTS} max={max} value={Number.isFinite(parts) ? parts : ''}
            onBlur={e => check(Math.round(Number(e.target.value)))} aria-invalid={error ? true : undefined} onChange={e => {
            // M4 (rerun): the app's own error as soon as Parts is out of range (no browser bubble), and again on Split
            const n = Math.round(Number(e.target.value))
            setParts(n)
            check(n)
          }} />
          {error && <p className="p-err" role="alert" data-testid="split-error">{error}</p>}
        </div>
        <div className="p-actions">
          <Button variant="accent" onClick={() => void split()}>Split</Button>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** The "Split into sessions" button on the Do screen (ruling 20 S2: not on a part, a split card or one under 20 min). */
export function SplitButton({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false)
  if (!offersSplit(ticket)) return null
  return (
    <div className="brief-actions">
      <Button onClick={() => setOpen(true)}>Split into sessions</Button>
      {open && <SplitDialog ticket={ticket} brief={ticket.brief} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * A split card's Do screen in place of its timer and outcomes (UAT r5 P3 #3): the card itself is worked through its
 * sessions, so it says so and links each one (✓ once done). The card is done when all of them are.
 */
export function SessionList({ items }: { items: Ticket[] }) {
  return (
    <Panel title="Sessions" className="brief" data-testid="split-sessions">
      <p className="brief-text" data-testid="split-parent-note">Split into {items.length} sessions — work on them one by one:</p>
      <ol className="brief-steps">
        {items.map(c => (
          <li key={c.id} data-done={c.status === 'done' ? 'true' : 'false'}>
            <Link to={`/do/${c.id}`} data-testid={`do-${c.id}`} aria-label={`Do: ${c.title}`}>{c.title}</Link>
            <span className="brief-meta"> · {c.estMin} min{c.status === 'done' ? ' · ✓ done' : ''}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
