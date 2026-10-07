import { usePlan } from '../app/providers'
import { COMMUNITY_BUDGET, MENTOR_LOG, MENTOR_PROTOCOL, MENTOR_RULE, PEOPLE } from '../content/mentors'
import { communitiesByLane } from '../rules/mentors'
import { ExtLink, ProseSectionView, ProseTableView } from '../ui/Prose'
import { Panel } from '../ui/primitives'
import './mentors.css'

export function Mentors() {
  const plan = usePlan()
  const lanes = communitiesByLane(plan)
  return (
    <div className="content-screen mentors">
      <h1 className="screen-title">Mentors</h1>
      <section className="sr-hero mentor-rule" data-testid="mentor-rule">
        <p><b>{MENTOR_RULE.lead}</b> {MENTOR_RULE.text}</p>
      </section>
      <Panel title="The protocol">
        <ol className="protocol">
          {MENTOR_PROTOCOL.map((s, i) => (
            <li key={s.title} className="protocol-step" data-testid={`step-${i + 1}`}>
              <h3 className="sub-title">{s.title}</h3>
              <p>{s.body}</p>
              {s.template && <pre className="prompt">{s.template}</pre>}
            </li>
          ))}
        </ol>
      </Panel>
      <ProseTableView table={MENTOR_LOG} />
      {lanes.length > 0 && (
        <section className="rooms" data-testid="rooms">
          <h2 className="screen-title rooms-title" data-testid="rooms-title">The rooms</h2>
          {lanes.map(g => (
            <Panel key={g.lane} title={g.label} data-testid={`lane-${g.lane}`}>
              <div className="room-cards">
                {g.items.map(c => (
                  <article key={c.n} className="room-card" data-testid="room-card">
                    <header className="room-head">
                      <ExtLink link={{ label: c.n, url: c.u }} className="room-name" />
                      <span className="chip">{c.k}</span>
                    </header>
                    <p className="room-fit">{c.fit}</p>
                    <p className="room-how"><b>How</b> {c.how}</p>
                  </article>
                ))}
              </div>
            </Panel>
          ))}
        </section>
      )}
      <div className="two-col">
        <ProseSectionView section={COMMUNITY_BUDGET} />
        <ProseSectionView section={PEOPLE} />
      </div>
    </div>
  )
}
