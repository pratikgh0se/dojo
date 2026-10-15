import type { DojoDB } from './db'
import { isRedoDue } from '../rules/redoQueue'
import { gradeRedo, type Grade } from '../rules/reviewQueue'

/** Apply a grade to one open redo. False when the redo is gone, closed, or not due right now (a second tab or a stale card cannot advance it twice). */
export async function applyGrade(d: DojoDB, redoId: string, grade: Grade, nowMs: number): Promise<boolean> {
  return d.transaction('rw', d.redos, async () => {
    const r = await d.redos.get(redoId)
    if (!r || r.closedAt !== undefined || !isRedoDue(r, nowMs)) return false
    await d.redos.put(gradeRedo(r, grade, nowMs))
    return true
  })
}
