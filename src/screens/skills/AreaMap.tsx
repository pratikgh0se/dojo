import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanV2 } from '../../data/planV2'
import type { Ticket } from '../../data/types'
import type { NodeState } from '../../rules/skillTree'
import { aiAreasOf, areaEdgeMet, areaSummaries, AREA_H, AREA_W, AREA_WORD, edgePath, isTreeArea, layoutAreas, summaryLine, type AreaSummary } from '../../rules/skillView'
import { Glyph } from '../../ui/Glyph'
import { SkMeter } from './Meter'
import { NextPanel } from './SkillsList'

function Tile({ s, index, onOpen, style, compact = false }: { s: AreaSummary; index: number; onOpen: () => void; style?: React.CSSProperties; compact?: boolean }) {
  const a = s.area
  return (
    <button
      type="button" className="sk-area" data-testid={`skills-area-${a.id}`} data-state={s.state} data-rec={s.recommended ? 'true' : undefined}
      aria-label={`${a.name}, ${AREA_WORD[s.state]}`} style={{ ...style, ['--c' as string]: `var(--sr-area-${(index % 10) + 1})` }} onClick={onOpen}
    >
      <i className="sk-stripe" data-testid={`skills-area-stripe-${a.id}`} />
      <span className="sk-top"><span className="sk-tag" data-testid={`skills-area-tag-${a.id}`}>{a.tag}</span><span className="sk-nm" data-content="plan">{a.name}</span></span>
      <span className="sk-bot">
        <SkMeter done={s.progress.done} total={s.progress.total} label="Minutes done" testId={`skills-area-meter-${a.id}`} segments={6} tone={s.state === 'done' ? 'ok' : 'accent'} hidden={s.state === 'needs-area' || compact} />
        {s.state === 'needs-area'
          ? <span className="sk-need"><Glyph name="lock" /> Needs <span data-content="plan">{s.needs.join(', ')}</span></span>
          : <span className="mono sk-count">{s.topicsDone}/{s.topicsTotal}</span>}
      </span>
    </button>
  )
}

/** Smallest scale the map shrinks to before it scrolls sideways instead. */
export const MAP_MIN_SCALE = 0.75

/**
 * Scale the fixed-size map down to the width it is given (a 148 px rail leaves ~1132 px for a 1160 px map), but never below `minScale`:
 * past that it scrolls sideways inside its own box. The area graph passes 1, so its 14 px node text is never drawn smaller (review D6).
 */
export function useFitScale(width: number, enabled: boolean, minScale: number = MAP_MIN_SCALE) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const fit = () => setScale(Math.min(1, Math.max(minScale, el.clientWidth / width)))
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, enabled, minScale])
  return { ref, scale }
}

export function AreaMap({ plan, tickets, states, compact, nextTicket = null }: { plan: PlanV2; tickets: readonly Ticket[]; states: ReadonlyMap<string, NodeState>; compact: boolean; nextTicket?: Ticket | null }) {
  const navigate = useNavigate()
  const summaries = useMemo(() => areaSummaries(plan, tickets, states), [plan, tickets, states])
  // the map is the AI tab: one tile per AI area, none for the DSA and Design trees (SKILLS-02, TREE-04)
  const aiAreas = useMemo(() => aiAreasOf(plan), [plan])
  const layout = useMemo(() => layoutAreas(aiAreas), [aiAreas])
  const fit = useFitScale(layout.width, !compact)
  // a quest on a DSA or Design item is shown on its tree tab, not here
  const questNode = nextTicket?.node ? plan.nodes.find(n => n.id === nextTicket.node) : undefined
  const showNext = compact && !!nextTicket && !!questNode && !isTreeArea(questNode.area) && states.get(questNode.id) === 'next'
  const open = (id: string) => navigate(`/skills/area/${id}`)
  const byId = new Map(layout.tiles.map(t => [t.area.id, t]))
  const sOf = new Map(summaries.map(s => [s.area.id, s]))
  return (
    <>
      <div className="sk-head">
        <span className="sk-h24">{aiAreas.length} areas</span>
        <span className="sk-sum" data-testid="skills-summary">{summaryLine(plan, states)}</span>
        <ul className="sk-legend" data-testid="skills-legend" aria-label="Legend">
          <li><i className="sk-sw" />Open</li><li><i className="sk-sw sk-sw-p" />In progress</li><li><i className="sk-sw sk-sw-l" />Needs another area</li><li><i className="sk-sw sk-sw-d" />Done</li>
        </ul>
      </div>
      {compact ? (
        <>
          <ul className={`sk-alist sr-panel${showNext ? ' sk-pad-next' : ''}`}>
            {summaries.map((s, i) => <li key={s.area.id}><Tile s={s} index={i} onOpen={() => open(s.area.id)} compact /></li>)}
          </ul>
          {/* the pinned next-ticket card of the mockup's phone list; only when Today's quest sits on a topic */}
          {showNext && nextTicket && <NextPanel plan={plan} nextTicket={nextTicket} />}
        </>
      ) : (
        <div className="sk-mapwrap" ref={fit.ref}>
          <div className="sk-mapfit" style={{ width: layout.width * fit.scale, height: layout.height * fit.scale }}>
          <div className="sk-amap" data-scale={fit.scale.toFixed(3)} style={{ width: layout.width, height: layout.height, transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }}>
            <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {layout.edges.map(([from, to]) => {
                const a = byId.get(from)
                const b = byId.get(to)
                if (!a || !b) return null
                const boxA = { x: a.x, y: a.y, w: AREA_W, h: AREA_H }
                const boxB = { x: b.x, y: b.y, w: AREA_W, h: AREA_H }
                // same row with nothing between: a straight link, as in the mockup (the arch is only for going over tiles in the way)
                const clear = a.y === b.y && !layout.tiles.some(t => t.y === a.y && t.x > Math.min(a.x, b.x) && t.x < Math.max(a.x, b.x))
                const p = clear
                  ? { d: `M${a.x < b.x ? a.x + AREA_W : a.x} ${a.y + AREA_H / 2} H${a.x < b.x ? b.x - 6 : b.x + AREA_W + 6}`, hx: a.x < b.x ? b.x - 9 : b.x + AREA_W + 3, hy: a.y + AREA_H / 2 - 3 }
                  : edgePath(boxA, boxB)
                const met = areaEdgeMet(plan, from, tickets)
                const dashed = sOf.get(to)?.state === 'needs-area'
                return (
                  <g key={`${from}-${to}`}>
                    <path d={p.d} className="sk-edge" data-testid={`skills-edge-${from}-${to}`} data-met={met ? 'true' : 'false'} data-dash={dashed ? 'true' : undefined} fill="none" strokeWidth={2} />
                    <rect x={p.hx} y={p.hy} width={6} height={6} className="sk-ehead" data-met={met ? 'true' : 'false'} />
                  </g>
                )
              })}
            </svg>
            {summaries.map((s, i) => {
              const t = byId.get(s.area.id)!
              return <Tile key={s.area.id} s={s} index={i} onOpen={() => open(s.area.id)} style={{ left: t.x, top: t.y, width: AREA_W, height: AREA_H }} />
            })}
          </div>
          </div>
        </div>
      )}
    </>
  )
}
