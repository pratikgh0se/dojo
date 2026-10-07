import { useEffect, useRef, useState } from 'react'
import { useNavigationType } from 'react-router-dom'
import { usePlan } from '../app/providers'
import { APPROACHES } from '../content/approaches'
import { patternBySlug } from '../content/atlas'
import { useAtlasRuns, useSessions, useTickets } from '../data/hooks'
import { loadSortLeft, saveSortLeft } from '../lib/atlasPrefs'
import { useQuery } from '../lib/useQueryParam'
import { approachCoverage } from '../rules/approachCoverage'
import { atlasSummary, patternStates } from '../rules/atlasProgress'
import { problemsByPattern, problemsLeft, rowMatches, sortRows } from '../rules/atlasRows'
import { Button } from '../ui/primitives'
import { AtlasDetail, type Opened } from './atlas/AtlasDetail'
import { AtlasMatrix } from './atlas/AtlasMatrix'
import { AtlasSearch } from './atlas/AtlasSearch'
import './atlas.css'
import { Loading } from '../ui/Loading'

/**
 * UAT cu-6 P3-10: below 1100 px the row detail opens under the matrix, a screen or more away, so picking a row (or arriving
 * with `?pattern=` by a link) brings it into view, top-aligned. Beside the matrix (desktop) it is already on screen.
 */
function revealDetail() {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1100px)').matches) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.querySelector<HTMLElement>('[data-testid="atlas-detail"]')?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

/** The Atlas tab (VISUALIZER "The Atlas tab"; labs contract §5): header, search, sort, the matrix and the pattern panel. */
export function Atlas() {
  const plan = usePlan()
  const tickets = useTickets()
  const runs = useAtlasRuns()
  const sessions = useSessions()
  const { params, set } = useQuery()
  const [sortLeft, setSortLeft] = useState(loadSortLeft)
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<Opened | null>(null)
  const pattern = patternBySlug(params.get('pattern') ?? '') ?? null
  const slugRef = useRef(pattern?.slug)
  slugRef.current = pattern?.slug
  const openedRef = useRef(opened)
  openedRef.current = opened
  const navType = useNavigationType()
  const reveal = useRef(navType !== 'POP' && !!pattern)
  const ready = !!tickets && !!runs && !!sessions
  useEffect(() => {
    if (!reveal.current || !ready || !pattern) return
    reveal.current = false
    revealDetail()
  }, [pattern?.slug, ready])

  const close = () => {
    const slug = slugRef.current
    setOpened(null)
    set({ pattern: null })
    if (slug) window.setTimeout(() => document.querySelector<HTMLButtonElement>(`button[data-row="${slug}"]`)?.focus(), 0)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // Escape closes an open two-up, then the detail panel (§9).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (openedRef.current?.mode === 'twoup') {
        e.preventDefault()
        setOpened(null)
      } else if (slugRef.current) {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!tickets || !runs || !sessions) return <Loading />
  const states = patternStates(runs)
  const summary = atlasSummary(states)
  const tagged = problemsByPattern(plan, tickets, APPROACHES)
  const coverage = approachCoverage(sessions, APPROACHES)
  const left = Object.fromEntries(Object.entries(tagged).map(([slug, list]) => [slug, problemsLeft(list)]))
  const rows = sortRows(sortLeft ? 'left' : 'map', tagged).filter(p => rowMatches(p, query, tagged))
  const select = (slug: string) => {
    if (slug !== pattern?.slug) { setOpened(null); reveal.current = true }
    set({ pattern: slug })
  }

  return (
    <div className="content-screen atlas">
      <h1 className="screen-title">Atlas</h1>
      <div className="atlas-head">
        <p className="eyebrow" data-testid="atlas-summary">{summary.text}</p>
        <div className="atlas-meter" role="progressbar" aria-label="Patterns predicted" aria-valuemin={0} aria-valuemax={summary.patterns} aria-valuenow={summary.predicted}>
          {Array.from({ length: summary.patterns }, (_, i) => <span key={i} className="sr-cube" data-on={i < summary.predicted ? 'true' : 'false'} aria-hidden="true" />)}
        </div>
        <ul className="atlas-legend" aria-label="Legend">
          <li><i className="atlas-lg atlas-lg-none" aria-hidden="true" />none</li>
          <li><i className="atlas-lg atlas-lg-seen" aria-hidden="true" />seen</li>
          <li><i className="atlas-lg atlas-lg-predicted" aria-hidden="true" />predicted</li>
          <li><i className="atlas-lg atlas-lg-use" aria-hidden="true" />use: filled = reached for, hollow = avoided</li>
          {/* UAT J9: the cell colours too (the orange cells were unexplained); the column key is under the map */}
          <li><i className="atlas-lg atlas-lg-main" aria-hidden="true" />cell: main picture</li>
          <li><i className="atlas-lg atlas-lg-side" aria-hidden="true" />cell: side panel</li>
        </ul>
      </div>
      <div className="atlas-tools">
        <AtlasSearch selected={pattern?.slug ?? null} query={query} onQuery={setQuery} visible={rows} onPick={select} />
        <Button
          aria-pressed={sortLeft}
          onClick={() => {
            saveSortLeft(!sortLeft)
            setSortLeft(!sortLeft)
          }}
        >
          Sort by problems left
        </Button>
      </div>
      <div className="atlas-top">
        <AtlasMatrix rows={rows} states={states} coverage={coverage} left={left} selected={pattern?.slug ?? null} onSelect={slug => select(slug)} />
        {pattern ? (
          <AtlasDetail
            key={pattern.slug}
            pattern={pattern}
            state={states[pattern.slug]}
            coverage={coverage[pattern.slug]}
            problems={tagged[pattern.slug]}
            opened={opened}
            onOpen={setOpened}
            onClose={close}
          />
        ) : (
          /* UAT cu-6 P3-6: beside the matrix, where the row detail will open, so the right third is never an empty well */
          <p className="hint atlas-pick-hint" data-testid="atlas-hint">Pick a pattern row to see its pictures, problems and approach coverage.</p>
        )}
      </div>
    </div>
  )
}
