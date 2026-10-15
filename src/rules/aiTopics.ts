import type { PlanArea, PlanNode, PlanV2 } from '../data/planV2'
import type { Kind, Ticket } from '../data/types'
import { aiAreasOf, aiNodesOf } from './skillView'

/** nav-and-topics.md "Kind labels" and the chip order of NAV-17 and NAV-20. */
export const TOPIC_KINDS: readonly Kind[] = ['watch', 'read', 'build', 'writeup', 'problem', 'design', 'task', 'ritual']
const KIND_CHIP_LABEL: Partial<Record<Kind, string>> = {
  watch: 'Watch', read: 'Read', build: 'Build', writeup: 'Write-up', problem: 'Problem', design: 'Design', task: 'Task', ritual: 'Ritual',
}
export const kindChipLabel = (k: Kind): string => KIND_CHIP_LABEL[k] ?? k

/** "<x> h": minutes / 60 rounded once to one decimal ("0 h", "1.5 h", "2 h"). */
export const hoursLabel = (minutes: number): string => `${Math.round((minutes / 60) * 10) / 10} h`

export interface TopicFilter { phase: number | null; kind: Kind | null }

/** NAV-21, NAV-22: `?phase=` and `?kind=`; a value that matches no chip means "all". */
export function parseTopicFilter(params: URLSearchParams, phases: readonly number[], kinds: readonly Kind[]): TopicFilter {
  const p = params.get('phase')
  const phase = p !== null && /^\d+$/.test(p) && phases.includes(Number(p)) ? Number(p) : null
  const k = params.get('kind')
  const kind = k !== null ? kinds.find(x => x === k) ?? null : null
  return { phase, kind }
}

export interface TopicNode {
  node: PlanNode
  /** tickets, done tickets and minutes over the node's live tickets (of the kind filter, when one is set) */
  count: number
  done: number
  minutes: number
  kinds: { kind: Kind; count: number }[]
}
export interface TopicArea { area: PlanArea; nodes: TopicNode[]; done: number; total: number; minutes: number }
export interface TopicsView {
  areas: TopicArea[]
  done: number
  total: number
  minutes: number
  /** the chips: every phase and every ticket kind of the AI nodes, whatever the filter */
  phases: number[]
  kinds: Kind[]
}

/** The AI topics page (NAV-16 to NAV-20): per AI area, per node, the live tickets of the node counted by kind, in plan order. */
export function aiTopics(plan: PlanV2, tickets: readonly Ticket[], filter: TopicFilter): TopicsView {
  const live = tickets.filter(t => !t.archived && t.node)
  const byNode = new Map<string, Ticket[]>()
  for (const t of live) byNode.set(t.node!, [...(byNode.get(t.node!) ?? []), t])
  const aiNodes = aiNodesOf(plan)
  const phases = [...new Set(aiNodes.map(n => n.phase))].sort((a, b) => a - b)
  const present = new Set(aiNodes.flatMap(n => (byNode.get(n.id) ?? []).map(t => t.kind)))
  const kinds = TOPIC_KINDS.filter(k => present.has(k))

  const areas: TopicArea[] = []
  for (const area of aiAreasOf(plan)) {
    const nodes: TopicNode[] = []
    for (const node of aiNodes.filter(n => n.area === area.id)) {
      if (filter.phase !== null && node.phase !== filter.phase) continue
      const all = byNode.get(node.id) ?? []
      const mine = filter.kind === null ? all : all.filter(t => t.kind === filter.kind)
      if (filter.kind !== null && mine.length === 0) continue
      nodes.push({
        node, count: mine.length, done: mine.filter(t => t.status === 'done').length, minutes: mine.reduce((a, t) => a + t.estMin, 0),
        kinds: TOPIC_KINDS.flatMap(k => { const c = mine.filter(t => t.kind === k).length; return c > 0 ? [{ kind: k, count: c }] : [] }),
      })
    }
    if (nodes.length === 0) continue
    areas.push({
      area, nodes, done: nodes.reduce((a, n) => a + n.done, 0), total: nodes.reduce((a, n) => a + n.count, 0), minutes: nodes.reduce((a, n) => a + n.minutes, 0),
    })
  }
  return {
    areas, done: areas.reduce((a, x) => a + x.done, 0), total: areas.reduce((a, x) => a + x.total, 0), minutes: areas.reduce((a, x) => a + x.minutes, 0),
    phases, kinds,
  }
}
