import { Link } from 'react-router-dom'
import type { PlanNode, PlanV2 } from '../../data/planV2'
import type { Ticket } from '../../data/types'
import { nodeTickets, type NodeState } from '../../rules/skillTree'
import { isTreeArea, lockedReason, nextItemOf, nextTicketOf, STATE_GLYPH, STATE_WORD, unlocksOf } from '../../rules/skillView'
import { KIND_LABEL, minutesLabel } from '../../rules/ticketMeta'
import { Glyph } from '../../ui/Glyph'
import { SkMeter } from './Meter'
import { NodeItems, NodeStart } from './NodeItems'
import { NodeQuestions, NodeTickets } from './NodeTickets'
import type { TopicView } from './useTopicViews'

/** The selected topic: what it is, what it needs and unlocks, ticket progress and the one way to start its next ticket. */
export function NodePanel({ node, plan, tickets, states, topic }: { node: PlanNode; plan: PlanV2; tickets: readonly Ticket[]; states: ReadonlyMap<string, NodeState>; topic?: TopicView }) {
  const st = states.get(node.id) ?? 'locked'
  const mine = nodeTickets(node.id, tickets)
  const done = mine.filter(t => t.status === 'done').length
  const tree = isTreeArea(node.area)
  // a DSA or Design node takes its first doing item, else its first todo item; any other node its first todo or doing ticket (SKILLS-17)
  const next = tree ? nextItemOf(node.id, tickets) : nextTicketOf(node.id, tickets)
  const reason = lockedReason(node, plan, states)
  const pre = node.pre.map(id => plan.nodes.find(n => n.id === id)).filter((n): n is PlanNode => !!n)
  const after = unlocksOf(node.id, plan)
  return (
    <aside className={tree ? 'sk-panel sk-panel-tree sr-panel' : 'sk-panel sr-panel'} data-testid="skills-node-panel" aria-label="Selected topic" aria-describedby={reason ? `sk-p1-${node.id} sk-p2-${node.id}` : `sk-p1-${node.id}`}>
      <div className="sk-pbody sc">
      <span className="sk-cap">Selected topic</span>
      <div>
        <h3 className="sk-ptitle" data-content="plan">{node.title}</h3>
        <div className="sk-chips">
          <span className="sk-chip">{plan.areas.find(a => a.id === node.area)?.tag}</span>
          <span className="sk-chip">{STATE_WORD[st]}</span>
          {node.hours ? <span className="mono sk-meta">{node.hours} h</span> : null}
        </div>
      </div>
      <p className="sk-meta" id={`sk-p1-${node.id}`} data-content="plan">{node.oneLiner}</p>
      {reason && <p className="sk-meta" id={`sk-p2-${node.id}`} data-content="plan">{reason}</p>}
      {/* R2: where this topic goes next, by its topic state (labs.md); AI nodes only */}
      {topic?.line && (
        <div>
          <span className="sk-cap">Next step</span>
          <p className="sk-meta sk-nextline" data-testid="skills-node-nextline" data-topic-state={topic.state ?? 'none'} data-content="plan">{topic.line}</p>
        </div>
      )}
      {/* a tree node says what it builds on in one line, each title a link to that node in the same tree (no locked state, no "Needs first" list) */}
      {tree && pre.length > 0 && (
        <p className="sk-builds" data-testid="skills-node-builds-on">
          Builds on:{' '}
          {pre.map((n, i) => <span key={n.id}>{i > 0 && ', '}<Link className="sk-builds-link" to={`/skills/${node.area}?node=${n.id}`} data-content="plan">{n.title}</Link></span>)}
        </p>
      )}
      {/* the items are what a tree node is for: they come first, the prerequisites after */}
      {tree && (
        <div>
          <span className="sk-cap">{node.area === 'design' ? 'Designs' : 'Problems'}</span>
          <NodeItems items={mine} />
        </div>
      )}
      {!tree && <div>
        <span className="sk-cap">Needs first</span>
        {pre.length === 0 ? <p className="sk-meta" data-testid="skills-panel-needs-none">None, this topic can start first</p> : (
          <ul className="sk-rel">{pre.map(n => <li key={n.id}><Glyph name={STATE_GLYPH[states.get(n.id) ?? 'locked']} /><span data-content="plan">{n.title}</span><span className="sk-meta">{STATE_WORD[states.get(n.id) ?? 'locked']}</span></li>)}</ul>
        )}
      </div>}
      <div>
        <span className="sk-cap">Unlocks</span>
        {after.length === 0 ? <p className="sk-meta" data-testid="skills-panel-unlocks-none">None yet</p> : (
          <ul className="sk-rel">{after.map(n => <li key={n.id}><Glyph name={STATE_GLYPH[states.get(n.id) ?? 'locked']} /><span data-content="plan">{n.title}</span></li>)}</ul>
        )}
      </div>
      <div className="sk-trow">
        <span className="sk-cap">Tickets {done} of {mine.length}</span>
        <SkMeter done={done} total={mine.length} label="Tickets done" testId={`skills-panel-meter-${node.id}`} segments={Math.min(8, Math.max(1, mine.length))} />
      </div>
      {/* R3: an AI node lists its tickets, read-only (SKILLS-32); an AI or Design node with bank questions links to them (TREE-22) */}
      {!tree && <NodeTickets items={mine} />}
      <NodeQuestions node={node} plan={plan} />
      </div>
      {next ? (
        <div className="sk-pfoot">
          <div className="sk-next"><span className="sk-cap">Next ticket</span><span data-content="plan">{next.title}</span><span className="mono sk-meta">{minutesLabel(next.estMin)} · {KIND_LABEL[next.kind]}</span></div>
          <NodeStart next={next} tree={tree} accent />
        </div>
      ) : mine.length > 0 ? (
        <p className="sk-meta sk-pfoot">{done === mine.length ? 'Every ticket here is done.' : 'Nothing here is ready to start.'}</p>
      ) : null}
    </aside>
  )
}
