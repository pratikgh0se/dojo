import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useEvents, useSessions, useSettings, useTickets } from '../data/hooks'
import { useArtifacts, useBlankTests } from '../data/projectHooks'
import { useDesignSessions } from '../data/designHooks'
import { useNow } from '../lib/useNow'
import { stageBadges, stageLabel } from '../rules/capstone'
import { doneSessions, lensStats, redesignPassRate, wallAnswered, wallRows } from '../rules/designEvidence'
import { planDesigns } from '../rules/designs'
import { dsaEvidence, dsaTickedWithoutAttempt, helpLadderUsage, redoHitRate } from '../rules/evidence'
import {
  burnMarkers, burnUp, focusText, outcomesBySprint, pace, RING_KEYS, RING_LABELS, rings, type Verdict,
} from '../rules/progress'
import { effectiveLastSprint, viewSprint } from '../rules/sprint'
import { allStageCubes, evidenceCounts } from '../rules/stageCubes'
import { itemSessions } from '../rules/units'
import { Ring, StackedColumns, SteppedLine, type ChartSeries, type LineMarker } from '../ui/charts'
import { Stat } from '../ui/Stat'
import { Panel } from '../ui/primitives'
import { usePlan } from '../app/providers'
import { Evidence } from './progress/Evidence'
import { StudySessions } from './progress/StudySessions'
import { HelpLadderUsage } from './progress/HelpLadderUsage'
import { RedoHitRate } from './progress/RedoHitRate'
import { Reviews } from './progress/Reviews'
import './progress.css'
import { Loading } from '../ui/Loading'

/** P1 #2: the burn-up is drawn at 720 x 220 intrinsic and scrolls in its well below 760 px. */
const BURN_SIZE = { width: 720, height: 220 }
const VERDICT: Record<Verdict, string> = { ahead: 'Ahead', behind: 'Behind', on: 'On pace' }
const OUTCOME_SERIES: ChartSeries[] = [
  { key: 'solved', label: 'Solved', tone: 'ok' },
  { key: 'solved_help', label: 'Solved with help', tone: 'warn' },
  { key: 'gave_up', label: 'Gave up', tone: 'danger' },
]

export function Progress() {
  const plan = usePlan()
  const tickets = useTickets()
  const sessions = useSessions()
  const events = useEvents()
  const settings = useSettings()
  const designSessions = useDesignSessions()
  const artifacts = useArtifacts()
  const blankTests = useBlankTests()
  const t = useNow(60_000)
  const { hash } = useLocation()
  const ready = !!(tickets && sessions && events && settings && designSessions && artifacts && blankTests)
  // /progress#help-ladder (every ladder "See the honesty chart" link): scroll once the section exists.
  useEffect(() => {
    if (!ready || !hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' })
  }, [ready, hash])
  if (!ready) return <Loading />
  const last = effectiveLastSprint(tickets)
  const cur = viewSprint(t, settings.startDate, last)
  const r = rings(tickets)
  const burn = burnUp(tickets, settings.startDate, cur, last)
  const p = pace(tickets, events, settings.startDate, t, last)
  // ruling 20 S4: a split card's parts count once, as their parent, when all are done
  const counted = itemSessions(sessions, tickets)
  const outcomes = outcomesBySprint(counted, settings.startDate, tickets)
  const badges = stageBadges(tickets)
  const designs = planDesigns(plan)
  const done = doneSessions(designSessions)
  const cubes = allStageCubes(tickets, artifacts, blankTests)
  const evidence = {
    dsa: dsaEvidence(tickets, sessions, events),
    dsaTicked: dsaTickedWithoutAttempt(tickets, sessions),
    design: {
      dives: wallAnswered(wallRows(designs, done)), divesTotal: designs.length * 4,
      redesign: redesignPassRate(designSessions), radar: { stats: lensStats(done), count: done.length },
    },
    ai: evidenceCounts(cubes, artifacts, blankTests),
  }
  const markers: LineMarker[] = burnMarkers(events, settings.startDate, cur, last).map(m => ({
    at: m.sprint,
    kind: m.kind,
    label: m.kind === 'now' ? 'NOW' : m.kind === 'slide' ? 'Slide sprint' : 'Shift plan',
  }))
  return (
    <div className="content-screen progress">
      <h1 className="screen-title">Progress</h1>
      <div className="rings">
        {RING_KEYS.map(k => <Ring key={k} label={RING_LABELS[k]} done={r[k].done} total={r[k].total} testId={`ring-${k}`} />)}
      </div>
      <Panel title="Burn-up">
        <SteppedLine
          label="Planned vs done, cumulative by sprint"
          size={BURN_SIZE}
          series={[
            { key: 'plan', label: 'Plan', tone: 'muted', points: burn.map(b => b.plan) },
            { key: 'done', label: 'Done', tone: 'accent', points: burn.map(b => b.done) },
          ]}
          markers={markers}
        />
        {cur === 0 && <p className="hint" data-testid="burn-before">Plan starts {settings.startDate}: plan line only until Sprint 1.</p>}
      </Panel>
      <PacePanel p={p} />
      <Panel title="Outcomes per sprint">
        {sessions.length === 0 ? (
          <p className="empty" data-testid="no-sessions">No sessions yet</p>
        ) : outcomes.every(o => o.solved + o.solved_help + o.gave_up === 0) ? (
          <p className="empty" data-testid="no-outcomes">No outcomes recorded yet.</p>
        ) : (
          <StackedColumns
            label="Session outcomes per sprint"
            series={OUTCOME_SERIES}
            columns={outcomes.map(o => ({ label: `S${o.sprint}`, values: [o.solved, o.solved_help, o.gave_up] }))}
          />
        )}
      </Panel>
      <StudySessions sessions={sessions} tickets={tickets} />
      <Evidence {...evidence} />
      <HelpLadderUsage rows={helpLadderUsage(counted, settings.startDate)} />
      <RedoHitRate rate={redoHitRate(events)} />
      <Reviews />
      <Panel title="Stage badges">
        <div className="badges">
          {badges.map(b => (
            <span
              key={b.stage}
              className={`badge${b.cleared ? ' on' : ''}`}
              data-testid={`badge-${String(b.stage).padStart(2, '0')}`}
              aria-label={`${stageLabel(b.stage)} ${b.cleared ? 'cleared' : 'open'}`}
            >
              {String(b.stage).padStart(2, '0')}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  )
}

/** ui-progress P1 #3 (handoff "Pace vs plan"): delta bars per track, the overall verdict, one sentence, three wells. */
function PacePanel({ p }: { p: ReturnType<typeof pace> }) {
  // UAT r2 J3: a card counts once. ALL = AI + Interview (the two tracks); DSA and Designs are parts of Interview,
  // shown as their own bars but never added again (a problem ticked under Interview and DSA made "you have 3" of 2)
  const tracks = p.rows.filter(r => r.track === 'ai' || r.track === 'interview')
  const expected = tracks.reduce((a, r) => a + r.expected, 0)
  const done = tracks.reduce((a, r) => a + r.done, 0)
  const tot = done - expected
  const overall: Verdict = tot > 0 ? 'ahead' : tot < 0 ? 'behind' : 'on'
  const scale = Math.max(1, ...p.rows.map(r => Math.abs(r.done - r.expected)))
  const n = Math.abs(tot)
  const sentence = expected === 0 && done === 0
    ? 'Nothing is due yet: the schedule expects 0 tasks ticked by now, so every track is on pace.'
    : `The schedule expects ${expected} ${expected === 1 ? 'task' : 'tasks'} ticked by now across AI and Interview (DSA and Designs are part of Interview); you have ${done}.${tot === 0 ? ' That is exactly on pace.' : ` That is ${n} ${n === 1 ? 'task' : 'tasks'} ${tot > 0 ? 'ahead' : 'behind'}.`} Minimum sprint rule still applies: never restart, slide the date.`
  return (
    <section className="sr-panel pace-panel" aria-label="Pace">
      <div className="pace-head">
        <h2 className="sr-panel-title">Pace</h2>
        <span className={`pace-verdict verdict-${overall}`} data-testid="pace-verdict">{VERDICT[overall]}</span>
      </div>
      <div className="pace-bars console-well" role="list" aria-label="Done minus planned, per track">
        {p.rows.map(row => {
          const d = row.done - row.expected
          const w = `${(Math.abs(d) / scale) * 100}%`
          return (
            <div key={row.track} role="listitem" className={`pace-row verdict-${row.verdict}`} data-testid={`pace-${row.track}`}
              aria-label={`${RING_LABELS[row.track]}: ${row.done} done of ${row.expected} planned, ${VERDICT[row.verdict]}`}>
              <span className="pace-label">{RING_LABELS[row.track]}</span>
              <span className="pace-track" aria-hidden="true">
                <span className="pace-neg">{d < 0 && <i style={{ width: w }} />}</span>
                <span className="pace-pos">{d > 0 && <i style={{ width: w }} />}</span>
              </span>
              <span className="pace-delta">{d > 0 ? `+${d}` : d}</span>
              <span className="pace-word">{VERDICT[row.verdict]}</span>
            </div>
          )
        })}
      </div>
      <p className="pace-text" data-testid="pace-text">{sentence}</p>
      <div className="pace-wells">
        <div className="pace-well"><span className="pace-well-label" title="Logged focus: the finished focus blocks, the same minutes as Today's Focus today and Week">Focus hours</span><span className="pace-well-value" data-testid="pace-hours">{focusText(p)}</span></div>
        <div className="pace-well"><span className="pace-well-label">Hard solved</span><span className="pace-well-value" data-testid="pace-hard">{p.hardSolved}</span></div>
        <div className="pace-well"><span className="pace-well-label">Projected finish</span><span className="pace-well-value" data-testid="pace-finish">{p.finishSprint === null ? '—' : `S${p.finishSprint}`}</span></div>
      </div>
    </section>
  )
}
