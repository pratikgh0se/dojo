import type { Difficulty } from '../data/types'
import { BANK_TABS, KNOWN_ITEM_ORDER, type BankTabId } from '../content/banks/meta'
import type { ItemDifficulty } from '../content/banks/types'
import type { BankEntry, Banks } from './banks'

export type MineSource = 'LeetCode' | 'Codeforces' | 'Text'

export interface MineParse {
  source: MineSource
  title: string
  url: string | null
  slug: string | null
  contestId: number | null
  index: string | null
  /** stable id when the input names one (`cf-9998A`); null otherwise */
  id: string | null
}

export const MINE_TITLE_MAX = 80
export const MINE_DUPLICATE = 'Already in Mine'
/** Known Codeforces items in Mine are E/M/H only (C-BANKS §2): rating < 1400 E, < 1900 M, else H. */
export const MINE_EASY_BELOW = 1400
export const MINE_HARD_FROM = 1900

const LC_RE = /^https?:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9-]+)\/?(?:[?#]\S*)?$/i
const CF_RE = /^https?:\/\/(?:www\.)?codeforces\.com\/(?:problemset\/problem\/(\d+)\/([a-z][0-9]?)|contest\/(\d+)\/problem\/([a-z][0-9]?))\/?(?:[?#]\S*)?$/i

export function lcSlug(url: string | null | undefined): string | null {
  return /leetcode\.com\/problems\/([a-z0-9-]+)/i.exec(url ?? '')?.[1]?.toLowerCase() ?? null
}

export function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

export function parseMineInput(input: string): MineParse {
  const s = input.trim()
  const lc = LC_RE.exec(s)
  if (lc) {
    const slug = lc[1].toLowerCase()
    return { source: 'LeetCode', title: titleFromSlug(slug), url: `https://leetcode.com/problems/${slug}/`, slug, contestId: null, index: null, id: null }
  }
  const cf = CF_RE.exec(s)
  if (cf) {
    const contestId = Number(cf[1] ?? cf[3])
    const index = (cf[2] ?? cf[4]).toUpperCase()
    return {
      source: 'Codeforces', title: `CF ${contestId}${index}`, url: `https://codeforces.com/problemset/problem/${contestId}/${index}`,
      slug: null, contestId, index, id: `cf-${contestId}${index}`,
    }
  }
  const first = s.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
  return { source: 'Text', title: first.slice(0, MINE_TITLE_MAX).trim(), url: null, slug: null, contestId: null, index: null, id: null }
}

export interface KnownItem { bank: BankTabId; label: string; entry: BankEntry }

export function knownItem(p: MineParse, banks: Banks): KnownItem | null {
  if (p.source === 'Text') return null
  for (const bank of KNOWN_ITEM_ORDER) {
    for (const e of banks[bank].entries) {
      const hit = p.source === 'LeetCode'
        ? e.url !== null && lcSlug(e.url) === p.slug
        : e.contestId === p.contestId && e.index === p.index
      if (hit) return { bank, label: BANK_TABS.find(t => t.id === bank)?.label ?? bank, entry: e }
    }
  }
  return null
}

export function mineDifficulty(d: ItemDifficulty): Difficulty {
  if (d === 'E' || d === 'M' || d === 'H') return d
  if (typeof d === 'number') return d < MINE_EASY_BELOW ? 'E' : d < MINE_HARD_FROM ? 'M' : 'H'
  return 'M'
}

export function isDuplicateInMine(p: MineParse, known: KnownItem | null, mine: BankEntry[]): boolean {
  const key = known?.entry.id ?? p.id
  if (key !== null && mine.some(e => e.id === key)) return true
  if (p.slug !== null) return mine.some(e => lcSlug(e.url) === p.slug)
  return false
}

export function sourceOfUrl(url: string | null): MineSource {
  if (lcSlug(url)) return 'LeetCode'
  if (url && /codeforces\.com/.test(url)) return 'Codeforces'
  return 'Text'
}
