import type { Lane, Ticket } from '../data/types'
import { isBankOrigin } from './bankTickets'

/** The lanes the day mix draws from (spec 3.2): career only when enabled. */
export function mixLanes(careerLane: boolean): Lane[] {
  return careerLane ? ['path', 'dsa', 'design', 'career'] : ['path', 'dsa', 'design']
}

const DESIGN_SKILLS = new Set(['sysd', 'mlsys', 'datasys', 'agentic'])
const CAREER_SKILLS = new Set(['loops', 'apply'])

/**
 * The lane of a ticket. After the migration every plan ticket carries `lane`; this also reads pre-migration tickets
 * (kind, track, skill) so the selectors work on any document, and puts bank and Mine tickets in the done-only bank lane.
 */
export function laneOf(t: Pick<Ticket, 'lane' | 'origin' | 'track' | 'kind' | 'skill'>): Lane {
  if (isBankOrigin(t.origin)) return 'bank'
  if (t.lane) return t.lane
  if (t.track === 'ai') return 'path'
  if (t.kind === 'problem') return 'dsa'
  if (t.kind === 'design') return 'design'
  if (t.skill && DESIGN_SKILLS.has(t.skill)) return 'design'
  if (t.skill && CAREER_SKILLS.has(t.skill)) return 'career'
  return 'dsa'
}
