import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PlanV2 } from '../../data/planV2'
import type { Ticket } from '../../data/types'
import { nodeTickets, type NodeState } from '../../rules/skillTree'
import { areaColorIndex, areaSummaries, AREA_WORD, edgeStyle, isTreeArea, STATE_ATTR, STATE_GLYPH, STATE_WORD, topicsOf, treeProgress, type TextWidth } from '../../rules/skillView'
import { Glyph } from '../../ui/Glyph'
import { layoutTree, treeSize } from '../../rules/treeLayout'
import { NodePanel } from './NodePanel'
import { SkMeter, StateGlyph } from './Meter'
import { TopicBadge } from './TopicBadge'
import { withTopicWord, type TopicView } from './useTopicViews'
import { NextPanel, SkillsList } from './SkillsList'

/** The pixel width of an element, kept current (0 until measured; jsdom never measures, so callers pick a default). */
function useBoxWidth(on: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!on || !el) return
    const read = () => setWidth(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [on])
  return { ref, width }
}

/**
 * Measures text in the node title face (bold, the body font, the meta size) once web fonts are in, so a node's box is sized to the
 * lines the browser really wraps to. `undefined` until then and wherever canvas text is unavailable (jsdom): the layout then estimates.
 */
function useTitleMeasure(): TextWidth | undefined {
  const [fontsIn, setFontsIn] = useState(false)
  useEffect(() => {
    let live = true
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts?.ready) return
    void fonts.ready.then(() => { if (live) setFontsIn(true) })
    return () => { live = false }
  }, [])
  return useMemo(() => {
    if (!fontsIn) return undefined
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = document.createElement('canvas').getContext('2d') } catch { ctx = null }
    if (!ctx) return undefined
    const probe = document.querySelector('.sk-node .sk-nl') ?? document.body
    const cs = getComputedStyle(probe)
    const size = probe === document.body ? '14px' : cs.fontSize
    ctx.font = `700 ${size} ${cs.fontFamily}`
    const c = ctx
    return (t: string) => c.measureText(t).width
  }, [fontsIn])
}

interface Props { plan: PlanV2; tickets: readonly Ticket[]; states: ReadonlyMap<string, NodeState>; phone: boolean; nextTicket: Ticket | null; topics?: ReadonlyMap<string, TopicView> }

/**
 * The route wrapper. `/skills/area/<id>` is an AI area; `/skills/dsa` and `/skills/design` pass `treeArea` (the tree tabs, TREE-05, TREE-06),
 * and `/skills/area/dsa|design` redirect to them with the query kept (TREE-07). A new area, or a new `?node=`, starts with a fresh selection:
 * the selection is component state (a hand pick never writes the URL, SKILLS-16).
 */
export function AreaView(props: Props & { treeArea?: string }) {
  const { treeArea, ...rest } = props
  const params = useParams()
  const loc = useLocation()
  const [search] = useSearchParams()
  const areaId = treeArea ?? params.areaId ?? ''
  if (!treeArea && isTreeArea(areaId)) return <Navigate to={`/skills/${areaId}${loc.search}`} replace />
  if (!props.plan.areas.some(a => a.id === areaId)) return <Navigate to="/skills" replace />
  const nodeParam = search.get('node')
  return <AreaViewBody key={`${areaId}|${nodeParam ?? ''}`} areaId={areaId} nodeParam={nodeParam} {...rest} />
}

function AreaViewBody({ areaId, nodeParam, plan, tickets, states, phone, nextTicket, topics }: Props & { areaId: string; nodeParam: string | null }) {
  const navigate = useNavigate()
  const area = plan.areas.find(a => a.id === areaId)!
  const tree = isTreeArea(areaId)
  const nodes = useMemo(() => topicsOf(plan, areaId), [plan, areaId])
  // `?node=` names a node of this view; an unknown or foreign id is ignored and selects nothing at all (SKILLS-16, NAV-25)
  const paramNode = nodeParam !== null && nodes.some(n => n.id === nodeParam) ? nodeParam : null
  const [picked, setPicked] = useState<string | null>(paramNode)
  // Nothing is selected until the user picks a node or `?node=` names one (NAV-25, SKILLS-16: "no node is selected" is literal for a plain view and for a bad parameter)
  const selectedId = picked && nodes.some(n => n.id === picked) ? picked : undefined
  const selected = nodes.find(n => n.id === selectedId)
  // a map takes the full width (five columns) until a node is picked; the panel column then opens beside it and the map narrows to the columns that fit
  const box = useBoxWidth(!phone)
  const measure = useTitleMeasure()
  // every map (AI areas, DSA, Design) reads top to bottom in rows by depth, up to five boxes wide (fewer when the canvas is narrower)
  const treeAvail = box.width > 0 ? box.width - 8 : 900
  const tsize = useMemo(() => treeSize(treeAvail), [treeAvail])
  const layout = useMemo(() => layoutTree(nodes, tsize, measure), [nodes, tsize, measure])
  const color = `var(--sr-area-${areaColorIndex(plan, areaId)})`
  const doneTopics = nodes.filter(n => states.get(n.id) === 'done').length
  const progress = useMemo(() => (tree ? treeProgress(plan, areaId, tickets as Ticket[]) : null), [tree, plan, areaId, tickets])
  const nextInArea = nodes.some(n => states.get(n.id) === 'next')
  const meterPips = nodes.length > 0 ? Math.min(10, Math.max(doneTopics > 0 ? 1 : 0, Math.round((doneTopics / nodes.length) * 10))) : 0

  const head = (
    <div className={tree ? 'sk-vhead sk-vhead-tree' : 'sk-vhead'}>
      <span className="sk-bigtag" style={{ ['--c' as string]: color }}>{area.tag}</span>
      <h2 className="sk-h24" id="sk-area-name" data-content="plan">{area.name}</h2>
      <span className={tree ? 'sk-vmeter sk-vmeter-wrap' : 'sk-vmeter'}>
        <span className="sk-meter sk-ok" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < meterPips ? 'on' : ''} />)}</span>
        <span className="mono sk-meta">{doneTopics} of {nodes.length} topics</span>
        {progress && (
          <span className="mono sk-meta" data-testid="skills-area-progress" data-done={progress.done} data-total={progress.total}>
            {progress.done} of {progress.total} {areaId === 'design' ? 'designs' : 'problems'}
          </span>
        )}
      </span>
      {!tree && <button type="button" className="sr-btn sr-btn-quiet sk-back" data-testid="skills-all-areas" onClick={() => navigate('/skills')}><Glyph name="chevronL" /> <span className={phone ? 'vh' : undefined}>All areas</span></button>}
    </div>
  )
  // the legend names the states this map shows: no "Locked" where nothing is locked
  const legendStates = (['locked', 'available', 'next', 'inprog', 'done'] as const).filter(k => nodes.some(n => (states.get(n.id) ?? 'locked') === k))
  const rowOf = useMemo(() => new Map(layout.placed.map(p => [p.node.id, p.row + 1])), [layout])
  const summaries = useMemo(() => (phone && !tree ? areaSummaries(plan, tickets, states) : []), [phone, tree, plan, tickets, states])

  return (
    <section className={`sk-view${phone && nextInArea ? ' sk-view-next' : ''}`} data-testid="skills-area-view" data-area={areaId} aria-labelledby="sk-area-name">
      {!phone && head}
      {!phone && (
        <div className="sk-vkey">
          <ul className="sk-legend sk-vlegend" data-testid="skills-view-legend" aria-label="Legend">
            {legendStates.map(k => <li key={k}><i className={`sk-sw sk-swk-${k}`} /><Glyph name={STATE_GLYPH[k]} />{STATE_WORD[k]}</li>)}
          </ul>
          <span className="sk-meta">An arrow means you need this first. Orange arrows are gates you have met.</span>
        </div>
      )}
      {phone ? (
        <>
          <div className="sk-phone sr-panel">
            {head}
            <SkillsList plan={plan} tickets={tickets} states={states} nodes={nodes} initialOpen={paramNode} topics={topics} />
            {!tree && <ul className="sk-others" aria-label="Other areas">
              {summaries.filter(x => x.area.id !== areaId).map(x => (
                <li key={x.area.id}>
                  <button type="button" className="sk-orow" data-testid={`skills-more-${x.area.id}`} aria-label={`${x.area.name}, ${AREA_WORD[x.state]}`} style={{ ['--c' as string]: `var(--sr-area-${areaColorIndex(plan, x.area.id)})` }} onClick={() => navigate(`/skills/area/${x.area.id}`)}>
                    <span className="sk-otag">{x.area.tag}</span>
                    <span className="sk-orow-nm" data-content="plan">{x.area.name}</span>
                    <span className="mono sk-meta">{x.topicsDone}/{x.topicsTotal}</span>
                  </button>
                </li>
              ))}
            </ul>}
          </div>
          {nextInArea && nextTicket && <NextPanel plan={plan} nextTicket={nextTicket} />}
        </>
      ) : (
        <div className={selected ? 'sk-split' : 'sk-split sk-split-solo'}>
          <div className="sk-scroll" ref={box.ref}>
            <div className="sk-aview" data-scale="1.000" style={{ width: layout.width, height: layout.height, ['--c' as string]: color }}>
              <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} overflow="visible">
                {layout.edges.map(([from, to]) => {
                  const p = layout.paths.get(`${from}>${to}`)
                  if (!p) return null
                  const style = edgeStyle(states.get(from) ?? 'locked', states.get(to) ?? 'locked')
                  return (
                    <g key={`${from}-${to}`} aria-hidden="true">
                      <path d={p.d} className="sk-edge" data-testid={`skills-node-edge-${from}-${to}`} data-style={style} fill="none" strokeWidth={2} />
                      <rect x={p.hx} y={p.hy} width={6} height={6} className="sk-ehead" data-style={style} />
                    </g>
                  )
                })}
                {layout.placed.map(({ node, x, y, w, h }) => {
                  const st = states.get(node.id) ?? 'locked'
                  const mine = nodeTickets(node.id, tickets)
                  const topic = topics?.get(node.id)?.state
                  const pick = () => setPicked(node.id)
                  // R9: a node is an SVG group with role=button (not a <button>), so the one accent-filled node is not a second accent button.
                  return (
                    <g
                      key={node.id} className="sk-node" role="button" tabIndex={0} data-testid={`skills-node-${node.id}`} data-state={st} data-row={rowOf.get(node.id)}
                      aria-current={selectedId === node.id ? 'true' : undefined} aria-label={withTopicWord(`${node.title}, ${STATE_WORD[st]}`, topic)}
                      onClick={pick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}
                    >
                      <foreignObject x={x} y={y} width={w} height={h} style={{ overflow: 'visible' }}>
                        <div className="sk-nbox">
                          <span className="sk-nl" data-content="plan">{node.title}</span>
                          <span className="sk-nb">
                            <StateGlyph id={node.id} attr={STATE_ATTR[st]}><Glyph name={STATE_GLYPH[st]} /></StateGlyph>
                            <TopicBadge id={node.id} topic={topic} />
                            <SkMeter done={mine.filter(t => t.status === 'done').length} total={mine.length} label="Tickets done" testId={`skills-node-meter-${node.id}`} segments={Math.min(topic ? 3 : 6, Math.max(1, mine.length))} tone={st === 'done' ? 'ok' : 'accent'} />
                          </span>
                        </div>
                      </foreignObject>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
          {selected && <NodePanel node={selected} plan={plan} tickets={tickets} states={states} topic={topics?.get(selected.id)} />}
        </div>
      )}
    </section>
  )
}
