import { useState } from 'react'
import { useDb } from '../../app/providers'
import { keepMissedSpots } from '../../data/designSessionActions'
import { syncGate } from '../../data/db'
import { safeWrite } from '../../data/safeWrite'
import type { DesignSession } from '../../data/types'
import { now } from '../../lib/clock'
import { keepAccent, keepCopy, keepState, keptCopy } from '../../rules/keepMissed'
import { Button, useToast } from '../../ui/primitives'

/**
 * "Keep what you missed" (frame 7d, DESIGN-102 to DESIGN-106): the weak spots of the AI grade, offered as review cards. Add is a user action
 * only; it is the accent unless a redesign is due (then `session-redesign` keeps it), it is disabled in a read-only browser, and once
 * the cards are written (`keptAt`) the button is replaced by the confirmation and cannot be pressed again.
 */
export function KeepPanel({ session }: { session: DesignSession }) {
  const d = useDb()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { missed, kept } = keepState(session)
  if (missed.length === 0) return null
  const readOnly = !!syncGate.readOnly
  const accent = keepAccent(session)

  const add = async () => {
    if (busy || readOnly) return
    setBusy(true)
    try {
      await safeWrite(() => keepMissedSpots(d, session.id, now()), m => toast(m, 'danger'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sr-panel ds-keep" data-testid="session-keep" aria-labelledby="ds-keep-h">
      <h3 id="ds-keep-h" className="ds-sub">Keep what you missed</h3>
      {kept
        ? <p className="ds-keep-text" data-testid="session-keep-done">{keptCopy(missed.length)}</p>
        : <p className="ds-keep-text">{keepCopy(missed)}</p>}
      <span className="ds-meter ds-keep-pips" data-testid="session-keep-pips" data-count={missed.length} aria-hidden="true">
        {missed.map((_, i) => <i key={i} className="on" />)}
      </span>
      {!kept && (
        <div className="ds-actions">
          <Button
            variant={accent ? 'accent' : 'quiet'} data-testid="session-keep-add" {...(accent ? { 'data-accent': 'primary' } : {})}
            disabled={readOnly || busy} onClick={() => void add()}
          >
            ADD · REVIEW CARDS
          </Button>
        </div>
      )}
    </section>
  )
}
