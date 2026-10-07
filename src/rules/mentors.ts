import type { CommunityLane, PlanCommunity, PlanJson } from '../data/types'

export const LANES: readonly CommunityLane[] = ['learner', 'contributor', 'program']
export const LANE_LABELS: Record<CommunityLane, string> = { learner: 'Learner rooms', contributor: 'Contributor rooms', program: 'Programs' }

export function communitiesByLane(plan: PlanJson): { lane: CommunityLane; label: string; items: PlanCommunity[] }[] {
  const all = plan.communities ?? []
  return LANES.map(lane => ({ lane, label: LANE_LABELS[lane], items: all.filter(c => c.lane === lane) })).filter(g => g.items.length > 0)
}
