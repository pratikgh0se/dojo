import type { LabInfo } from '../../../data/labActions'
import { useLabInfos, useLabReviews, useLabRow, useLabRuns } from '../../../data/labHooks'
import type { LabReviewRow, LabRow, LabRunRow, Ticket } from '../../../data/types'
import { isReadOnly } from '../../../data/writer'
import { allMilestonesPassed, milestonePassed } from '../../../rules/lab'

/**
 * Everything the build view needs about the lab of one build ticket (labs.md).
 * state: `loading` until the definition and the stored rows are in; `missing` when the server has no definition (unknown lab, no server);
 * otherwise `not-set-up` or `set-up` by the stored `labs` row. A read-only browser cannot reach the definition, so there it follows the row alone.
 */
export interface LabTicket {
  labId: string
  state: 'loading' | 'missing' | 'not-set-up' | 'set-up'
  /** the definition: undefined while loading, null when the server has none */
  info: LabInfo | null | undefined
  milestone: { ticket: string; checkIds: string[] } | null
  row: LabRow | null | undefined
  runs: LabRunRow[]
  /** this lab's reviews, oldest first */
  reviews: LabReviewRow[]
  /** the Done gate applies: the definition has a milestone for this ticket */
  gated: boolean
  /** this ticket's milestone is passed */
  passed: boolean
  /** every milestone of the lab is passed: the review can be requested */
  allPassed: boolean
  /** Done must be disabled: still loading, or gated and not passed */
  doneLocked: boolean
}

export function useLabTicket(ticket: Ticket): LabTicket | null {
  const labId = ticket.kind === 'build' ? ticket.lab?.id ?? '' : ''
  const infos = useLabInfos(labId ? [labId] : [])
  const row = useLabRow(labId)
  const runs = useLabRuns(labId)
  const reviews = useLabReviews()
  if (!labId) return null
  const info: LabInfo | null | undefined = infos === undefined ? undefined : infos[labId] ?? null
  const loading = info === undefined || row === undefined || runs === undefined || reviews === undefined
  const list = runs ?? []
  const milestone = info?.milestones.find(m => m.ticket === ticket.id) ?? null
  const gated = !loading && milestone !== null
  const passed = milestone !== null && milestonePassed(milestone, list)
  const state: LabTicket['state'] = loading ? 'loading' : info === null && !isReadOnly() ? 'missing' : row ? 'set-up' : 'not-set-up'
  return {
    labId, state, info, milestone, row, runs: list, reviews: (reviews ?? []).filter(r => r.labId === labId),
    gated, passed, allPassed: !!info && allMilestonesPassed(info.milestones, list), doneLocked: loading || (gated && !passed),
  }
}
