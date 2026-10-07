import { Link } from 'react-router-dom'
import { usePlan } from '../app/providers'
import {
  BLOCK_CLOSE, DAY_DURATIONS, FULL_DAY, newsSlot, SPRINT_CLOSE, STUCK_PROTOCOL, weekdayTimeline,
} from '../content/ritual'
import { blockSpan, scheduleOf } from '../content/schedule'
import { TUTOR_PROMPTS } from '../content/workingWithAi'
import { WEEKDAYS } from '../lib/dates'
import { roleTrack } from '../rules/week'
import { PromptBlock, ProseSectionView, ProseTableView } from '../ui/Prose'
import { Panel } from '../ui/primitives'
import './ritual.css'

export function Ritual() {
  const plan = usePlan()
  const schedule = scheduleOf(plan)
  return (
    <div className="content-screen ritual">
      <h1 className="screen-title">Ritual</h1>
      <Panel title="The rotation">
        <p className="prose-intro">{schedule.intro}</p>
        <div className="ritual-days">
          {WEEKDAYS.map(d => {
            const role = plan.rotation[d] ?? ''
            const track = roleTrack(role)
            return (
              <article key={d} className={`ritual-day track-${track ?? 'none'}${track === 'off' ? ' rest' : ''}`} data-testid={`ritual-${d}`}>
                <h3 className="ritual-name">{FULL_DAY[d]} · {role || '—'}</h3>
                <p className="ritual-dur">{DAY_DURATIONS[d]}</p>
              </article>
            )
          })}
        </div>
      </Panel>
      <div className="two-col">
        <ProseTableView table={weekdayTimeline(schedule)} testId="weekday" highlightRow={r => r[0] === blockSpan(schedule)} />
        <ProseSectionView section={newsSlot(schedule)} />
      </div>
      <div className="two-col">
        <ProseSectionView section={SPRINT_CLOSE} />
        <div className="block-close">
          <ProseSectionView section={BLOCK_CLOSE} />
          <Link to="/map" className="sr-btn sr-btn-quiet" data-testid="open-map">Check the skill tree on the Map ▸</Link>
        </div>
      </div>
      <ProseSectionView section={STUCK_PROTOCOL} />
      <Panel title="Tutor prompts, copy and use">
        {TUTOR_PROMPTS.map(p => <PromptBlock key={p.title} prompt={p} />)}
      </Panel>
    </div>
  )
}
