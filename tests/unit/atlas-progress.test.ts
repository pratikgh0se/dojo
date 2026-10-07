import { describe, expect, it, vi } from 'vitest'
import { recordPredict, recordSeen, setSessionApproach } from '../../src/data/atlasActions'
import { closeSession } from '../../src/data/sessionActions'
import type { AtlasRun } from '../../src/data/types'
import { atlasSummary, bestPredict, patternStates, walkStates } from '../../src/rules/atlasProgress'
import { freshDb, seededDb } from '../helpers/db'

const seen = (key: string): AtlasRun => ({ key, kind: 'seen', at: 1 })
const run = (key: string, asked: number, correct: number): AtlasRun => ({ key, kind: 'predict', at: 2, asked, correct })

describe('Atlas progress (labs contract §4.3, §4.4, §5.1)', () => {
  it('starts grey everywhere', () => {
    const s = patternStates([])
    expect(Object.keys(s)).toHaveLength(36)
    expect(new Set(Object.values(s))).toEqual(new Set(['none']))
    expect(atlasSummary(s).text).toBe('16 atoms · 36 patterns · you have predicted 0')
  })

  it('credits every row that lists a walkthrough: seen blue, passed green (D-4, D-17)', () => {
    const s = patternStates([seen('mergeSort'), run('binarySearch', 4, 4)])
    expect([s.sorting, s['divide-conquer'], s['binary-search']]).toEqual(['seen', 'seen', 'predicted'])
    expect(atlasSummary(s).predicted).toBe(1)
  })

  it('a failed run only counts as seen, and never downgrades a pass', () => {
    expect(walkStates([run('binarySearch', 4, 3)]).binarySearch).toBe('seen')
    expect(walkStates([run('binarySearch', 4, 4), run('binarySearch', 4, 0)]).binarySearch).toBe('predicted')
    expect(bestPredict([run('binarySearch', 4, 3), run('binarySearch', 4, 4), run('binarySearch', 4, 0)], 'binarySearch')).toEqual({ correct: 4, asked: 4 })
  })

  it('stores one seen row per walkthrough and every finished predict run', async () => {
    const d = freshDb()
    await recordSeen(d, 'bfs', 10)
    await recordSeen(d, 'bfs', 20)
    await recordPredict(d, 'bfs', 3, 3, 30)
    expect((await d.atlasRuns.toArray()).map(({ seq: _s, ...r }) => r)).toEqual([
      { key: 'bfs', kind: 'seen', at: 10 },
      { key: 'bfs', kind: 'predict', at: 30, asked: 3, correct: 3 },
    ])
  })

  it('stores and replaces the approach on a solved session, never on a give-up (§7.3)', async () => {
    const d = await seededDb()
    const solved = await closeSession(d, 'p127', 'solved', { sessionStart: 1, now: 60_001 })
    if (!solved.ok) throw new Error(solved.message)
    await setSessionApproach(d, solved.session.id, 'bfs')
    await setSessionApproach(d, solved.session.id, 'other')
    expect((await d.sessions.get(solved.session.id))?.approach).toBe('other')
    const gave = await closeSession(d, 'p127', 'gave_up', { sessionStart: 2, now: 60_002 })
    if (!gave.ok) throw new Error(gave.message)
    await setSessionApproach(d, gave.session.id, 'bfs')
    expect((await d.sessions.get(gave.session.id))?.approach).toBeUndefined()
  })

  it('writes the approach with a targeted update, not a read-then-put of the whole row (§7.3)', async () => {
    const d = await seededDb()
    const solved = await closeSession(d, 'p127', 'solved', { sessionStart: 1, now: 60_001 })
    if (!solved.ok) throw new Error(solved.message)
    const put = vi.spyOn(d.sessions, 'put')
    const update = vi.spyOn(d.sessions, 'update')
    await setSessionApproach(d, solved.session.id, 'bfs')
    expect(update).toHaveBeenCalledWith(solved.session.id, { approach: 'bfs' })
    expect(put).not.toHaveBeenCalled()
  })
})
