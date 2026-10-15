import { Link, useNavigate } from 'react-router-dom'
import { usePlan } from '../../app/providers'
import type { Ticket } from '../../data/types'
import { isReadOnly } from '../../data/writer'
import { patternForProblem } from '../../rules/atlasPattern'
import { difficultyWord, treeItemRoute } from '../../rules/skillView'
import { verbObject } from '../../rules/ticketMeta'
import { useStartTicket } from '../../study/useStartTicket'
import { Glyph } from '../../ui/Glyph'
import { Button } from '../../ui/primitives'

/** TREE-10, TREE-11: the items of a DSA or Design node, in effective order. Each row links to where the item is worked and writes nothing. */
export function NodeItems({ items }: { items: readonly Ticket[] }) {
  return (
    <ul className="sk-items" data-testid="skills-node-items" aria-label="Items">
      {items.map(t => {
        const done = t.status === 'done'
        return (
          <li key={t.id} className="sk-item-li">
            <Link className="sk-item" to={treeItemRoute(t)} data-testid={`skills-node-item-${t.id}`} data-done={done ? 'true' : 'false'} data-status={t.status}>
              <span className="sk-item-t" data-content="plan">{t.title}</span>
              <span className="sk-item-m">
                <span className="mono sk-meta" data-testid={`skills-node-item-difficulty-${t.id}`} data-difficulty={t.difficulty}>{difficultyWord(t.difficulty)}</span>
                {done ? <span className="sk-item-done"><Glyph name="check" /> Done</span> : t.status === 'doing' ? <span className="sk-meta">In progress</span> : null}
              </span>
            </Link>
            <PatternChip ticketId={t.id} />
          </li>
        )
      })}
    </ul>
  )
}

/** TREE-17: a DSA problem's Atlas pattern (the same lookup as the /dsa chip, ATLAS-08), linking to its Atlas row. A sibling of the row link, not inside it. Design items and unknown ids have none. */
function PatternChip({ ticketId }: { ticketId: string }) {
  const plan = usePlan()
  const ref = patternForProblem(ticketId, plan)
  if (!ref) return null
  return <Link className="chip sk-item-pattern" to={`/atlas?pattern=${ref.slug}`} data-testid={`skills-node-item-pattern-${ticketId}`} title={`Atlas pattern: ${ref.label}`}>{ref.label}</Link>
}

/**
 * The node's one action (SKILLS-17, TREE-12, TREE-13). A tree item that is already `doing` reads OPEN and only navigates, so it writes
 * nothing; every other ticket reads START and starts the ticket. `accent` makes it the screen's one accent button.
 */
export function NodeStart({ next, tree, accent }: { next: Ticket; tree: boolean; accent: boolean }) {
  const start = useStartTicket()
  const navigate = useNavigate()
  const open = tree && next.status === 'doing'
  return (
    <Button
      variant={accent ? 'accent' : undefined} data-accent={accent ? 'primary' : undefined} data-testid="skills-node-start"
      disabled={open ? false : isReadOnly()} onClick={() => { if (open) navigate(treeItemRoute(next)); else void start(next) }}
    >{verbObject(open ? 'OPEN' : 'START', next.kind)}</Button>
  )
}
