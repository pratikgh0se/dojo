import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../app/providers'
import { useDueReviews } from '../app/useDueReviews'
import { saveFloorLine } from '../data/journalActions'
import { safeWrite } from '../data/safeWrite'
import { isReadOnly } from '../data/writer'
import { now } from '../lib/clock'
import { FLOOR_CARDS, floorQueue } from '../rules/floor'
import { JOURNAL_LINE_MAX } from '../rules/journal'
import { Loading } from '../ui/Loading'
import { Button, useToast } from '../ui/primitives'
import { CardView } from './Review'
import './floor.css'

/**
 * W5 (rituals.md RIT-39 to RIT-51): the Floor session. Up to 5 due Review cards (the first 5 when it opens, oldest first, the capped
 * queue), then one Journal line. Saving the line writes today's studied row (a day that counts) and ends the session. Opening it writes
 * nothing. Missed it and Skip show the next card and the session does not come back to them.
 */
export function Floor() {
  const d = useDb()
  const toast = useToast()
  const navigate = useNavigate()
  const readOnly = isReadOnly()
  const cards = useDueReviews()
  const [ids, setIds] = useState<string[] | null>(null)
  const [aside, setAside] = useState<string[]>([])
  const [line, setLine] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (cards && ids === null) setIds(cards.slice(0, FLOOR_CARDS).map(c => c.id)) }, [cards, ids])
  const queue = cards && ids ? floorQueue(cards, ids, aside) : []
  const head = queue[0]
  const step = head ? 'cards' : 'line'

  async function save() {
    if (readOnly || saving || !line.trim()) return
    setSaving(true)
    try {
      const row = await safeWrite(() => saveFloorLine(d, line, now()), m => toast(m, 'danger'))
      if (row) navigate('/', { replace: true })
    } catch {
      toast('That line was not saved. Try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  // not wrapped by `Screen`: its root has to carry `data-step`, so this screen draws `screen-floor` itself
  return (
    <div className="screen-root fl" data-testid="screen-floor" data-step={ids === null ? undefined : step} data-ready={String(ids !== null)}>
      {ids === null ? <Loading /> : (
        <>
          <h1 className="fl-h" data-testid="floor-title">Floor: 15 minutes</h1>
          {head ? (
            <>
              <span className="rv-cap" data-testid="floor-position">Card {ids.length - queue.length + 1} of {ids.length}</span>
              <CardView prefix="floor" key={head.id} card={head} total={queue.length} onBehind={() => setAside(a => [...a, head.id])} />
            </>
          ) : (
            <section className="fl-line sr-panel">
              <label className="fl-field">
                <span>One line about today</span>
                <input
                  type="text" data-testid="floor-line" data-content="learner" autoComplete="off" maxLength={JOURNAL_LINE_MAX} value={line}
                  disabled={readOnly} onChange={e => setLine(e.target.value.slice(0, JOURNAL_LINE_MAX))}
                />
              </label>
              <div className="fl-actions">
                <Button variant="accent" data-accent="primary" data-testid="floor-save" disabled={readOnly || saving || !line.trim()} onClick={() => void save()}>SAVE · FLOOR</Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
