import type { Difficulty, Link, PlanJson, Ticket } from '../data/types'
import { liveTicketMap } from './board'
import { tierRange } from './planTickets'

/** Prototype rule: every done design counts its four deep dives as covered (no per-question scoring). */
export const DEEP_DIVES_PER_DESIGN = 4

export interface DesignItemView {
  id: string
  title: string
  difficulty: Difficulty
  deepDives: string[]
  refs: Link[]
  ticket: Ticket | null
  done: boolean
  /** 1-based tier index */
  tier: number
}

export interface DesignTierView {
  index: number
  name: string
  label: string
  skill: string
  from: number
  to: number
  items: DesignItemView[]
  done: number
  total: number
}

export interface DesignTotals {
  done: number
  total: number
  deepDivesCovered: number
  byDifficulty: Record<Difficulty, { done: number; total: number }>
}

export type DesignCallout =
  | { kind: 'none' | 'before' | 'all-done'; text: string }
  | { kind: 'next'; item: DesignItemView; tier: DesignTierView }

export function tierLabel(name: string): string {
  return name.replace(/\s*\(sprints \d+ to \d+\)\s*$/, '').trim()
}

export function designTiers(plan: PlanJson, tickets: Ticket[]): DesignTierView[] {
  const byId = liveTicketMap(tickets)
  return plan.design_bank.map((tier, i) => {
    const [from, to] = tierRange(tier.tier)
    const items: DesignItemView[] = tier.items.map(it => {
      const ticket = byId.get(it.id) ?? null
      return {
        id: it.id, title: it.title, difficulty: it.difficulty, deepDives: it.deep_dives, refs: it.refs,
        ticket, done: ticket?.status === 'done', tier: i + 1,
      }
    })
    return {
      index: i + 1, name: tier.tier, label: tierLabel(tier.tier), skill: tier.skill, from, to, items,
      done: items.filter(x => x.done).length, total: items.length,
    }
  })
}

export function designTotals(tiers: DesignTierView[]): DesignTotals {
  const byDifficulty: DesignTotals['byDifficulty'] = { E: { done: 0, total: 0 }, M: { done: 0, total: 0 }, H: { done: 0, total: 0 } }
  let done = 0
  let total = 0
  for (const it of tiers.flatMap(t => t.items)) {
    total++
    byDifficulty[it.difficulty].total++
    if (it.done) {
      done++
      byDifficulty[it.difficulty].done++
    }
  }
  return { done, total, deepDivesCovered: done * DEEP_DIVES_PER_DESIGN, byDifficulty }
}

const firstUndone = (tiers: DesignTierView[]): DesignItemView | null =>
  tiers.flatMap(t => t.items).find(i => !i.done) ?? null

export function nextDesign(tiers: DesignTierView[], currentSprint: number): DesignItemView | null {
  if (tiers.length === 0) return null
  const first = Math.min(...tiers.map(t => t.from))
  if (currentSprint < first) return null
  const k = tiers.findIndex(t => currentSprint >= t.from && currentSprint <= t.to)
  if (k >= 0) return firstUndone(tiers.slice(k)) ?? firstUndone(tiers)
  return firstUndone(tiers)
}

export function designCallout(tiers: DesignTierView[], currentSprint: number): DesignCallout {
  if (tiers.length === 0) return { kind: 'none', text: 'No design bank in this plan' }
  const first = Math.min(...tiers.map(t => t.from))
  if (currentSprint < first) return { kind: 'before', text: `Design bank starts S${first}` }
  const item = nextDesign(tiers, currentSprint)
  if (!item) return { kind: 'all-done', text: `All ${tiers.reduce((a, t) => a + t.total, 0)} done` }
  return { kind: 'next', item, tier: tiers[item.tier - 1] }
}

export interface PlanDesignRef {
  id: string
  title: string
  difficulty: Difficulty
  deepDives: string[]
  refs: Link[]
  /** 1-based tier index */
  tier: number
  /** the plan's full tier name, e.g. "Core distributed systems (sprints 25 to 32)" */
  tierName: string
  tierLabel: string
  tierShort: string
  /** 0-based position in plan order (tier, then item) */
  order: number
}

/** Prototype chart labels (quest.dc.html dTierData). */
const TIER_SHORT: Record<string, string> = {
  'Core distributed systems': 'Distributed',
  'Hard classic designs': 'Classic',
  'Data-heavy systems': 'Data-heavy',
  'LLM and agentic systems': 'LLM + agents',
}

export function tierShort(name: string): string {
  const label = tierLabel(name)
  return TIER_SHORT[label] ?? label
}

export function planDesigns(plan: PlanJson): PlanDesignRef[] {
  let order = 0
  return plan.design_bank.flatMap((t, i) =>
    t.items.map(it => ({
      id: it.id, title: it.title, difficulty: it.difficulty, deepDives: it.deep_dives, refs: it.refs,
      tier: i + 1, tierName: t.tier, tierLabel: tierLabel(t.tier), tierShort: tierShort(t.tier), order: order++,
    })),
  )
}

export function findDesign(plan: PlanJson, id: string): PlanDesignRef | null {
  return planDesigns(plan).find(d => d.id === id) ?? null
}
