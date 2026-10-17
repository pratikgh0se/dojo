import { createContext, useContext } from 'react'
import { Link } from 'react-router-dom'
import type { PlanNode, PlanV2 } from '../../data/planV2'
import type { BankExtraRow, Status, Ticket } from '../../data/types'
import { nodeQuestionCount } from '../../rules/bankQuestions'
import { treeItemRoute } from '../../rules/skillView'
import { KIND_LABEL, minutesLabel } from '../../rules/ticketMeta'

const MARK: Partial<Record<Status, string>> = { done: 'Done', doing: 'In progress', blocked: 'Blocked', help: 'Needs help' }

/** SKILLS-32 to SKILLS-34: the read-only ticket list of an AI node (`items` are the node's tickets in effective order). A row only links to its ticket and writes nothing; the one action stays Start. */
export function NodeTickets({ items }: { items: readonly Ticket[] }) {
  if (items.length === 0) return null
  return (
    <ul className="sk-items" data-testid="skills-node-tickets" aria-label="Tickets">
      {items.map(t => {
        const done = t.status === 'done'
        const mark = MARK[t.status]
        return (
          <li key={t.id} className="sk-item-li">
            <Link className="sk-item" to={treeItemRoute(t)} data-testid={`skills-node-ticket-${t.id}`} data-status={t.status} data-done={done ? 'true' : 'false'}>
              <span className="sk-item-t" data-content="plan" data-testid={`skills-node-ticket-title-${t.id}`}>{t.title}</span>
              <span className="sk-item-m">
                <span className="mono sk-meta" data-testid={`skills-node-ticket-kind-${t.id}`} data-kind={t.kind}>{KIND_LABEL[t.kind]}</span>
                <span className="mono sk-meta" data-testid={`skills-node-ticket-est-${t.id}`}>{minutesLabel(t.estMin)}</span>
                {mark && <span className={done ? 'sk-item-done' : 'sk-meta'} data-testid={`skills-node-ticket-mark-${t.id}`} data-status={t.status}>{mark}</span>}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The AI-made question rows, read once by the Skills screen (which waits for them) and handed down, so a node's link is drawn together with
 * its panel or row and with its final count (TREE-26). A hook of its own in each link would start unloaded and draw the shipped count first.
 */
export const BankExtraContext = createContext<readonly BankExtraRow[] | undefined>(undefined)

/** TREE-22, TREE-23, TREE-25, TREE-26: "Questions (N)", a plain link to the node's questions in Banks. Absent for a DSA node and when N is 0. Reads the bank, writes nothing, carries no accent. */
export function NodeQuestions({ node, plan }: { node: PlanNode; plan: PlanV2 }) {
  const extra = useContext(BankExtraContext)
  if (node.kind === 'band' || extra === undefined) return null
  const q = nodeQuestionCount(node, plan.qbank, extra)
  if (!q || q.count === 0) return null
  return <Link className="sk-qlink" to={`/banks?area=${q.area}&node=${node.id}`} data-testid="skills-node-questions" data-count={q.count}>Questions ({q.count})</Link>
}
