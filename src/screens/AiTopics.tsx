import { Link, useSearchParams } from 'react-router-dom'
import { useRequiredPlanV2 } from '../app/providers'
import { useTickets } from '../data/hooks'
import { aiTopics, hoursLabel, kindChipLabel, parseTopicFilter, type TopicFilter } from '../rules/aiTopics'
import { Loading } from '../ui/Loading'
import './ai-topics.css'

/**
 * AI topics (NAV-15 to NAV-26): every AI skill node on one page, grouped by AI area, with its ticket count, done count, kinds and hours.
 * Filters by phase and kind live in the URL (`?phase=&kind=`). A row opens the node in Skills. The page only reads.
 */
export function AiTopics() {
  const plan = useRequiredPlanV2()
  const tickets = useTickets()
  const [params, setParams] = useSearchParams()
  if (!tickets) return <Loading />
  const chips = aiTopics(plan, tickets, { phase: null, kind: null })
  const filter = parseTopicFilter(params, chips.phases, chips.kinds)
  const view = aiTopics(plan, tickets, filter)

  // a filter change replaces the entry, so Back from a node row returns to the filtered page and the history is not one entry per click
  const choose = (next: TopicFilter) => {
    const q = new URLSearchParams()
    if (next.phase !== null) q.set('phase', String(next.phase))
    if (next.kind !== null) q.set('kind', next.kind)
    setParams(q, { replace: true })
  }
  const filtered = filter.phase !== null || filter.kind !== null

  return (
    <div className="content-screen at" data-testid="ai-topics-page">
      <h1 className="screen-title" data-testid="ai-topics-title">AI topics</h1>
      <p className="at-summary" data-testid="ai-topics-summary" data-done={view.done} data-total={view.total} data-minutes={view.minutes}>
        {view.done} of {view.total} tickets done · {hoursLabel(view.minutes)}
      </p>
      <div className="at-filters">
        <div className="at-chips" role="group" aria-label="Phase">
          <button type="button" className="at-chip" data-testid="ai-topics-filter-phase-all" aria-pressed={filter.phase === null} onClick={() => choose({ ...filter, phase: null })}>All phases</button>
          {chips.phases.map(p => (
            <button key={p} type="button" className="at-chip" data-testid={`ai-topics-filter-phase-${p}`} aria-pressed={filter.phase === p} onClick={() => choose({ ...filter, phase: p })}>Phase {p}</button>
          ))}
        </div>
        <div className="at-chips" role="group" aria-label="Kind">
          <button type="button" className="at-chip" data-testid="ai-topics-filter-kind-all" aria-pressed={filter.kind === null} onClick={() => choose({ ...filter, kind: null })}>All kinds</button>
          {chips.kinds.map(k => (
            <button key={k} type="button" className="at-chip" data-testid={`ai-topics-filter-kind-${k}`} aria-pressed={filter.kind === k} onClick={() => choose({ ...filter, kind: k })}>{kindChipLabel(k)}</button>
          ))}
        </div>
      </div>
      {view.areas.length === 0 ? (
        <div className="sr-panel at-empty" data-testid="ai-topics-empty" data-empty="true">
          <p>No topic matches these filters.</p>
          {filtered && <button type="button" className="sr-btn" data-testid="ai-topics-filter-clear" onClick={() => choose({ phase: null, kind: null })}>Clear filters</button>}
        </div>
      ) : (
        view.areas.map(a => (
          <section key={a.area.id} className="sr-panel at-area" data-testid={`ai-topics-area-${a.area.id}`} aria-labelledby={`at-h-${a.area.id}`}>
            <div className="at-head">
              <h2 className="at-title" id={`at-h-${a.area.id}`} data-testid={`ai-topics-area-title-${a.area.id}`}>
                <span className="at-tag">{a.area.tag}</span> <span data-content="plan">{a.area.name}</span>
              </h2>
              <span className="mono at-meta" data-testid={`ai-topics-area-count-${a.area.id}`} data-done={a.done} data-total={a.total} data-minutes={a.minutes}>
                {a.done} of {a.total} tickets done
              </span>
            </div>
            <ul className="at-nodes">
              {a.nodes.map(n => (
                <li key={n.node.id}>
                  <Link
                    className="at-node" to={`/skills/area/${a.area.id}?node=${n.node.id}`} data-testid={`ai-topics-node-${n.node.id}`}
                    data-area={a.area.id} data-phase={n.node.phase} data-done={n.done} data-total={n.count}
                  >
                    <span className="at-nt" data-content="plan">{n.node.title}</span>
                    <span className="at-fig">
                      <span className="mono at-meta" data-testid={`ai-topics-node-count-${n.node.id}`} data-count={n.count}>{n.count} {n.count === 1 ? 'ticket' : 'tickets'}</span>
                      <span className="mono at-meta" data-testid={`ai-topics-node-done-${n.node.id}`} data-count={n.done}>{n.done} done</span>
                      <span className="mono at-meta" data-testid={`ai-topics-node-hours-${n.node.id}`} data-minutes={n.minutes}>{hoursLabel(n.minutes)}</span>
                    </span>
                    <span className="at-kinds" data-testid={`ai-topics-node-kinds-${n.node.id}`}>
                      {n.kinds.map(k => (
                        <span key={k.kind} className="at-kind" data-testid={`ai-topics-kind-${n.node.id}-${k.kind}`} data-count={k.count}>{kindChipLabel(k.kind)} {k.count}</span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
