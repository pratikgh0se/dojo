// Row builders for the lab rule and action tests.
import type { LabCheckStatus, LabReviewRow, LabRow, LabRunRow } from '../../src/data/types'

/** A run row whose checks have the given statuses, e.g. mkRun('t-lab', 10, { c1: 'pass', c2: 'fail' }). */
export function mkRun(labId: string, at: number, checks: Record<string, LabCheckStatus>, over: Partial<LabRunRow> = {}): LabRunRow {
  const list = Object.entries(checks).map(([id, status]) => ({ id, name: id.toUpperCase(), status, detail: '' }))
  const n = (s: string) => list.filter(c => c.status === s).length
  return { id: `run-${labId}-${at}`, labId, at, ms: 10, exit: 0, timedOut: false, results: { checks: list, summary: { pass: n('pass'), fail: n('fail'), skip: n('skip') } }, tail: '', ...over }
}
export function mkReview(labId: string, at: number, passed: boolean, over: Partial<LabReviewRow> = {}): LabReviewRow {
  return { id: `rev-${labId}-${at}`, labId, at, items: [], percent: passed ? 83 : 25, passed, summary: 's', ...over }
}
export function mkLabRow(labId: string, over: Partial<LabRow> = {}): LabRow {
  return { labId, repo: 'ai-platform-lab', path: `labs/${labId}`, root: '~/labs', baseCommit: 'a'.repeat(40), version: 1, setupAt: 1, hints: [], ...over }
}
