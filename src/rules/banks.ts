import type { BankItem, PlanJson, Ticket } from '../data/types'
import { ATLAS_PATTERNS, type AtlasPattern } from '../content/patterns'
import { BANK_TABS, DESIGN_OVERLAP, type BankTabId } from '../content/banks/meta'
import type { LoadedPacks } from '../content/banks/packs'
import type { ItemDifficulty, ShippedBank, ShippedBankId } from '../content/banks/types'
import { resolveLcPattern } from './bankPatterns'

export type ItemKind = 'problem' | 'design'

export interface BankEntry {
  id: string
  name: string
  url: string | null
  difficulty: ItemDifficulty
  pattern: AtlasPattern | null
  group: string
  kind: ItemKind
  num?: number
  contestId?: number
  index?: string
  /** `bankItems` row id, for Mine rows and imported Codeforces rows */
  rowId?: string
  /**
   * A known Codeforces item's rating, carried onto a Mine row even though `difficulty`
   * there is the E/M/H bucket (C-BANKS §2 "same XP as ticking it in Codeforces").
   */
  rating?: number
}

export interface BankData { id: BankTabId; entries: BankEntry[]; groups: string[] }
export type Banks = Record<BankTabId, BankData>

export interface PlanRef {
  /** the shared plan ticket id (`p200`, `d-chat`) */
  ticketId: string
  /** row marker text: `Plan · S1` or `Plan · d-chat` */
  marker: string
  /** where the marker and the link cube navigate */
  href: string
  /** heatmap cube accessible-name suffix: `in plan S1` */
  cubeLabel: string
}

export interface ItemView extends BankEntry {
  plan: PlanRef | null
  ticketId: string
  ticket: Ticket | null
  done: boolean
  /** in-plan item whose plan ticket is missing: shown, not tickable */
  readOnly: boolean
}

export interface GroupView { title: string; slug: string; items: ItemView[]; done: number; total: number }

export const UNTAGGED = 'Untagged'

export function groupSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function planRefs(plan: PlanJson): Map<string, PlanRef> {
  const out = new Map<string, PlanRef>()
  for (const w of plan.dsa_bank) {
    for (const p of w.problems) {
      const id = `p${p.num}`
      if (!out.has(id)) out.set(id, { ticketId: id, marker: `Plan · S${w.sprint}`, href: `/dsa?topic=${w.sprint}`, cubeLabel: `in plan S${w.sprint}` })
    }
  }
  const tierOf = new Map<string, number>()
  plan.design_bank.forEach((t, i) => t.items.forEach(it => tierOf.set(it.id, i + 1)))
  for (const [hi, design] of Object.entries(DESIGN_OVERLAP)) {
    const tier = tierOf.get(design)
    if (tier !== undefined) out.set(hi, { ticketId: design, marker: `Plan · ${design}`, href: `/designs?tier=${tier}`, cubeLabel: `in plan ${design}` })
  }
  return out
}

export function planBank(plan: PlanJson): BankData {
  const groups: string[] = []
  const entries: BankEntry[] = []
  for (const w of plan.dsa_bank) {
    const group = `S${w.sprint} · ${w.topic}`
    groups.push(group)
    for (const p of w.problems) {
      entries.push({
        id: `p${p.num}`, name: p.name, url: p.url, difficulty: p.difficulty,
        pattern: resolveLcPattern(p.num, w.sprint, 'plan', ''), group, kind: 'problem', num: p.num,
      })
    }
  }
  return { id: 'plan', entries, groups }
}

const emptyBank = (id: ShippedBankId): BankData => ({ id, entries: [], groups: [] })

export function shippedBank(b: ShippedBank | undefined, id?: ShippedBankId): BankData {
  if (!b) return emptyBank(id as ShippedBankId)
  const kind: ItemKind = b.bank === 'hellointerview' ? 'design' : 'problem'
  return {
    id: b.bank,
    groups: [...b.groups],
    entries: b.items.map(i => {
      const e: BankEntry = { id: i.id, name: i.name, url: i.url, difficulty: i.difficulty, pattern: i.pattern, group: i.group, kind }
      if (i.num !== undefined) e.num = i.num
      if (i.contestId !== undefined) e.contestId = i.contestId
      if (i.index !== undefined) e.index = i.index
      return e
    }),
  }
}

const CF_URL = /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z][0-9]?)/

export function cfParts(url: string | null | undefined): { contestId: number; index: string } | null {
  const m = CF_URL.exec(url ?? '')
  return m ? { contestId: Number(m[1]), index: m[2].toUpperCase() } : null
}

export function storedEntry(r: BankItem): BankEntry {
  const isCf = r.bank === 'codeforces'
  const e: BankEntry = {
    id: r.key,
    name: r.name,
    url: r.url ?? null,
    difficulty: isCf ? (r.rating ?? null) : (r.difficulty ?? null),
    pattern: r.pattern ?? null,
    group: isCf ? String(r.rating ?? '') : (r.pattern ?? UNTAGGED),
    kind: 'problem',
    rowId: r.id,
  }
  if (r.num !== undefined) e.num = r.num
  if (r.rating !== undefined) e.rating = r.rating
  const cf = r.key.startsWith('cf-') ? cfParts(r.url) : null
  if (cf) {
    e.contestId = cf.contestId
    e.index = cf.index
  }
  return e
}

const byAdded = (a: BankItem, b: BankItem) => a.addedAt - b.addedAt || a.id.localeCompare(b.id)

export function buildBanks(plan: PlanJson, shipped: LoadedPacks, rows: BankItem[]): Banks {
  const cf = shippedBank(shipped.codeforces, 'codeforces')
  const shippedCf = new Set(cf.entries.map(e => e.id))
  const imported = rows.filter(r => r.bank === 'codeforces' && !shippedCf.has(r.key)).sort(byAdded).map(storedEntry)
  const cfGroups = [...new Set([...cf.groups, ...imported.map(e => e.group)])].sort((a, b) => Number(a) - Number(b))

  const mine = rows.filter(r => r.bank === 'mine').sort(byAdded).map(storedEntry)
  const mineGroups: string[] = ATLAS_PATTERNS.filter(p => mine.some(e => e.pattern === p))
  if (mine.some(e => e.pattern === null)) mineGroups.push(UNTAGGED)

  return {
    plan: planBank(plan),
    neetcode150: shippedBank(shipped.neetcode150, 'neetcode150'),
    blind75: shippedBank(shipped.blind75, 'blind75'),
    striver: shippedBank(shipped.striver, 'striver'),
    codeforces: { id: 'codeforces', entries: [...cf.entries, ...imported], groups: cfGroups },
    hellointerview: shippedBank(shipped.hellointerview, 'hellointerview'),
    mine: { id: 'mine', entries: mine, groups: mineGroups },
  }
}

/**
 * Contract DECISION 9: two rows that carry the same LeetCode `num` (e.g. a Striver
 * variant like "Morris Inorder Traversal" and the canonical `p94`) are the same
 * problem and share one ticket, keyed `p<num>`. Only falls back to the row's own id
 * when it has no `num` (Codeforces, Hello Interview, Mine, plain-text Mine rows).
 */
function numTicketId(e: BankEntry): string {
  return e.num !== undefined ? `p${e.num}` : e.id
}

export function itemViews(bank: BankData, refs: Map<string, PlanRef>, tickets: Map<string, Ticket>): ItemView[] {
  return bank.entries.map(e => {
    const plan = refs.get(e.id) ?? refs.get(numTicketId(e)) ?? null
    const ticketId = plan?.ticketId ?? numTicketId(e)
    const ticket = tickets.get(ticketId) ?? null
    return { ...e, plan, ticketId, ticket, done: ticket?.status === 'done', readOnly: plan !== null && ticket === null }
  })
}

/** `tickets` must be live tickets only (`liveTicketMap`). */
export function allViews(banks: Banks, refs: Map<string, PlanRef>, tickets: Map<string, Ticket>): Record<BankTabId, ItemView[]> {
  const out = {} as Record<BankTabId, ItemView[]>
  for (const t of BANK_TABS) out[t.id] = itemViews(banks[t.id], refs, tickets)
  return out
}

export function countDone(items: ItemView[]): { done: number; total: number } {
  return { done: items.filter(i => i.done).length, total: items.length }
}

export function groupViews(groups: string[], all: ItemView[], visible: ItemView[]): GroupView[] {
  const out: GroupView[] = []
  for (const title of groups) {
    const shown = visible.filter(i => i.group === title)
    if (shown.length === 0) continue
    const mine = all.filter(i => i.group === title)
    out.push({ title, slug: groupSlug(title), items: shown, done: mine.filter(i => i.done).length, total: mine.length })
  }
  return out
}
