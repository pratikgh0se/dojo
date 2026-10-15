import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { extraChips, filterDesigns, normalizeQuery } from '../rules/designSearch'
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
  const search = useDesignSearch()
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
  const callout = designCallout(tiers)
  const sel = intParam(params, 'tier')
  const picked = tiers.find(x => x.index === sel) ?? null
  // GLOBAL-10 / NAV-32: the screen always shows a tier's detail (and its rows), so with no usable `tier` parameter it opens the tier of the next design, else the first.
  // `designs-hint` stays while the tier is that default and not the user's pick.
  const tier = picked ?? (callout.kind === 'next' ? callout.tier : tiers[0]) ?? null
  return (
    <div className="content-screen designs">
      <h1 className="screen-title">Design bank</h1>
      <SearchBox search={search} />
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
      {search.active
        ? <SearchResults groups={filterDesigns(tiers, search.text)} />
        : <>
          {!picked && <p className="hint designs-pick-hint" data-testid="designs-hint">Pick a tier to see its designs.</p>}
          {tier && <TierDetail tier={tier} />}
        </>}
      <div className="two-col">
        <Rubric />
        <ProseSectionView section={DESIGN_PRACTICE} />
      </div>
      <ProseSectionView section={DESIGN_SOURCES} />
    </div>
  )
}

/**
 * NAV-35: the search text lives in the URL as `q` (next to `tier`), written with replace so typing never fills the history; Back
 * and a reload find it again. The box keeps its own text, so a half-typed query with spaces is never rewritten under the cursor.
 */
function useDesignSearch() {
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const [text, setText] = useState(urlQ)
  useEffect(() => { setText(prev => (prev === urlQ ? prev : urlQ)) }, [urlQ]) // Back, Forward or a link changed the URL
  const change = (v: string) => {
    setText(v)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (v === '') next.delete('q')
      else next.set('q', v)
      return next
    }, { replace: true })
  }
  return { text, change, active: normalizeQuery(text) !== '' }
}

function SearchBox({ search }: { search: ReturnType<typeof useDesignSearch> }) {
  return (
    <div className="designs-search-row">
      <input
        type="text" className="designs-search" data-testid="designs-search" aria-label="Search designs" placeholder="Search designs" autoComplete="off"
        value={search.text} onChange={e => search.change(e.target.value)}
      />
      {search.text !== '' && <Button data-testid="designs-search-clear" onClick={() => search.change('')}>Clear search</Button>}
    </div>
  )
}

function SearchResults({ groups }: { groups: ReturnType<typeof filterDesigns> }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'start' }) }, []) // the results sit below the charts: show them when the first query opens them
  const n = groups.reduce((a, g) => a + g.items.length, 0)
  return (
    <section className="sr-panel designs-search-results" data-testid="designs-search-results" aria-label="Search results" ref={ref}>
      <p className="hint" data-testid="designs-search-count" data-count={n}>{n} designs</p>
      {n === 0 && <p className="empty" data-testid="designs-search-empty" data-empty="true">No design matches that.</p>}
      {groups.map(g => (
        <div key={g.tier.index} className="designs-search-tier">
          <h3 className="designs-search-tier-title" data-testid={`designs-search-tier-${g.tier.index}`}>Tier {g.tier.index} · {g.tier.label}</h3>
          <div className="rows">{g.items.map(it => <DesignRow key={it.id} it={it} />)}</div>
        </div>
      ))}
    </section>
  )
}

function NextDesign({ callout, onOpenTier }: { callout: DesignCallout; onOpenTier: (index: number) => void }) {
  return (
    <Panel title="Next design" data-testid="next-design">
      {callout.kind === 'next' ? (
        <div className="next-design">
          <h3 className="next-title" data-testid="next-design-title">{callout.item.title}</h3>
          <p className="hint">Tier {callout.tier.index} · {callout.tier.label}</p>
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
          <span className="ladder-range">{x.skill} · {x.total} designs</span>
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
      <p className="hint">{tier.skill} · {tier.done}/{tier.total} done</p>
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
      <TicketRow ticket={it.ticket} title={it.title} hideSprint>
        <span className={`chip diff-chip diff-${it.difficulty}`}>{it.difficulty}</span>
        {extraChips(it).map((c, n) => <span key={n} className="chip" data-testid={`designs-row-chip-${it.id}-${n + 1}`}>{c}</span>)}
        <Button className="design-start" data-testid={`design-start-${it.id}`} aria-label={`Start session: ${it.title}`} onClick={() => navigate(`/designs/session/${it.id}?new=1`)}>
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
