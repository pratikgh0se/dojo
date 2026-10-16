import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../../app/providers'
import { getHint } from '../../../data/labActions'
import type { LabHintUse, Ticket } from '../../../data/types'
import { now } from '../../../lib/clock'
import { nextRung, type Rung } from '../../../rules/labHints'
import { labErrorText } from '../../../rules/labView'
import { Button } from '../../../ui/primitives'
import '../lab.css'

interface Shown { text: string; ref?: { file: string; from: number; to: number; code: string } }
const RUNGS: Rung[] = [1, 2, 3]

/**
 * Authored hints, three rungs in order (spec 4.2). Rung 3 shows part of the reference solution after one confirm click. Hints cost nothing.
 * The text is not stored, only the (ticket, rung) that was shown; a stored rung is fetched again on mount, which writes nothing.
 */
export function HintLadder({ ticket, labId, hints, readOnly }: { ticket: Ticket; labId: string; hints: readonly LabHintUse[]; readOnly: boolean }) {
  const d = useDb()
  const [shown, setShown] = useState<Partial<Record<Rung, Shown>>>({})
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(new Set<Rung>())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const mine = hints.filter(h => h.ticketId === ticket.id).map(h => h.rung)
  const key = [...new Set(mine)].sort().join(',')
  const next = nextRung(hints, ticket.id) ?? 3
  const used3 = mine.includes(3)

  useEffect(() => {
    for (const rung of (key ? key.split(',').map(Number) : []) as Rung[]) {
      if (asked.current.has(rung)) continue
      asked.current.add(rung)
      void getHint(d, labId, ticket.id, rung, now()).then(r => {
        if (mounted.current && r.ok) setShown(s => ({ ...s, [rung]: { text: r.text, ...(r.ref ? { ref: r.ref } : {}) } }))
        else asked.current.delete(rung)
      }).catch(() => asked.current.delete(rung))
    }
  }, [d, labId, ticket.id, key])

  async function open(rung: Rung) {
    if (busy) return
    setBusy(true); setError(null); setConfirm(false)
    asked.current.add(rung)
    try {
      const r = await getHint(d, labId, ticket.id, rung, now())
      if (!r.ok) setError(labErrorText(r.code, r.message))
      else setShown(s => ({ ...s, [rung]: { text: r.text, ...(r.ref ? { ref: r.ref } : {}) } }))
    } catch { setError(labErrorText('')) } finally { setBusy(false) }
  }
  const press = (rung: Rung) => { if (rung === 3 && !used3 && !shown[3]) setConfirm(true); else void open(rung) }

  return (
    <div className="dk-hints" data-testid="ticket-hints">
      <span className="dk-cap">Hints</span>
      <p className="dk-meta">Hints cost nothing. Hint 3 shows part of a reference solution.</p>
      <div className="dk-hint-row">
        {RUNGS.map(n => <Button key={n} data-testid={`ticket-hint-${n}`} disabled={readOnly || busy || n > next} onClick={() => press(n)}>Hint {n} of 3</Button>)}
      </div>
      {confirm && (
        <div className="dk-hint-confirm" role="alert">
          <p data-testid="ticket-hint-confirm">Hint 3 shows part of the reference solution. Show it?</p>
          <div className="dk-hint-row">
            <Button data-testid="ticket-hint-confirm-yes" onClick={() => void open(3)}>Show hint</Button>
            <Button variant="quiet" data-testid="ticket-hint-confirm-no" onClick={() => setConfirm(false)}>Not now</Button>
          </div>
        </div>
      )}
      {error && <p className="dk-lab-error" role="alert" data-testid="ticket-hint-error">{error}</p>}
      <ol className="dk-hint-list">
        {RUNGS.filter(n => shown[n]).map(n => {
          const h = shown[n]!
          return (
            <li key={n} className="dk-hint-item">
              <b>Hint {n}</b>
              <p data-testid={`ticket-hint-text-${n}`} data-content="plan">{h.text}</p>
              {h.ref && (
                <div data-testid="ticket-hint-ref" data-file={h.ref.file} data-from={h.ref.from} data-to={h.ref.to}>
                  <span className="mono dk-meta" data-testid="ticket-hint-ref-file" data-content="plan">{h.ref.file} lines {h.ref.from} to {h.ref.to}</span>
                  <pre className="dk-hint-code" data-testid="ticket-hint-ref-code" data-content="plan">{h.ref.code}</pre>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
