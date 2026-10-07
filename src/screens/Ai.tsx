import { Fragment, lazy, Suspense } from 'react'
import { usePlan } from '../app/providers'
import { AGENT_BUCKETS, GPU_BUDGET, TUTOR_PROMPTS } from '../content/workingWithAi'
import { useSettings, useTickets } from '../data/hooks'
import { useArtifacts, useBlankTests } from '../data/projectHooks'
import type { PlanJson, Ticket } from '../data/types'
import { pad2 } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { intParam, useQuery } from '../lib/useQueryParam'
import { rungMeasured } from '../rules/artifacts'
import {
  checkpointAfterStage, defaultStage, SESSION_LABELS, sessionBalance, shelfBySkill, STAGE_SESSIONS, stageBands, stageLabel,
  stageProgress, type ShelfGroup, type StageBand, type StageProgress, type StageRow, type StageState,
} from '../rules/capstone'
import { CHECKPOINT_SPRINT } from '../rules/overview'
import { effectiveLastSprint, sprintRangeLabel, viewSprint } from '../rules/sprint'
import { SESSION_NAMES } from '../rules/stageCubes'
import { GroupedColumns } from '../ui/charts'
import { ExtLink, PromptBlock, ProseTableView } from '../ui/Prose'
import { TickBox, TicketRow } from '../ui/TicketRow'
import { Panel } from '../ui/primitives'
import { CubeMark } from './ai/CubeMark'
import './ai.css'
import { shownText } from '../rules/ticketText'
import { Loading } from '../ui/Loading'
import { WithFileRefs } from '../ui/FileRefs'

// Lazy: the six AiProjects regions (build board, timeline, measures wall, …) are heavy and
// only needed on this screen, so keep them out of the main chunk (chain P task 3).
const AiProjects = lazy(() => import('./ai/AiProjects').then(m => ({ default: m.AiProjects })))

const STATE_LABEL: Record<StageState, string> = { done: 'Done', current: 'Now', behind: 'Behind', upcoming: 'Upcoming' }

export function Ai() {
  const plan = usePlan()
  const tickets = useTickets()
  const settings = useSettings()
  const t = useNow(60_000)
  const artifacts = useArtifacts()
  const blankTests = useBlankTests()
  const { params, set } = useQuery()
  if (!tickets || !settings || !artifacts || !blankTests) return <Loading />
  const bands = stageBands(plan)
  const shelf = shelfBySkill(plan)
  if (bands.length === 0) {
    return (
      <div className="content-screen ai">
        <h1 className="screen-title">AI · capstone</h1>
        <Panel title="Capstone"><p className="empty" data-testid="ai-empty">This plan has no capstone stages</p></Panel>
        {shelf.length > 0 && <Shelf groups={shelf} />}
        <WorkingWithAi />
      </div>
    )
  }
  const lastSprint = effectiveLastSprint(tickets)
  const current = viewSprint(t, settings.startDate, lastSprint)
  const progress = new Map(bands.map(b => [b.stage, stageProgress(b, tickets, current)]))
  const sel = intParam(params, 'stage')
  const band = bands.find(b => b.stage === sel) ?? defaultStage(bands, progress)!
  const openSprint = intParam(params, 'sprint')
  const after = checkpointAfterStage(bands, CHECKPOINT_SPRINT)
  const balance = sessionBalance(tickets)
  return (
    <div className="content-screen ai">
      <h1 className="screen-title">AI · capstone</h1>
      <Suspense fallback={<Loading />}>
        <AiProjects
          tickets={tickets}
          artifacts={artifacts}
          blankTests={blankTests}
          startDate={settings.startDate}
          nowMs={t}
          lastSprint={lastSprint}
          onStage={n => set({ stage: n, sprint: null })}
        />
      </Suspense>
      <Panel title="Stage ladder">
        <ol className="stage-ladder" data-testid="stage-ladder">
          {bands.map(b => {
            const p = progress.get(b.stage)!
            return (
              <Fragment key={b.stage}>
                <li className="stage-li">
                  <button
                    type="button"
                    className={`stage-band state-${p.state}${b.stage === band.stage ? ' sel' : ''}`}
                    aria-pressed={b.stage === band.stage}
                    data-testid={`stage-${b.stage}`}
                    onClick={() => set({ stage: b.stage, sprint: null })}
                  >
                    <span className="stage-name">{stageLabel(b.stage)} · {b.title}</span>
                    <span className="stage-range">{sprintRangeLabel(b.from, b.to)}</span>
                    <span className="stage-count" data-testid={`stage-count-${b.stage}`}>{p.done}/{p.total}</span>
                    <span className="state-chip" data-testid={`stage-state-${b.stage}`}>{STATE_LABEL[p.state]}</span>
                  </button>
                  <CubeMark
                    state={rungMeasured(artifacts, b.stage) ? 'full' : 'empty'}
                    name={`${stageLabel(b.stage)} artifact ${rungMeasured(artifacts, b.stage) ? 'measured' : 'not measured'}`}
                    testId={`ai-rung-${pad2(b.stage)}`}
                  />
                </li>
                {after === b.stage && <li className="checkpoint" data-testid="checkpoint">Checkpoint · S{CHECKPOINT_SPRINT}</li>}
              </Fragment>
            )
          })}
        </ol>
      </Panel>
      <StageDetail
        band={band}
        progress={progress.get(band.stage)!}
        plan={plan}
        openSprint={openSprint}
        onSprint={s => set({ stage: band.stage, sprint: s })}
      />
      <Panel title="Session balance">
        <GroupedColumns
          label="Stage sessions done vs total"
          series={[{ key: 'total', label: 'Total', tone: 'muted' }, { key: 'done', label: 'Done', tone: 'accent' }]}
          groups={STAGE_SESSIONS.map(k => ({ label: SESSION_LABELS[k], values: [balance[k].total, balance[k].done] }))}
        />
        <ul className="balance-list">
          {STAGE_SESSIONS.map(k => (
            <li key={k}>{SESSION_LABELS[k]} <b data-testid={`balance-${k}`}>{balance[k].done}/{balance[k].total}</b></li>
          ))}
        </ul>
      </Panel>
      {shelf.length > 0 && <Shelf groups={shelf} />}
      <WorkingWithAi />
    </div>
  )
}

function StageDetail({
  band, progress, plan, openSprint, onSprint,
}: { band: StageBand; progress: StageProgress; plan: PlanJson; openSprint: number | null; onSprint: (sprint: number) => void }) {
  const open = progress.rows.find(r => r.sprint === openSprint) ?? null
  const proof = open ? plan.sprints.find(s => s.sprint === open.sprint)?.proof ?? null : null
  return (
    <Panel title={`${stageLabel(band.stage)} · ${band.title}`} data-testid="stage-detail">
      <p className="hint">{sprintRangeLabel(band.from, band.to)} · {progress.done}/{progress.total} done</p>
      <div className="stage-rows">
        {progress.rows.map(r => (
          <div key={r.sprint} className={`stage-row${open?.sprint === r.sprint ? ' open' : ''}`}>
            <button
              type="button"
              className="stage-row-label"
              aria-expanded={open?.sprint === r.sprint}
              data-testid={`stage-row-${r.sprint}`}
              onClick={() => onSprint(r.sprint)}
            >
              S{r.sprint}
            </button>
            <div className="stage-cubes">
              {STAGE_SESSIONS.map(k => {
                const tk = r.cells[k]
                return (
                  <span key={k} className="cube-cell">
                    {tk ? <TickBox ticket={tk} pressed label={`${SESSION_NAMES[k]} · S${r.sprint}`} testId={`cube-${tk.id}`} /> : <span className="tick-slot" aria-hidden="true" />}
                    <span className="cube-label">{SESSION_LABELS[k]}</span>
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {open && <SprintTickets row={open} proof={proof} />}
    </Panel>
  )
}

function SprintTickets({ row, proof }: { row: StageRow; proof: string | null }) {
  const list = STAGE_SESSIONS.map(k => row.cells[k]).filter((x): x is Ticket => x !== null)
  return (
    <div className="sprint-tickets" data-testid="sprint-tickets">
      <h3 className="sub-title">S{row.sprint} tickets</h3>
      {list.map(tk => (
        <div key={tk.id} className="stage-ticket">
          <TicketRow ticket={tk} title={`${tk.session ? SESSION_LABELS[tk.session] : 'Stage'} · ${tk.title}`} />
          {shownText(tk.text) && <p className="ticket-text"><WithFileRefs text={shownText(tk.text)} /></p>}
          {tk.links.length > 0 && (
            <p className="ticket-links">
              {tk.links.map(l => (
                <ExtLink key={l.url} link={l} />
              ))}
            </p>
          )}
        </div>
      ))}
      {proof && <p className="proof" data-testid="sprint-proof"><b>Proof</b> {proof}</p>}
    </div>
  )
}

function Shelf({ groups }: { groups: ShelfGroup[] }) {
  const count = groups.reduce((a, g) => a + g.items.length, 0)
  return (
    <details className="sr-panel shelf" data-testid="shelf">
      <summary className="sr-panel-title">Optional shelf · {count}</summary>
      {groups.map(g => (
        <section key={g.skill} className="shelf-group">
          <h3 className="sub-title">{g.label}</h3>
          <ul className="prose-list">
            {g.items.map((it, i) => (
              <li key={i}>
                {it.text}
                {it.links.map(l => (
                  <span key={l.url}> <ExtLink link={l} /></span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  )
}

function WorkingWithAi() {
  return (
    <section className="working-with-ai">
      <h2 className="screen-title wwai-title">Working with AI</h2>
      <ProseTableView table={AGENT_BUCKETS} />
      <Panel title="Tutor prompts, copy and use">
        {TUTOR_PROMPTS.map(p => <PromptBlock key={p.title} prompt={p} />)}
      </Panel>
      <ProseTableView table={GPU_BUDGET} />
    </section>
  )
}
