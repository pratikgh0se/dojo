import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlan } from '../app/providers'
import { DESIGN_PRACTICE, DESIGN_SOURCES, DONE_MEANS, RUBRIC, RUBRIC_TOTAL } from '../content/designs'
import { useDesignSessions } from '../data/designHooks'
import { useSettings, useTickets } from '../data/hooks'
import { useNow } from '../lib/useNow'
import { intParam, useQuery } from '../lib/useQueryParam'
import { doneSessions, wallAnswered, wallRows } from '../rules/designEvidence'
import {
  DEEP_DIVES_PER_DESIGN, designCallout, designTiers, designTotals, planDesigns,
  type DesignCallout, type DesignItemView, type DesignTierView,
} from '../rules/designs'
import { effectiveLastSprint, viewSprint } from '../rules/sprint'
import { ExtLink, ProseSectionView } from '../ui/Prose'
import { Stat } from '../ui/Stat'
import { TicketRow } from '../ui/TicketRow'
import { Button, Cube, Panel } from '../ui/primitives'
import { DesignCharts } from './designs/DesignCharts'
import { DesignEvidence } from './designs/DesignEvidence'
import './designs.css'
import { Loading } from '../ui/Loading'

export function Designs() {
  const plan = usePlan()
  const tickets = useTickets()
  const settings = useSettings()
  const t = useNow(60_000)
  const { params, set } = useQuery()
  const sessions = useDesignSessions()
  if (!tickets || !settings || !sessions) return <Loading />
  if (plan.design_bank.length === 0) {
    return (
      <div className="content-screen">
        <h1 className="screen-title">Design bank</h1>
        <Panel title="Designs"><p className="empty" data-testid="designs-empty">No design bank in this plan</p></Panel>
      </div>
    )
  }
  const tiers = designTiers(plan, tickets)
  const totals = designTotals(tiers)
  const designs = planDesigns(plan)
  const rows = wallRows(designs, doneSessions(sessions))
  const current = viewSprint(t, settings.startDate, effectiveLastSprint(tickets))
  const callout = designCallout(tiers, current)
  const sel = intParam(params, 'tier')
  const tier = tiers.find(x => x.index === sel) ?? null
  return (
    <div className="content-screen designs">
      <h1 className="screen-title">Design bank</h1>
      <div className="stat-strip">
        <Stat value={`${totals.done}/${totals.total}`} label="designs done" testId="designs-done" />
        <Stat value={totals.deepDivesCovered} label={`deep dives covered (${DEEP_DIVES_PER_DESIGN} per done design) · ${wallAnswered(rows)} answered in full`} testId="designs-dives" />
      </div>
      <NextDesign callout={callout} onOpenTier={i => set({ tier: i })} />
      <DesignCharts tiers={tiers} totals={totals} answered={wallAnswered(rows)} />
      <DesignEvidence designs={designs} sessions={sessions} nowMs={t} />
      <Panel title={`Tier ladder · ${totals.done} of ${totals.total} designs`} aria-label="Tier ladder" data-testid="tier-ladder">
        <Ladder tiers={tiers} selected={tier?.index ?? null} onSelect={i => set({ tier: i })} />
      </Panel>
      {tier ? <TierDetail tier={tier} /> : <p className="hint designs-pick-hint" data-testid="designs-hint">Pick a tier to see its designs.</p>}
      <div className="two-col">
        <Rubric />
        <ProseSectionView section={DESIGN_PRACTICE} />
      </div>
      <ProseSectionView section={DESIGN_SOURCES} />
    </div>
  )
}

function NextDesign({ callout, onOpenTier }: { callout: DesignCallout; onOpenTier: (index: number) => void }) {
  return (
    <Panel title="Next Sunday design" data-testid="next-design">
      {callout.kind === 'next' ? (
        <div className="next-design">
          <p className="next-title" data-testid="next-design-title">{callout.item.title}</p>
          <p className="hint">Tier {callout.tier.index} · {callout.tier.label} · S{callout.tier.from}–S{callout.tier.to}</p>
          <ol className="prose-list">
            {callout.item.deepDives.map((d, i) => <li key={i}>{d}</li>)}
          </ol>
          <Button data-testid="open-next-tier" onClick={() => onOpenTier(callout.tier.index)}>Open tier ▸</Button>
        </div>
      ) : (
        <p className="empty" data-testid="next-design-text">{callout.text}</p>
      )}
    </Panel>
  )
}

function Ladder({ tiers, selected, onSelect }: { tiers: DesignTierView[]; selected: number | null; onSelect: (index: number) => void }) {
  return (
    <div className="ladder">
      {tiers.map((x, i) => (
        <button
          key={x.index}
          type="button"
          className={`ladder-col${selected === x.index ? ' sel' : ''}`}
          style={{ '--tier-i': i } as CSSProperties}
          aria-pressed={selected === x.index}
          aria-label={x.name}
          data-testid={`tier-${x.index}`}
          onClick={() => onSelect(x.index)}
        >
          <span className="ladder-name">T{x.index} · {x.label}</span>
          <span className="ladder-range">S{x.from}–S{x.to} · {x.skill}</span>
          <span className="ladder-cubes" aria-label={`${x.done} of ${x.total} done`}>
            {x.items.map(it => <Cube key={it.id} on={it.done} size={8} />)}
          </span>
        </button>
      ))}
    </div>
  )
}

function TierDetail({ tier }: { tier: DesignTierView }) {
  return (
    <Panel title={`Tier ${tier.index} · ${tier.label}`} data-testid="tier-detail">
      <p className="hint">S{tier.from}–S{tier.to} · {tier.skill} · {tier.done}/{tier.total} done</p>
      <div className="rows">
        {tier.items.map(it => <DesignRow key={it.id} it={it} />)}
      </div>
    </Panel>
  )
}

function DesignRow({ it }: { it: DesignItemView }) {
  const navigate = useNavigate()
  return (
    <div className="design-item">
      <TicketRow ticket={it.ticket} title={it.title}>
        <span className={`chip diff-chip diff-${it.difficulty}`}>{it.difficulty}</span>
        {it.ticket && <span className="chip">plan S{it.ticket.plannedSprint}</span>}
        <Button className="design-start" aria-label={`Start session: ${it.title}`} onClick={() => navigate(`/designs/session/${it.id}`)}>
          Session ▸
        </Button>
      </TicketRow>
      <details className="design-more" data-testid={`dives-${it.id}`}>
        <summary>Deep dives and refs</summary>
        <ol className="prose-list">
          {it.deepDives.map((d, i) => <li key={i}>{d}</li>)}
        </ol>
        {it.refs.length > 0 && (
          <p className="design-refs">
            {it.refs.map(r => (
              <ExtLink key={r.url} link={r} />
            ))}
          </p>
        )}
      </details>
    </div>
  )
}

function Rubric() {
  return (
    <Panel title={`Rubric · ${RUBRIC_TOTAL} points`} data-testid="rubric">
      <table className="prose-table">
        <tbody>
          {RUBRIC.map(r => (
            <tr key={r.item}>
              <td>{r.item}</td>
              <td className="rubric-pts">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="prose-sub">{DONE_MEANS}</p>
    </Panel>
  )
}
