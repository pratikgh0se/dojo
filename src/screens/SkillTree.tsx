import type { KeyboardEvent } from 'react'
import { tierName } from '../content/skillTiers'
import type { PlanSkill } from '../data/types'
import { skillTreeLayout, type SkillProgressMap, type SkillState } from '../rules/map'

// ui-reference R1: an intrinsic column pitch; node text stays 14 px (the tree scrolls instead of shrinking).
// UAT r3 J9 (ruling 1, no clipped labels): nodes are wide enough for every plan label in two lines of 20 characters
// ("AI engineering (RAG," / "agents, evals)"), and a longer label gets a taller node, never "…".
const COL_W = 188
const NODE_W = 172
const ROW_GAP = 16
const LINE_H = 17
const PAD = 12
const HEAD = 24
/** Chivo 14 px averages under 8 px a glyph, so 20 fit the 160 px inside a node. */
const LINE_CHARS = 20

/** Word-wrap a label into lines that fit the node. Nothing is cut: the node grows a line instead. */
export function nodeLines(label: string, n = LINE_CHARS): string[] {
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= n) cur = next
    else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}
/** Label lines from y 18, then the percentage line: 64 px for the usual two lines. */
const nodeHeight = (lines: number) => 30 + Math.max(2, lines) * LINE_H
const pct = (x: number) => `${Math.round(x * 100)}%`

export function SkillTree({
  skills, progress, states, gates, selected, onSelect,
}: {
  skills: PlanSkill[]
  progress: SkillProgressMap
  states: Record<string, SkillState>
  gates: Record<string, boolean>
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { nodes, edges } = skillTreeLayout(skills)
  const lines = new Map(skills.map(s => [s.id, nodeLines(s.label)]))
  const NODE_H = nodeHeight(Math.max(2, ...[...lines.values()].map(l => l.length)))
  const ROW_H = NODE_H + ROW_GAP
  const pos = new Map(nodes.map(n => [n.id, { x: PAD + n.col * COL_W, y: HEAD + PAD + n.row * ROW_H }]))
  const labels = new Map(skills.map(s => [s.id, s.label]))
  const cols = Math.max(0, ...nodes.map(n => n.col)) + 1
  const rows = Math.max(0, ...nodes.map(n => n.row)) + 1
  const width = PAD * 2 + (cols - 1) * COL_W + NODE_W
  const height = HEAD + PAD * 2 + (rows - 1) * ROW_H + NODE_H
  const onKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(id)
    }
  }
  return (
    <div className="tree-scroll sc">
      <svg className="skill-tree" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Skill tree">
        {Array.from({ length: cols }, (_, c) => (
          <text key={c} className="tree-tier" x={PAD + c * COL_W} y={16}>{tierName(c)}</text>
        ))}
        {edges.map(e => {
          const a = pos.get(e.from)!
          const b = pos.get(e.to)!
          const x1 = a.x + NODE_W
          const y1 = a.y + NODE_H / 2
          const x2 = b.x
          const y2 = b.y + NODE_H / 2
          const xm = x1 + Math.round((x2 - x1) / 2)
          return (
            <path
              key={`${e.from}->${e.to}`}
              className={`tree-edge${gates[e.from] ? ' met' : ''}`}
              d={`M${x1} ${y1} H${xm} V${y2} H${x2}`}
              data-edge={`${e.from}->${e.to}`}
            />
          )
        })}
        {nodes.map(n => {
          const p = pos.get(n.id)!
          const st = states[n.id] ?? 'open'
          const pr = progress[n.id] ?? { done: 0, total: 0, pct: 0 }
          const label = labels.get(n.id) ?? n.id
          return (
            <g
              key={n.id}
              className={`tree-node state-${st}${selected === n.id ? ' sel' : ''}`}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              aria-pressed={selected === n.id}
              aria-label={`${label}, ${st}, ${pr.total ? pct(pr.pct) : 'no tickets'}`}
              data-testid={`node-${n.id}`}
              data-state={st}
              onClick={() => onSelect(n.id)}
              onKeyDown={e => onKey(e, n.id)}
            >
              <rect className="node-box" width={NODE_W} height={NODE_H} />
              <rect className="node-fill" y={NODE_H - 4} width={Math.round(NODE_W * pr.pct)} height={4} />
              <title>{label}</title>
              {(lines.get(n.id) ?? nodeLines(label)).map((l, i) => <text key={i} className="node-label" x={6} y={18 + i * LINE_H}>{l}</text>)}
              <text className="node-pct" x={6} y={NODE_H - 10}>{pr.total ? pct(pr.pct) : 'no tickets'}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
