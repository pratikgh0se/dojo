import { INTERVIEW_RUBRIC } from '../ai/rubric'
import type { Score012 } from '../ai/types'
import type { DeepDive, PartnerScores } from '../data/types'
import { capScore } from './designSession'

export const ROW_MAX = 4
/** Longest partner note kept (the card's box stops here and the data layer cuts anything longer). */
export const PARTNER_NOTES_MAX = 2000
/** The partner's note as the host reads it: a string cut to the limit, or '' for anything else. */
export const partnerNotesText = (v: unknown): string => (typeof v === 'string' ? v.slice(0, PARTNER_NOTES_MAX) : '')
export const DIVE_MAX = 2

const HINTS = [
  'Asks about users, scale and scope first; gives numbers',
  'Names the calls and the data before the boxes',
  'The boxes follow the numbers and the data is named',
  'Two deep dives, each naming what the choice costs',
  'Says what breaks and who is paged',
]
export const PARTNER_ROWS = INTERVIEW_RUBRIC.map((r, i) => ({ n: i + 1, item: r.item, hint: HINTS[i] }))

export const emptyPartnerScores = (): PartnerScores => ({ perItem: [null, null, null, null, null], deepDives: [null, null, null, null] })

const clampInt = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null

export function normalizePartnerScores(raw: unknown): PartnerScores {
  const s = emptyPartnerScores()
  if (!raw || typeof raw !== 'object') return s
  const r = raw as { perItem?: unknown; deepDives?: unknown }
  const rows = Array.isArray(r.perItem) ? r.perItem : []
  const dives = Array.isArray(r.deepDives) ? r.deepDives : []
  s.perItem = s.perItem.map((_, i) => clampInt(rows[i], ROW_MAX))
  // a stored dive score outside 0-2 is unreadable, not clamped (rows clamp; the contract test pins both)
  s.deepDives = s.deepDives.map((_, i) => (typeof dives[i] === 'number' && dives[i] >= 0 && dives[i] <= DIVE_MAX ? (Math.round(dives[i]) as Score012) : null))
  return s
}

export const setRow = (s: PartnerScores, n: number, v: number | null): PartnerScores => ({ ...s, perItem: s.perItem.map((x, i) => (i === n - 1 ? (v === null ? null : clampInt(v, ROW_MAX)) : x)) })
export const setDive = (s: PartnerScores, n: number, v: number | null): PartnerScores =>
  ({ ...s, deepDives: s.deepDives.map((x, i) => (i === n - 1 ? (v === null ? null : (clampInt(v, DIVE_MAX) as Score012)) : x)) })

export const partnerTotal = (s: PartnerScores): number => s.perItem.reduce<number>((a, v) => a + (v ?? 0), 0)
export const partnerComplete = (s: PartnerScores): boolean => s.perItem.every(v => v !== null)

export const PUSH_BACKS = [
  'That sounds fine for today. What breaks first if traffic doubles?',
  'You have two weeks to ship. What do you cut, and what does that cost?',
]
export interface FollowUp { n: number; text: string; generic: boolean }
export function followUps(deepDives: readonly string[]): FollowUp[] {
  return [...deepDives.slice(0, 4).map(text => ({ text, generic: false })), ...PUSH_BACKS.map(text => ({ text, generic: true }))].map((f, i) => ({ n: i + 1, ...f }))
}
export const openingLine = (title: string): string => `"We want to design this: ${title}. What would you like to know?"`

/** The partner's sheet as the score form's starting point. The rubric needs all five rows; each deep dive stands alone. */
export function prefillFromPartner(s: PartnerScores | undefined, dives: DeepDive[], cap: number | null): { deepDives: DeepDive[]; rubric: number | null } {
  if (!s) return { deepDives: dives, rubric: null }
  const n = normalizePartnerScores(s)
  return {
    deepDives: dives.map((d, i) => (n.deepDives[i] === null ? d : { ...d, answered: capScore(n.deepDives[i], i, cap), by: 'partner' as const })),
    rubric: partnerComplete(n) ? partnerTotal(n) : null,
  }
}
