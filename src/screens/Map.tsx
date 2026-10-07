import type { KeyboardEvent } from 'react'
import { usePlan } from '../app/providers'
import { useSettings, useTickets } from '../data/hooks'
import type { PlanSkill, Ticket } from '../data/types'
import { useNow } from '../lib/useNow'
import { intParam, useQuery } from '../lib/useQueryParam'
import {
  journey, skillGates, skillProgress, skillSprints, skillStates, sprintPath, sprintView, UNLOCK_AT,
  type PathRow, type SkillProgressMap, type SkillState, type SprintView,
} from '../rules/map'
import { effectiveLastSprint, sprintRangeLabel, viewSprint } from '../rules/sprint'
import { TicketRow } from '../ui/TicketRow'
import { Button, Panel } from '../ui/primitives'
import { SkillTree } from './SkillTree'
import './map.css'
import { Loading } from '../ui/Loading'

const STATE_LABEL: Record<SkillState, string> = { done: 'Done', active: 'In progress', open: 'Available', locked: 'Locked' }
const pct = (x: number) => `${Math.round(x * 100)}%`

export function MapView() {
  const plan = usePlan()
  const tickets = useTickets()
  const settings = useSettings()
  const t = useNow(60_000)
  const { params, set } = useQuery()
  if (!tickets || !settings) return <Loading />
  const current = viewSprint(t, settings.startDate, effectiveLastSprint(tickets))
  const skills = plan.skills ?? []
  const progress = skillProgress(skills, tickets)
  const states = skillStates(skills, progress)
  const gates = skillGates(skills, progress)
  const skill = skills.find(s => s.id === params.get('skill')) ?? null
  const selSprint = intParam(params, 'sprint')
  const stops = journey(plan.phases ?? [], current)
  const maxPlanSprint = Math.max(...plan.sprints.map(s => s.sprint))
  const maxSprint = effectiveLastSprint(tickets, maxPlanSprint)
  const path = sprintPath(plan, tickets, current, maxSprint)
  return (
    <div className="content-screen map">
      <h1 className="screen-title">Map</h1>
      {stops.length > 0 && (
        <Panel title="Journey">
          <ol className="journey">
            {stops.map((s, i) => (
              <li key={s.n}>
                <button type="button" className={`stop state-${s.state}`} data-testid={`phase-${i}`} onClick={() => set({ sprint: s.firstSprint })}>
                  <span className="stop-name">{s.n}</span>
                  <span className="stop-range">S{s.firstSprint}–S{s.lastSprint}</span>
                  <span className="stop-note">{s.note}</span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {selSprint !== null && (
        <SprintPanel view={sprintView(plan, tickets, selSprint)} sprint={selSprint} max={maxSprint} onStep={n => set({ sprint: n })} />
      )}
      <Panel title="Sprint path">
        <SprintPathView blocks={path} selected={selSprint} onPick={n => set({ sprint: n })} />
      </Panel>
      {skills.length > 0 && (
        <>
          <Panel title="Skill tree">
            <SkillTree skills={skills} progress={progress} states={states} gates={gates} selected={skill?.id ?? null} onSelect={id => set({ skill: id })} />
            <div className="tree-legend">
              <span className="lg lg-done">done</span>
              <span className="lg lg-active">in progress</span>
              <span className="lg lg-open">available</span>
              <span className="lg lg-locked">locked</span>
            </div>
          </Panel>
          {skill ? (
            <SkillDetail skill={skill} skills={skills} progress={progress} states={states} tickets={tickets}
              onSkill={id => set({ skill: id })} onSprint={n => set({ sprint: n })} />
          ) : (
            <p className="hint" data-testid="skill-hint">Pick a node to see what it is, why it matters, and what holds it back.</p>
          )}
        </>
      )}
    </div>
  )
}

function SprintPanel({ view, sprint, max, onStep }: { view: SprintView | null; sprint: number; max: number; onStep: (n: number) => void }) {
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft' && sprint > 1) {
      e.preventDefault()
      onStep(sprint - 1)
    } else if (e.key === 'ArrowRight' && sprint < max) {
      e.preventDefault()
      onStep(sprint + 1)
    }
  }
  return (
    <section className="sr-panel sprint-view" tabIndex={0} onKeyDown={onKey} aria-label={`Sprint ${sprint}`} data-testid="sprint-view">
      <div className="sprint-head">
        <Button data-testid="sprint-prev" disabled={sprint <= 1} onClick={() => onStep(sprint - 1)}>‹ Prev</Button>
        <h2 className="sr-panel-title sprint-title" data-testid="sprint-title">
          Sprint {sprint}{view ? ` · Block ${view.block}: ${view.blockTitle}` : ''}
        </h2>
        <Button data-testid="sprint-next" disabled={sprint >= max} onClick={() => onStep(sprint + 1)}>Next ›</Button>
      </div>
      {!view ? (
        <p className="empty">No plan data for S{sprint}</p>
      ) : (
        <>
          <p className="hint">{view.blockTheme}</p>
          <div className="two-col">
            <TicketList title={`AI · ${view.focusAi}`} tickets={view.ai} />
            <TicketList title={`Interview · ${view.focusInterview}`} tickets={view.interview} />
          </div>
          {view.proof && <p className="map-proof" data-testid="sprint-view-proof"><b>Proof</b> {view.proof}</p>}
        </>
      )}
    </section>
  )
}

function TicketList({ title, tickets }: { title: string; tickets: Ticket[] }) {
  return (
    <div>
      <h3 className="sub-title">{title}</h3>
      <div className="rows">
        {tickets.map(tk => <TicketRow key={tk.id} ticket={tk} title={tk.title} />)}
        {tickets.length === 0 && <p className="empty">Nothing homed here.</p>}
      </div>
    </div>
  )
}

function SprintPathView({ blocks, selected, onPick }: { blocks: PathRow[]; selected: number | null; onPick: (n: number) => void }) {
  return (
    <div className="path">
      {blocks.map(b => (
        <div key={b.from} className="path-row">
          <span className="path-title">{sprintRangeLabel(b.from, b.to)} · {b.title}</span>
          <div className="path-sprints">
            {b.sprints.map(s => (
              <button
                key={s.sprint}
                type="button"
                className={`path-sprint${s.cleared ? ' cleared' : ''}${s.current ? ' current' : ''}${selected === s.sprint ? ' sel' : ''}`}
                aria-label={`Sprint ${s.sprint}${s.cleared ? ', cleared' : ''}${s.current ? ', current' : ''}`}
                aria-pressed={selected === s.sprint}
                data-testid={`path-${s.sprint}`}
                onClick={() => onPick(s.sprint)}
              >
                <span className="path-num">S{s.sprint}</span>
                <span className="path-cubes">
                  {s.cubes.map((st, i) => <i key={i} className={`pc pc-${st}`} />)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillDetail({
  skill, skills, progress, states, tickets, onSkill, onSprint,
}: {
  skill: PlanSkill
  skills: PlanSkill[]
  progress: SkillProgressMap
  states: Record<string, SkillState>
  tickets: Ticket[]
  onSkill: (id: string) => void
  onSprint: (n: number) => void
}) {
  const labels = new Map(skills.map(s => [s.id, s.label]))
  const p = progress[skill.id]
  const sprints = skillSprints(skill.id, tickets)
  return (
    <Panel title={skill.label} data-testid="skill-detail">
      <p className="hint">{STATE_LABEL[states[skill.id]]} · {p.total ? `${p.done}/${p.total} tickets · ${pct(p.pct)}` : 'no tickets'}</p>
      <p className="skill-what" data-testid="skill-what">{skill.what}</p>
      <p className="skill-why" data-testid="skill-why"><b>Why</b> {skill.why}</p>
      {skill.needs.length > 0 && (
        <>
          <h3 className="sub-title">{`Needs (unlocks at ${Math.round(UNLOCK_AT * 100)}% each)`}</h3>
          <ul className="needs">
            {skill.needs.map(n => (
              <li key={n}>
                <button type="button" className={`need state-${states[n] ?? 'open'}`} data-testid={`need-${n}`} onClick={() => onSkill(n)}>
                  {labels.get(n) ?? n} · {progress[n]?.total ? pct(progress[n].pct) : 'no tickets'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="sub-title">Sprints with {skill.label} tickets</h3>
      {sprints.length === 0 ? (
        <p className="empty">No tickets carry this skill.</p>
      ) : (
        <p className="skill-sprints">
          {sprints.map(s => (
            <button key={s} type="button" className="sprint-link" data-testid={`skill-sprint-${s}`} onClick={() => onSprint(s)}>S{s}</button>
          ))}
        </p>
      )}
    </Panel>
  )
}
