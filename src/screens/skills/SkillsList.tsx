import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanNode, PlanV2 } from '../../data/planV2'
import type { Ticket } from '../../data/types'
import { isReadOnly } from '../../data/writer'
import { nodeTickets, type NodeState } from '../../rules/skillTree'
import { isTreeArea, lockedReason, nextItemOf, nextTicketOf, nodeLayers, rowPadding, STATE_ATTR, STATE_GLYPH, STATE_WORD, treeItemRoute } from '../../rules/skillView'
import { verbObject } from '../../rules/ticketMeta'
import { useStartTicket } from '../../study/useStartTicket'
import { Glyph } from '../../ui/Glyph'
import { Button } from '../../ui/primitives'
import { SkMeter, StateGlyph } from './Meter'
import { NodeItems, NodeStart } from './NodeItems'

/** The phone view of one area: an indented tree. Arrows move, right opens a row, left closes it. */
export function SkillsList({ plan, tickets, states, nodes, initialOpen = null }: {
  plan: PlanV2; tickets: readonly Ticket[]; states: ReadonlyMap<string, NodeState>; nodes: PlanNode[]
  /** SKILLS-16: the node named by `?node=` starts expanded and is scrolled into view (NAV-24) */
  initialOpen?: string | null
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen ? { [initialOpen]: true } : {})
  const [focus, setFocus] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])
  const layers = useMemo(() => nodeLayers(nodes), [nodes])
  // a DSA or Design list: its items show in an expanded row, and the one accent sits on the expanded row's action unless the tree has a next node (TREE-19)
  const tree = nodes.length > 0 && nodes.every(n => isTreeArea(n.area))
  const treeHasNext = tree && nodes.some(n => states.get(n.id) === 'next')
  useEffect(() => {
    if (!initialOpen) return
    const i = nodes.findIndex(n => n.id === initialOpen)
    if (i >= 0) { setFocus(i); refs.current[i]?.scrollIntoView?.({ block: 'center' }) }
    // on arrival only: selecting rows by hand never moves the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function key(e: React.KeyboardEvent, i: number, n: PlanNode) {
    if (e.target !== e.currentTarget) return // keys inside an open row (its Start button) are the button's own
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const j = Math.min(nodes.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
      setFocus(j)
      refs.current[j]?.focus()
    } else if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(o => ({ ...o, [n.id]: true })) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(o => ({ ...o, [n.id]: false })) }
    else if (e.key === 'Enter') { e.preventDefault(); setOpen(o => ({ ...o, [n.id]: !o[n.id] })) }
  }

  return (
      <ul className="sk-tree" role="tree" data-testid="skills-list" aria-label="Topics">
        {nodes.map((n, i) => {
          const st = states.get(n.id) ?? 'locked'
          const mine = nodeTickets(n.id, tickets)
          const next = tree ? nextItemOf(n.id, tickets) : nextTicketOf(n.id, tickets)
          const isOpen = !!open[n.id]
          const layer = layers.get(n.id) ?? 0
          const reason = st === 'locked' ? lockedReason(n, plan, states) : ''
          return (
            <li
              key={n.id} ref={el => { refs.current[i] = el }} role="treeitem" aria-level={layer + 1} aria-expanded={isOpen}
              tabIndex={focus === i ? 0 : -1} className="sk-trow-li" data-state={st} data-layer={layer} data-testid={`skills-row-${n.id}`}
              aria-label={`${n.title}, ${STATE_WORD[st]}`} aria-describedby={reason ? `sk-why-${n.id}` : undefined} style={{ paddingLeft: rowPadding(layer) }}
              onFocus={e => { if (e.target === e.currentTarget) setFocus(i) }} onKeyDown={e => key(e, i, n)}
            >
              <span className="sk-line" onClick={() => setOpen(o => ({ ...o, [n.id]: !o[n.id] }))}>
                <StateGlyph id={n.id} attr={STATE_ATTR[st]}><Glyph name={STATE_GLYPH[st]} size={2} /></StateGlyph>
                <span className="sk-rt" data-content="plan">{n.title}</span>
                <SkMeter done={mine.filter(t => t.status === 'done').length} total={mine.length} label="Tickets done" testId={`skills-node-meter-${n.id}`} segments={Math.min(8, Math.max(1, mine.length))} tone={st === 'done' ? 'ok' : 'accent'} />
              </span>
              {/* D5: the reason is said once, on the row that is open; every other locked row keeps it for assistive tech (aria-describedby) */}
              {reason && <span id={`sk-why-${n.id}`} className={isOpen ? 'sk-meta sk-rnote' : 'vh'} data-testid={`skills-reason-${n.id}`} data-content="plan">{reason}</span>}
              {isOpen && (
                <span className="sk-more">
                  <span className="sk-meta" data-content="plan">{n.oneLiner}</span>
                  {tree && <NodeItems items={mine} />}
                  {next && <NodeStart next={next} tree={tree} accent={tree && !treeHasNext} />}
                </span>
              )}
            </li>
          )
        })}
      </ul>
  )
}

/** SKILLS-20: the one next-ticket card, fixed above the tab bar, with the one accent button. The caption names the topic, as in the mockup. */
export function NextPanel({ plan, nextTicket }: { plan: PlanV2; nextTicket: Ticket }) {
  const start = useStartTicket()
  const navigate = useNavigate()
  const readOnly = isReadOnly()
  // a quest that is a DSA or Design item already started reads OPEN and only navigates (TREE-13)
  const open = isTreeArea(nextTicket.area) && nextTicket.status === 'doing'
  const node = plan.nodes.find(n => n.id === nextTicket.node)
  return (
    <section className="sk-nextpanel sr-panel" data-testid="skills-next-panel" aria-label="Next ticket">
      <span className="sk-cap">Next ticket{node ? <> · <span data-content="plan">{node.title}</span></> : null}</span>
      <span data-content="plan">{nextTicket.title}</span>
      <Button variant="accent" data-accent="primary" data-testid="skills-next-start" disabled={open ? false : readOnly} onClick={() => { if (open) navigate(treeItemRoute(nextTicket)); else void start(nextTicket) }}>{verbObject(open ? 'OPEN' : 'START', nextTicket.kind)}</Button>
    </section>
  )
}
