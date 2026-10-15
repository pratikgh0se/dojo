import type { PlanArea, PlanNode, PlanPhase, PlanV2 } from '../../src/data/planV2'
import type { Ticket } from '../../src/data/types'
import { flatPlanV2 } from './plan'

const AREA_ROWS: [string, string, string, string[]][] = [
  ['llm', 'LL', 'How LLMs run', []],
  ['measure', 'ME', 'Measuring things', []],
  ['sched', 'SC', 'Scheduling & control planes', ['llm', 'measure']],
  ['state', 'FS', 'Failure & state', ['sched']],
  ['linux', 'LX', 'Linux & isolation', ['state']],
  ['agents', 'AG', 'Agents & evals', ['linux']],
  ['fleet', 'GF', 'GPU fleets & training', ['sched', 'agents']],
  ['safe', 'SS', 'AI safety & security', ['agents', 'linux', 'measure']],
  ['lead', 'LA', 'Leading agents', ['agents', 'ai']],
  ['ai', 'UA', 'Using AI day to day', []],
]
export const AREAS: PlanArea[] = AREA_ROWS.map(([id, tag, name, pre]) => ({ id, tag, name, why: `${name} matters.`, pre }))

export const PHASES: PlanPhase[] = [
  { p: 1, name: 'Measure before you optimise', months: 'Months 1-2', idea: 'Decoding is memory-bound.', authored: true },
  { p: 2, name: 'Batching, KV cache, parallelism, Go', months: 'Months 3-4', idea: 'The batch is the scheduler.', authored: false },
  { p: 3, name: 'The control plane', months: 'Months 5-6', idea: 'Placement is packing.', authored: false },
  { p: 4, name: 'State, failure, data movement', months: 'Months 7-8', idea: 'Assume every call can fail.', authored: false },
  { p: 5, name: 'Isolation, agents, evals', months: 'Months 9-10', idea: 'Untrusted code needs walls.', authored: false },
  { p: 6, name: 'GPU fleets, training, safe rollout', months: 'Months 11-12', idea: 'Hardware failure is routine.', authored: false },
]

const node = (id: string, area: string, phase: number, title: string, pre: string[], hours: number, kind: PlanNode['kind'] = 'lit'): PlanNode =>
  ({ id, area, phase, kind, title, oneLiner: `${title}, in one line.`, why: `Why ${title} matters.`, pre, explain: [`Explain ${title} simply.`], hours })

export const NODES: PlanNode[] = [
  node('L1', 'llm', 1, 'Neural network basics', [], 1),
  node('L2', 'llm', 1, 'Transformers and attention', ['L1'], 1),
  node('L3', 'llm', 1, 'How an LLM is made', ['L2'], 3),
  node('L4', 'llm', 1, 'How inference works', ['L3'], 4),
  node('R1', 'llm', 1, 'Run a real model', ['L1'], 2, 'real'),
  node('M1', 'measure', 1, 'Benchmarks are instruments', [], 2),
  node('S1', 'sched', 2, 'Placement is packing', ['L4', 'M1'], 3),
  node('U7', 'ai', 1, 'Daily AI pulse', [], 0, 'band'),
]

/** A small v2 plan: the ten real areas, six phases (only phase 1 authored), eight nodes. */
export function mkPlanV2(over: Partial<PlanV2> = {}): PlanV2 {
  return {
    planFormat: 2, planVersion: 'ai-infra-v1-test', areas: AREAS, phases: PHASES, nodes: NODES, builds: [], tickets: [],
    dsa_bank: [], design_bank: [], tasks: [], mix: { shares: { path: 58, dsa: 25, design: 17 }, budgets: [90, 60, 60, 60, 30, 30, 150] },
    rituals: [], idMap: {}, ...over,
  }
}

/** What `renderWithApp` needs for a screen that reads the plan v2: a v1 plan for the old readers, the v2 for the new ones. */
export const appPlans = (over: Partial<PlanV2> = {}) => ({ plan: flatPlanV2, planV2: mkPlanV2(over) })

let seq = 0
/** A stored ticket with sensible defaults; `order` rises with each call. */
export function mkTicket(p: Partial<Ticket> & { id: string }): Ticket {
  seq += 1
  return {
    origin: 'plan', track: 'ai', kind: 'watch', title: p.id, links: [], estMin: 30, plannedSprint: 1, sprint: 1,
    status: 'todo', slidFrom: [], xp: 0, archived: false, order: seq, lane: 'path', ...p,
  }
}

/** Two tickets per phase-1 node of the llm area (learn, then build), L1 and L2 done. */
export function mkAiTickets(): Ticket[] {
  const t = (id: string, node: string, o: number, status: Ticket['status'] = 'todo', over: Partial<Ticket> = {}) =>
    mkTicket({ id, node, area: node.startsWith('M') ? 'measure' : 'llm', phase: 1, order: o, status, title: `Watch ${id}`, estMin: 30, ...over })
  return [
    t('ai.l1.learn', 'L1', 1, 'done'), t('ai.l2.learn', 'L2', 2, 'done'),
    t('ai.l3.learn', 'L3', 3), t('ai.l3.build', 'L3', 4, 'todo', { kind: 'build', estMin: 60 }),
    t('ai.l4.learn', 'L4', 5), t('ai.r1.build', 'R1', 6, 'todo', { kind: 'build', estMin: 45 }),
    t('ai.m1.learn', 'M1', 7),
  ]
}
