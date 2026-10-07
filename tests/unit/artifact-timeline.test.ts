// app/tests/unit/artifact-timeline.test.ts
import { describe, expect, it } from 'vitest'
import { formOf, newArtifact, seedArtifacts, withStatus, type ArtifactRecord } from '../../src/rules/artifacts'
import { statusAtTime, timelineRows } from '../../src/rules/artifactTimeline'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const OCT14 = ist('2026-10-14T10:00:00')
const OCT20 = ist('2026-10-20T10:00:00')
const START = '2026-10-05'
const user = (at: number): ArtifactRecord => newArtifact('art-a', { ...formOf(null), title: 'micrograd engine', stage: 1 }, at)
const measured = (a: ArtifactRecord, at: number) =>
  withStatus(withStatus(withStatus(a, 'building', at), 'runs', at), 'measured', at)
const counts = (r: { counts: Record<string, number> }) => r.counts

describe('timelineRows (C-PROJECTS §2.9)', () => {
  it('has no rows before the start date or without one', () => {
    expect(timelineRows(seedArtifacts(OCT14), START, ist('2026-10-01T10:00:00'))).toEqual([])
    expect(timelineRows(seedArtifacts(OCT14), '', OCT14)).toEqual([])
  })

  it('fresh profile in S1: one row, 12 not started', () => {
    const rows = timelineRows(seedArtifacts(OCT14), START, OCT14)
    expect(rows.map(r => r.sprint)).toEqual([1])
    expect(counts(rows[0])).toEqual({ 'not started': 12, building: 0, runs: 0, measured: 0, 'written up': 0 })
  })

  it('an artifact measured in S1 counts as Measured at the end of S1 and now (scenario 18)', () => {
    const a = measured(user(OCT14), OCT14)
    const rows = timelineRows([a, ...seedArtifacts(OCT14)], START, OCT20)
    expect(rows.map(r => r.sprint)).toEqual([1, 2])
    expect(rows.map(r => r.counts.measured)).toEqual([1, 1])
    expect(rows.map(r => r.counts.runs)).toEqual([0, 0])
    expect(rows[0].counts['not started']).toBe(12)
  })

  it('a user artifact created in S2 does not exist in S1', () => {
    const rows = timelineRows([user(ist('2026-10-20T09:00:00')), ...seedArtifacts(OCT14)], START, OCT20)
    expect(rows.map(r => r.counts['not started'])).toEqual([12, 13])
  })

  it('a backward move in S2 leaves the S1 column as it was', () => {
    const a = withStatus(measured(user(OCT14), OCT14), 'building', ist('2026-10-20T09:30:00'))
    const rows = timelineRows([a], START, OCT20)
    expect(rows[0].counts.measured).toBe(1)
    expect(rows[1].counts.building).toBe(1)
    expect(rows[1].counts.measured).toBe(0)
  })

  it('seeded artifacts count as not started from S1 even when seeded later', () => {
    const rows = timelineRows(seedArtifacts(ist('2026-11-05T10:00:00')), START, ist('2026-11-05T10:00:00'))
    expect(rows.map(r => r.counts['not started'])).toEqual([12, 12, 12])
  })

  it('stops at the last sprint after the plan ends', () => {
    expect(timelineRows(seedArtifacts(OCT14), START, ist('2029-12-01T10:00:00'))).toHaveLength(72)
  })

  it('statusAtTime uses the last log entry at or before t, even with equal timestamps', () => {
    const a = measured(user(OCT14), OCT14)
    expect(statusAtTime(a, OCT14)).toBe('measured')
    expect(statusAtTime(a, OCT14 - 1)).toBeNull()
    expect(statusAtTime(seedArtifacts(OCT14)[0], OCT14 - 1)).toBe('not started')
  })
})
