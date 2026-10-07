import { useEffect, useRef } from 'react'
import { useNavigationType } from 'react-router-dom'
import type { Ticket } from '../data/types'
import { usePlan } from '../app/providers'
import { DSA_INTRO, DSA_SOURCES, learnLinks } from '../content/dsaLearn'
import { useTickets } from '../data/hooks'
import { sprintParam, useQuery } from '../lib/useQueryParam'
import { DIFFICULTIES, DIFFICULTY_LABELS, dsaTopics, dsaTotals, type DsaProblemView, type DsaTopicView } from '../rules/dsa'
import { GroupedColumns } from '../ui/charts'
import { ExtLink, ProseSectionView } from '../ui/Prose'
import { Stat } from '../ui/Stat'
import { TicketRow } from '../ui/TicketRow'
import { useTick } from '../ui/useTick'
import { Panel } from '../ui/primitives'
import { Warmup } from './dsa/Warmup'
import './dsa.css'
import { Loading } from '../ui/Loading'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Room left below the player's last control row when the page scrolls to it. */
const CONTROLS_MARGIN = 16
const PLAYER_WAIT_MS = 2000

/**
 * UAT r3 J2: a topic click brings its detail into view, top-aligned. UAT r4 #10: then, once the warm-up player is
 * there, far enough that its step controls (and the row under them) are on screen, never past the player's top.
 */
function revealDetail() {
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
  const detail = document.querySelector<HTMLElement>('[data-testid="topic-detail"]')
  if (!detail) return
  detail.scrollIntoView?.({ behavior, block: 'start' })
  const started = performance.now()
  const settle = () => {
    const player = detail.querySelector<HTMLElement>('[data-testid="lab-player"]')
    const bars = player?.querySelectorAll<HTMLElement>('.lab-bar')
    const last = bars?.[bars.length - 1]
    if (!player || !last) {
      if (performance.now() - started < PLAYER_WAIT_MS) requestAnimationFrame(settle)
      return
    }
    const abs = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY
    const margin = parseFloat(getComputedStyle(detail).scrollMarginTop) || 0
    const detailTop = abs(detail) - margin
    const need = last.getBoundingClientRect().bottom + window.scrollY + CONTROLS_MARGIN - window.innerHeight
    if (need > detailTop) window.scrollTo?.({ top: Math.max(0, Math.min(need, abs(player) - CONTROLS_MARGIN)), behavior })
  }
  requestAnimationFrame(settle)
}

export function Dsa() {
  const plan = usePlan()
  const tickets = useTickets()
  const { params, set } = useQuery()
  // UAT r3 J2: the topic detail opens below the fold, so a click on a topic scrolls it into view (top-aligned).
  // Only a click: a topic restored from the URL (Back) keeps the position the user left.
  // UAT cu-6 P3-5: arriving from another screen by a link that names a topic (a plan marker, a heat cell in Banks) is
  // a click too: the detail is far below the fold, so it is brought into view once the topic is on screen. A reload or
  // Back / Forward (a POP) still keeps its own position.
  const navType = useNavigationType()
  const shown = sprintParam(params, 'topic')
  const reveal = useRef(navType !== 'POP' && shown !== null)
  const ready = !!tickets
  useEffect(() => {
    if (!reveal.current || !ready) return
    reveal.current = false
    revealDetail()
  }, [shown, ready])
  if (!tickets) return <Loading />
  if (plan.dsa_bank.length === 0) {
    return (
      <div className="content-screen">
        <h1 className="screen-title">DSA bank</h1>
        <Panel title="DSA"><p className="empty" data-testid="dsa-empty">No DSA bank in this plan</p></Panel>
      </div>
    )
  }
  const topics = dsaTopics(plan, tickets)
  const totals = dsaTotals(topics)
  const sel = sprintParam(params, 'topic')
  const topic = sel === null ? null : topics.find(t => t.sprint === sel) ?? null
  return (
    <div className="content-screen dsa">
      <h1 className="screen-title">DSA bank</h1>
      <div className="stat-strip">
        <Stat value={`${totals.solved}/${totals.total}`} label="problems solved" testId="dsa-solved" />
        <Stat value={totals.hardSolved} label="hard solved" testId="dsa-hard" />
        <Stat value={totals.premiumLeft} label="premium left" testId="dsa-premium" />
      </div>
      <div className="dsa-top">
        <Panel title="By difficulty">
          <GroupedColumns
            label="Solved vs total by difficulty"
            series={[{ key: 'total', label: 'Total', tone: 'muted' }, { key: 'solved', label: 'Solved', tone: 'accent' }]}
            groups={DIFFICULTIES.map(k => ({ label: DIFFICULTY_LABELS[k], values: [totals.byDifficulty[k].total, totals.byDifficulty[k].solved] }))}
          />
        </Panel>
        <Panel title="Topics">
          <Heatmap topics={topics} selected={topic?.sprint ?? null} onSelect={s => { if (s === shown) revealDetail(); else { reveal.current = true; set({ topic: s }) } }} />
        </Panel>
      </div>
      {topic ? <TopicDetail topic={topic} /> : <p className="hint dsa-pick-hint" data-testid="dsa-hint">Pick a topic to see its problems.</p>}
      <ProseSectionView section={DSA_INTRO} />
    </div>
  )
}

function Heatmap({ topics, selected, onSelect }: { topics: DsaTopicView[]; selected: number | null; onSelect: (sprint: number) => void }) {
  const tick = useTick()
  return (
    <div className="heatmap">
      {topics.map(t => (
        <div key={t.sprint} className={`heat-row${selected === t.sprint ? ' sel' : ''}`} data-testid={`heat-row-${t.sprint}`}>
          <button
            type="button"
            className="heat-label"
            aria-pressed={selected === t.sprint}
            data-testid={`topic-${t.sprint}`}
            onClick={() => onSelect(t.sprint)}
          >
            <span className="heat-sprint">S{t.sprint}</span>
            <span className="heat-topic">{t.topic}</span>
            <span className="heat-count">{t.solved}/{t.total}</span>
          </button>
          <div className="heat-cells">
            {t.problems.map(p => <HeatCell key={p.id} p={p} onTick={tick} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function HeatCell({ p, onTick }: { p: DsaProblemView; onTick: (t: Ticket) => Promise<unknown> }) {
  const label = `${p.num} ${p.name}, ${DIFFICULTY_LABELS[p.difficulty]}${p.premium ? ', premium' : ''}, ${p.solved ? 'solved' : 'unsolved'}`
  return (
    <button
      type="button"
      className={`heat-cell diff-${p.difficulty}${p.solved ? ' solved' : ''}`}
      aria-pressed={p.solved}
      aria-label={label}
      title={label}
      disabled={!p.ticket}
      data-testid={`cell-${p.id}`}
      data-premium={p.premium ? 'true' : undefined}
      onClick={() => {
        if (p.ticket) void onTick(p.ticket)
      }}
    />
  )
}

function TopicDetail({ topic }: { topic: DsaTopicView }) {
  const links = learnLinks(topic.sprint, usePlan().learner)
  return (
    <Panel title={`S${topic.sprint} · ${topic.topic}`} data-testid="topic-detail">
      <Warmup key={topic.sprint} sprint={topic.sprint} />
      <p className="topic-meta"><b>Pattern</b> {topic.pattern}</p>
      <p className="topic-meta">{topic.note}</p>
      {links.length > 0 && (
        <p className="topic-links">
          Study:
          {links.map(l => (
            <ExtLink key={l.url} link={l} />
          ))}
        </p>
      )}
      <ProseSectionView section={DSA_SOURCES} plain />
      <h3 className="sub-title">Problems · {topic.solved}/{topic.total}</h3>
      <div className="rows">
        {topic.problems.map(p => (
          <TicketRow key={p.id} ticket={p.ticket} title={`${p.num} · ${p.name}`}>
            <span className={`chip diff-chip diff-${p.difficulty}`}>{p.difficulty}</span>
            {p.premium && <span className="chip">P</span>}
            <ExtLink link={{ label: 'LeetCode', url: p.url }} />
            {p.neetcode && <ExtLink link={{ label: 'NeetCode', url: p.neetcode }} />}
          </TicketRow>
        ))}
      </div>
    </Panel>
  )
}
