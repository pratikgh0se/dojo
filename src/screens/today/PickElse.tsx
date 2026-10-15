import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Ticket } from '../../data/types'
import type { LaneQueue } from '../../rules/queue'
import { LANE_LABEL, minutesLabel, tagLane } from '../../rules/ticketMeta'

/** What S2's pick list holds: the tickets already started, then the next ten open ones of each lane. Choosing one opens it; nothing is started, moved or penalised. */
export function PickElse({ pick, onClose }: { pick: { doing: Ticket[]; lanes: LaneQueue[] }; onClose: () => void }) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('button')?.focus() }, [])
  // Esc closes the list wherever focus is (an empty list has no button to hold focus), unless a dialog or the palette owns the key
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-testid="palette"], [data-testid="command-palette"]')) return
      onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const groups = [
    ...(pick.doing.length > 0 ? [{ key: 'doing', label: 'Started', items: pick.doing }] : []),
    ...pick.lanes.map(l => ({ key: l.lane as string, label: LANE_LABEL[l.lane], items: l.items })),
  ]
  return (
    <div id="today-pick-list" ref={ref} className="qc-pick sr-panel" data-testid="today-pick-list">
      {groups.map(g => (
        <section key={g.key} className="qc-pgroup" aria-label={g.label}>
          <h3 className="qc-cap">{g.label}</h3>
          {g.items.length === 0 ? <p className="qc-meta" data-empty="true">Nothing open in this lane.</p> : (
            <ul>
              {g.items.map(t => (
                <li key={t.id}>
                  <button type="button" className="qc-pitem" data-testid={`today-pick-item-${t.id}`} data-lane={tagLane(t)} onClick={() => navigate(`/do/${t.id}`)}>
                    <span className="qc-ptitle" data-content="plan">{t.title}</span>{' '}
                    <span className="qc-meta"><span>{LANE_LABEL[tagLane(t)]}</span> · <span className="mono">{minutesLabel(t.estMin)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
