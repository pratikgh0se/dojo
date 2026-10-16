import type { PlanV2 } from '../data/planV2'
import type { Ticket } from '../data/types'
import type { GlyphName } from '../ui/glyphData'
import { DESTINATIONS } from './nav'
import { LANE_LABEL, minutesLabel, plainTitle, tagLane } from './ticketMeta'

export type PaletteKind = 'destination' | 'page' | 'area' | 'skill' | 'ticket'
export interface PaletteItem {
  id: string
  kind: PaletteKind
  label: string
  hint: string
  /** the route the item opens */
  target: string
  /** extra words that find it */
  words: string
  /** the shortcut shown beside it */
  key?: string
}

/** The six keyed destinations first (NAV-39), then the rest of the rail and the pages that are not on it. */
export const STATIC_ITEMS: readonly PaletteItem[] = [
  { id: 'today', kind: 'destination', label: 'Today', hint: 'Your next ticket', target: '/', words: 'home next', key: '1' },
  { id: 'path', kind: 'destination', label: 'Path', hint: 'The queue', target: '/path', words: 'queue tickets', key: '2' },
  { id: 'board', kind: 'destination', label: 'Board', hint: 'Sprint columns', target: '/board', words: 'kanban sprint columns blocked backlog', key: '3' },
  { id: 'journal', kind: 'destination', label: 'Journal', hint: 'How the day went', target: '/journal', words: 'diary day notes reflect', key: '4' },
  { id: 'skills', kind: 'destination', label: 'Skills', hint: 'The skill map', target: '/skills', words: 'tree areas map', key: '5' },
  { id: 'review', kind: 'destination', label: 'Review', hint: 'Cards that are due', target: '/review', words: 'redo due cards', key: '6' },
  { id: 'ai', kind: 'page', label: 'AI topics', hint: 'Every AI topic', target: '/ai-topics', words: 'ai areas nodes overview' },
  { id: 'dsa', kind: 'page', label: 'DSA practice', hint: 'Problems by topic', target: '/dsa', words: 'algorithms problems' },
  { id: 'designs', kind: 'page', label: 'Designs', hint: 'Design tiers', target: '/designs', words: 'system design tiers' },
  { id: 'banks', kind: 'page', label: 'Question banks', hint: 'Problem lists', target: '/banks', words: 'lists problems' },
  { id: 'atlas', kind: 'page', label: 'Algorithm atlas', hint: 'Patterns', target: '/atlas', words: 'patterns' },
  { id: 'portfolio', kind: 'page', label: 'Portfolio', hint: 'Proven labs to publish', target: '/portfolio', words: 'publish repo article linkedin github proven' },
  { id: 'guide', kind: 'page', label: 'Guide', hint: 'How Dojo works', target: '/guide', words: 'help rules mentors ritual overview' },
  { id: 'stats', kind: 'page', label: 'Stats', hint: 'Minutes done', target: '/skills/stats', words: 'progress pace minutes' },
  { id: 'settings', kind: 'page', label: 'Settings', hint: 'Pace, labels, backups', target: '/settings', words: 'pace budget backup preferences' },
]

/** The row icon: a glyph per destination or page, one per kind for the rest. */
const ITEM_GLYPH: Record<string, GlyphName> = {
  ...Object.fromEntries(DESTINATIONS.map(d => [d.id, d.glyph])), stats: 'metric', settings: 'build',
}
const KIND_GLYPH: Record<PaletteKind, GlyphName> = { destination: 'home', page: 'doc', area: 'branch', skill: 'tag', ticket: 'play' }
export const itemGlyph = (item: PaletteItem): GlyphName => ITEM_GLYPH[item.id] ?? KIND_GLYPH[item.kind]

/** The section a row sits under: destinations are "Go to", pages "Also here" (the mockup's labels), then one per content kind. */
export const SECTION_LABEL: Record<PaletteKind, string> = { destination: 'Go to', page: 'Also here', area: 'Skills', skill: 'Skills', ticket: 'Tickets' }

export function skillItems(plan: PlanV2 | null): PaletteItem[] {
  if (!plan) return []
  const areas = plan.areas.map((a): PaletteItem => ({
    id: `area:${a.id}`, kind: 'area', label: a.name, hint: 'Skill area', target: `/skills/area/${a.id}`, words: `${a.tag} ${a.id}`,
  }))
  const nodes = plan.nodes.map((n): PaletteItem => ({
    id: `node:${n.id}`, kind: 'skill', label: n.title, hint: `Topic · ${plan.areas.find(a => a.id === n.area)?.name ?? n.area}`,
    target: `/skills/area/${n.area}?node=${n.id}`, words: n.id,
  }))
  return [...areas, ...nodes]
}

/**
 * Open and done tickets (TICKET-05 reaches done ones); archived tickets are left out. The label is the title verbatim (R2).
 * A design or write-up ticket, in any status, opens its design session (NAV-37, NAV-38); opening it writes nothing.
 */
export function ticketItems(tickets: readonly Ticket[]): PaletteItem[] {
  return tickets.filter(t => !t.archived).map((t): PaletteItem => ({
    id: `ticket:${t.id}`, kind: 'ticket', label: plainTitle(t), hint: `${LANE_LABEL[tagLane(t)]} · ${minutesLabel(t.estMin)}${t.status === 'done' ? ' · done' : ''}`,
    target: t.kind === 'design' || t.kind === 'writeup' ? `/designs/session/${t.id}` : `/do/${t.id}`, words: t.id,
  }))
}

const PRIORITY: Record<PaletteKind, number> = { destination: 0, page: 1, area: 2, skill: 3, ticket: 4 }
const WORD_SPLIT = /[\s·:,.()/-]+/

const words = (label: string): string[] => label.toLowerCase().split(WORD_SPLIT).filter(Boolean)

/** 0 means no match. Substring matching only: no letter-subsequence fallback, so a nonsense query can match nothing (SHELL-18). */
function score(item: PaletteItem, q: string): number {
  const label = item.label.toLowerCase()
  if (label === q) return 100
  if (label.startsWith(q)) return 90
  if (words(label).some(w => w.startsWith(q))) return 80
  if (label.includes(q)) return 60
  if (item.words.toLowerCase().includes(q)) return 40
  return 0
}

/**
 * Empty query: the destinations (with keys 1 to 6) and pages. Otherwise matches best first; ties put whole-word matches
 * first, then destinations and pages before areas before skills before tickets, then by label. A query lists every match
 * (SHELL-17: a common word matches hundreds of tickets and the target must be among them); `max` caps it for a caller that wants to.
 */
export function rank(items: readonly PaletteItem[], query: string, max: number = Number.POSITIVE_INFINITY): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.filter(i => i.kind === 'destination' || i.kind === 'page').slice(0, max)
  const qWords = q.split(WORD_SPLIT).filter(Boolean)
  const whole = (item: PaletteItem): number => (qWords.length > 0 && qWords.every(w => words(item.label).includes(w)) ? 1 : 0)
  return items
    .map(item => ({ item, s: score(item, q), w: whole(item) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.w - a.w || PRIORITY[a.item.kind] - PRIORITY[b.item.kind] || a.item.label.localeCompare(b.item.label))
    .slice(0, max)
    .map(x => x.item)
}
