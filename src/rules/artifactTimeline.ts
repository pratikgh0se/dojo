import type { ArtifactStatus } from '../data/types'
import { STATUS_ORDER, statusLogOf, type ArtifactRecord } from './artifacts'
import { sprintStart, TOTAL_SPRINTS, viewSprint } from './sprint'

export interface TimelineRow { sprint: number; counts: Record<ArtifactStatus, number> }

/**
 * Status at time t: the last log entry with at ≤ t (append order breaks equal timestamps).
 * With no entry yet, a seeded artifact is "not started" (it stands for a plan rung from day one)
 * and a user-added one does not exist.
 */
export function statusAtTime(a: ArtifactRecord, t: number): ArtifactStatus | null {
  let s: ArtifactStatus | null = null
  for (const step of statusLogOf(a)) if (step.at <= t) s = step.status
  if (s) return s
  return a.userAdded ? null : 'not started'
}

/**
 * One row per sprint from S1 to the current sprint, each read at its last ms (the current row's
 * "last ms" is simply the end of the current sprint's own window, same as any other row — the
 * sprint boundary is always in the future, so this reads identically to "now" for every row).
 */
export function timelineRows(
  list: readonly ArtifactRecord[], startDate: string, nowMs: number, lastSprint: number = TOTAL_SPRINTS,
): TimelineRow[] {
  if (!startDate) return []
  const current = viewSprint(nowMs, startDate, lastSprint)
  if (current <= 0) return []
  const upto = Math.min(current, lastSprint)
  const rows: TimelineRow[] = []
  for (let n = 1; n <= upto; n++) {
    const end = sprintStart(n + 1, startDate) - 1
    const counts = {} as Record<ArtifactStatus, number>
    for (const s of STATUS_ORDER) counts[s] = 0
    for (const a of list) {
      const s = statusAtTime(a, end)
      if (s) counts[s]++
    }
    rows.push({ sprint: n, counts })
  }
  return rows
}
