import { useState } from 'react'
import { useDb } from '../../app/providers'
import { safeWrite } from '../../data/safeWrite'
import { applyRebalance } from '../../data/workloadActions'
import { now } from '../../lib/clock'
import { hoursText, overBudgetText, type RebalanceProposal } from '../../rules/workload'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'
import './brief.css'

/** "Rebalance?" (Addendum 1 Q12): one checkbox per proposed move, all checked; Accept moves exactly the checked cards. */
export function RebalanceDialog({ proposal, onClose, returnFocus }: { proposal: RebalanceProposal; onClose: () => void; returnFocus?: () => HTMLElement | null }) {
  const d = useDb()
  const toast = useToast()
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set())
  const ids = proposal.moves.filter(m => !skip.has(m.id)).map(m => m.id)
  const minutes = proposal.moves.filter(m => !skip.has(m.id)).reduce((a, m) => a + m.minutes, 0)
  const after = proposal.planned - minutes

  async function accept() {
    const r = await safeWrite(() => applyRebalance(d, ids, proposal.sprint, proposal.to, now()), m => toast(m, 'danger'))
    if (!r) return
    if (!r.ok) return void toast(r.message, 'warn')
    toast(`Moved ${r.count} ${r.count === 1 ? 'card' : 'cards'} to Sprint ${proposal.to}`)
    onClose()
  }

  return (
    <Dialog title="Rebalance?" testId="rebalance-dialog" onClose={onClose} returnFocus={returnFocus}>
      <div className="p-form">
        <p className="brief-text">{overBudgetText(proposal.sprint, proposal.planned, proposal.budget)} These cards, the latest in the plan, move to Sprint {proposal.to}. Pinned and started cards stay.</p>
        {proposal.moves.length === 0 ? (
          <p className="p-note">Nothing can move: every unfinished card is pinned or started.</p>
        ) : (
          <ul className="bf-moves">
            {proposal.moves.map(m => (
              <li key={m.id}>
                <label className="sr-choice">
                  <input
                    type="checkbox" data-testid={`rebalance-move-${m.id}`} checked={!skip.has(m.id)}
                    onChange={e => setSkip(s => { const n = new Set(s); if (e.target.checked) n.delete(m.id); else n.add(m.id); return n })}
                  />
                  {m.title} · {m.minutes} min
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="p-note" data-testid="rebalance-after">Sprint {proposal.sprint} would be {hoursText(after)} h against a budget of {hoursText(proposal.budget)} h.</p>
        <div className="p-actions">
          <Button variant="accent" disabled={ids.length === 0} onClick={() => void accept()}>Accept</Button>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}
