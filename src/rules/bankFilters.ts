import { ATLAS_PATTERNS } from '../content/patterns'
import { BANK_TABS, type BankTabId } from '../content/banks/meta'
import type { ItemDifficulty } from '../content/banks/types'
import type { BankEntry, ItemView } from './banks'
import { UNTAGGED } from './banks'
import { DIFFICULTIES, DIFFICULTY_LABELS } from './dsa'

export const NO_VALUE = '—'
export const UNTAGGED_VALUE = 'untagged'
export type StatusFilter = 'todo' | 'done'

export interface BankFilters { diff: string | null; pattern: string | null; status: StatusFilter | null; q: string }
export const FILTER_KEYS = ['diff', 'pattern', 'status', 'q'] as const

export interface Option { value: string; label: string }

export const STATUS_OPTIONS: readonly Option[] = [
  { value: '', label: 'All' }, { value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' },
]

const BANK_IDS = new Set<string>(BANK_TABS.map(t => t.id))
const CF_BANDS = new Set([1200, 1300, 1400, 1500, 1600])

export function readBankId(params: URLSearchParams): BankTabId {
  const b = params.get('bank')
  return b !== null && BANK_IDS.has(b) ? (b as BankTabId) : 'plan'
}

export function readFilters(params: URLSearchParams): BankFilters {
  const s = params.get('status')
  return {
    diff: params.get('diff') || null,
    pattern: params.get('pattern') || null,
    status: s === 'todo' || s === 'done' ? s : null,
    q: params.get('q') ?? '',
  }
}

export function hasFilters(f: BankFilters): boolean {
  return f.diff !== null || f.pattern !== null || f.status !== null || f.q !== ''
}

/** Drops a difficulty or pattern this bank does not offer (hand-edited or stale URLs). */
export function sanitizeFilters(f: BankFilters, diff: Option[] | null, pats: Option[] | null): BankFilters {
  const offered = (v: string | null, opts: Option[] | null) => (v !== null && opts?.some(o => o.value === v) ? v : null)
  return { ...f, diff: offered(f.diff, diff), pattern: offered(f.pattern, pats) }
}

export function matchesQuery(e: BankEntry, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  if (e.name.toLowerCase().includes(s)) return true
  return /^\d+$/.test(s) && e.num === Number(s)
}

export function applyFilters(items: ItemView[], f: BankFilters): ItemView[] {
  return items.filter(i =>
    (f.diff === null || String(i.difficulty) === f.diff) &&
    (f.pattern === null || (f.pattern === UNTAGGED_VALUE ? i.pattern === null : i.pattern === f.pattern)) &&
    (f.status === null || (f.status === 'done') === i.done) &&
    matchesQuery(i, f.q))
}

export function difficultyOptions(bank: BankTabId, entries: BankEntry[]): Option[] | null {
  if (bank === 'hellointerview') return null
  const all: Option = { value: '', label: 'All' }
  if (bank === 'codeforces') {
    const ratings = [...new Set(entries.map(e => e.difficulty).filter((d): d is number => typeof d === 'number'))].sort((a, b) => a - b)
    return [all, ...ratings.map(r => ({ value: String(r), label: String(r) }))]
  }
  return [all, ...DIFFICULTIES.map(d => ({ value: d, label: DIFFICULTY_LABELS[d] }))]
}

export function patternOptions(bank: BankTabId, entries: BankEntry[]): Option[] | null {
  if (bank === 'hellointerview') return null
  const out: Option[] = [{ value: '', label: 'All patterns' }]
  for (const p of ATLAS_PATTERNS) if (entries.some(e => e.pattern === p)) out.push({ value: p, label: p })
  if (entries.some(e => e.pattern === null)) out.push({ value: UNTAGGED_VALUE, label: UNTAGGED })
  return out
}

export function difficultyChip(d: ItemDifficulty): string {
  return d === null ? NO_VALUE : String(d)
}

export function cellTone(d: ItemDifficulty): string {
  if (d === null) return 'diff-none'
  if (typeof d === 'number') return CF_BANDS.has(d) ? `band-${d}` : 'band-other'
  return `diff-${d}`
}

export function cellLabel(i: ItemView): string {
  return i.plan ? `${i.name} · ${i.plan.cubeLabel}` : `${i.name} · ${difficultyChip(i.difficulty)} · ${i.done ? 'done' : 'todo'}`
}
