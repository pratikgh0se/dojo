import type { GlyphName } from '../ui/glyphData'
import type { NavLabels } from './prefs'

export type { NavLabels }
export type DestinationId =
  | 'today' | 'path' | 'board' | 'journal' | 'skills' | 'review' | 'ai' | 'dsa' | 'designs' | 'banks' | 'atlas' | 'guide'
/** The rail's groups (NAV-01): the six main destinations, Topics, Practice, and the foot (Guide, then the toggle). */
export type NavGroup = 'main' | 'topics' | 'practice' | 'foot'
export interface Destination { id: DestinationId; to: string; label: string; key?: '1' | '2' | '3' | '4' | '5' | '6'; glyph: GlyphName; group: NavGroup }

export const DESTINATIONS: readonly Destination[] = [
  { id: 'today', to: '/', label: 'Today', key: '1', glyph: 'home', group: 'main' },
  { id: 'path', to: '/path', label: 'Path', key: '2', glyph: 'queue', group: 'main' },
  { id: 'board', to: '/board', label: 'Board', key: '3', glyph: 'block', group: 'main' },
  { id: 'journal', to: '/journal', label: 'Journal', key: '4', glyph: 'edit', group: 'main' },
  { id: 'skills', to: '/skills', label: 'Skills', key: '5', glyph: 'branch', group: 'main' },
  { id: 'review', to: '/review', label: 'Review', key: '6', glyph: 'question', group: 'main' },
  { id: 'ai', to: '/ai-topics', label: 'AI', glyph: 'cloud', group: 'topics' },
  { id: 'dsa', to: '/dsa', label: 'DSA', glyph: 'code', group: 'topics' },
  { id: 'designs', to: '/designs', label: 'Designs', glyph: 'container', group: 'topics' },
  { id: 'banks', to: '/banks', label: 'Banks', glyph: 'doc', group: 'practice' },
  { id: 'atlas', to: '/atlas', label: 'Atlas', glyph: 'globe', group: 'practice' },
  { id: 'guide', to: '/guide', label: 'Guide', glyph: 'info', group: 'foot' },
]

/** The phone's tab bar (NAV-09); the other eight sit in the More sheet (NAV-10). */
export const TAB_IDS: readonly DestinationId[] = ['today', 'path', 'board', 'review']
export const MORE_IDS: readonly DestinationId[] = DESTINATIONS.map(d => d.id).filter(id => !TAB_IDS.includes(id))

/** The destination a route belongs to (NAV-03). A ticket, a design session and Settings belong to none. */
export function currentDestination(pathname: string): DestinationId | null {
  if (pathname === '/') return 'today'
  if (pathname.startsWith('/skills/')) return 'skills' // area views and Stats; every other route is its own, exactly (a design session is no destination)
  return DESTINATIONS.find(d => d.to !== '/' && d.to === pathname)?.id ?? null
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Today'], [/^\/path$/, 'Path'], [/^\/journal$/, 'Journal'], [/^\/skills(\/.*)?$/, 'Skills'], [/^\/review$/, 'Review'],
  [/^\/do\//, 'Ticket'], [/^\/designs\/session\//, 'Design session'], [/^\/settings$/, 'Settings'],
]
/**
 * The one heading of a screen, drawn in the header. Empty where the screen draws its own h1: Board, AI topics, the Guide
 * ("How Dojo works") and the DSA, Designs, Atlas and Banks screens.
 */
export const titleFor = (pathname: string): string => TITLES.find(([re]) => re.test(pathname))?.[1] ?? (pathname === '/' ? 'Today' : '')

/**
 * Labels beside the rail icons (SHELL-08/09): decided once per page load. A fresh install (unset) or a stored `intro`
 * shows them for this whole page load and stores `hover` at once, so the data API says `hover` before any reload and the
 * next load starts collapsed. `always` is the Settings switch and writes nothing.
 */
export function labelsDecision(stored: NavLabels | undefined): { show: boolean; write: NavLabels | null } {
  if (stored === undefined || stored === 'intro') return { show: true, write: 'hover' }
  return { show: stored === 'always', write: null }
}
