// app/tests/unit/stage-cubes.test.ts
import { describe, expect, it } from 'vitest'
import type { BlankTest, StageSession, Ticket } from '../../src/data/types'
import { fmtDayMonYear } from '../../src/lib/fmtDate'
import { formOf, newArtifact, seedArtifacts, type ArtifactRecord } from '../../src/rules/artifacts'
import {
  allStageCubes, blankMinutes, blankRedoDue, countdown, cubeName, evidenceCounts, latestBlankTest, learnBoard,
  learnColumn, stageCubes,
} from '../../src/rules/stageCubes'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const OCT14 = ist('2026-10-14T10:00:00')
const st = (stage: number, session: StageSession, sprint: number, done = false, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id: `s${stage}-${sprint}-${session}`, kind: 'stage', stage, session, plannedSprint: sprint, sprint, status: done ? 'done' : 'todo', ...extra })
const stage0 = (done: Partial<Record<StageSession, boolean>> = {}): Ticket[] =>
  (['watch', 'rebuild', 'build', 'teachback'] as StageSession[]).map(k => st(0, k, 1, !!done[k]))
const seeds = () => seedArtifacts(OCT14)
const withSeed0 = (p: Partial<ArtifactRecord>) => seeds().map(a => (a.stage === 0 ? { ...a, ...p } : a))
const blank = (stage: number, outcome: BlankTest['outcome'], at = OCT14, id = `b-${stage}-${at}`): BlankTest =>
  ({ id, stage, piece: 'forward pass by hand', at, minutes: 25, outcome })

describe('stageCubes (C-PROJECTS §2.2)', () => {
  it('fresh: all three empty with totals from the stage tickets', () => {
    const c = stageCubes(0, stage0(), seeds(), [])
    expect([c.learn.state, c.build.state, c.prove.state]).toEqual(['empty', 'empty', 'empty'])
    expect(cubeName(0, c.learn)).toBe('Stage 00 learn: empty (0/1)')
    expect(c.complete).toBe(false)
  })

  it('learn: full when every watch ticket is done, partial in between; archived tickets do not count', () => {
    expect(stageCubes(0, stage0({ watch: true }), seeds(), []).learn.state).toBe('full')
    expect(cubeName(0, stageCubes(0, stage0({ watch: true }), seeds(), []).learn)).toBe('Stage 00 learn: full (1/1)')
    const s1 = [st(1, 'watch', 2, true), st(1, 'watch', 3), st(1, 'watch', 4), st(1, 'watch', 5, true, { archived: true })]
    const c = stageCubes(1, s1, seeds(), [])
    expect(c.learn).toMatchObject({ state: 'partial', done: 1, total: 3 })
    expect(cubeName(1, c.learn)).toBe('Stage 01 learn: partial (1/3)')
  })

  it('rebuild fills nothing', () => {
    const c = stageCubes(0, stage0({ rebuild: true }), seeds(), [])
    expect([c.learn.state, c.build.state, c.prove.state]).toEqual(['empty', 'empty', 'empty'])
  })

  it('build: ticked without a commit is partial and says so; a commit on an artifact of the stage makes it full', () => {
    const ticked = stageCubes(0, stage0({ watch: true, build: true }), seeds(), [])
    expect(ticked.build.state).toBe('partial')
    expect(cubeName(0, ticked.build)).toBe('Stage 00 build: partial (1/1) — needs a commit')
    const full = stageCubes(0, stage0({ watch: true, build: true }), withSeed0({ repo: 'https://github.com/example-user/forge', commit: 'c0ffee1' }), [])
    expect(full.build.state).toBe('full')
    expect(cubeName(0, full.build)).toBe('Stage 00 build: full (1/1)')
    expect(stageCubes(0, stage0(), withSeed0({ commit: 'c0ffee1' }), []).build.state).toBe('partial')
    expect(stageCubes(0, stage0({ build: true }), withSeed0({ commit: 'nothex!' }), []).build.needs).toBe('— needs a commit')
    expect(stageCubes(1, [st(1, 'build', 2, true)], withSeed0({ commit: 'c0ffee1' }), []).build.state).toBe('partial')
  })

  it('prove: a passing grade or a solved blank test is the proof part; a low grade or a not-yet test is not', () => {
    const t = stage0({ teachback: true })
    expect(cubeName(0, stageCubes(0, t, seeds(), []).prove)).toBe('Stage 00 prove: partial (1/1) — needs a grade or blank test')
    expect(stageCubes(0, t, withSeed0({ grade: 4 }), []).prove.state).toBe('full')
    expect(stageCubes(0, t, withSeed0({ grade: 2 }), []).prove.state).toBe('partial')
    expect(stageCubes(0, t, seeds(), [blank(0, 'solved')]).prove.state).toBe('full')
    expect(stageCubes(0, t, seeds(), [blank(0, 'not_yet')]).prove.state).toBe('partial')
    expect(stageCubes(0, stage0(), seeds(), [blank(0, 'solved')]).prove.state).toBe('partial')
    expect(stageCubes(0, stage0(), seeds(), [blank(1, 'solved')]).prove.state).toBe('empty')
  })

  it('a user-added artifact of the stage counts for build and prove', () => {
    const user = { ...newArtifact('art-u', { ...formOf(null), title: 'u', stage: 0 }, OCT14), commit: 'c0ffee1', grade: 3 }
    const c = stageCubes(0, stage0({ watch: true, build: true, teachback: true }), [...seeds(), user], [])
    expect(c.complete).toBe(true)
  })

  it('allStageCubes returns 12 stages in order', () => {
    expect(allStageCubes([], seeds(), []).map(c => c.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})

describe('Learn board and evidence', () => {
  it('column = consecutive full cubes from Learn; Prove without Build stays Watched', () => {
    const base = stageCubes(0, stage0(), seeds(), [])
    const full = { ...base.learn, state: 'full' as const }
    expect(learnColumn(base)).toBe('queued')
    expect(learnColumn({ ...base, learn: full })).toBe('watched')
    expect(learnColumn({ ...base, learn: full, build: { ...base.build, state: 'full' } })).toBe('built')
    expect(learnColumn({ ...base, learn: full, build: { ...base.build, state: 'full' }, prove: { ...base.prove, state: 'full' } })).toBe('proven')
    expect(learnColumn({ ...base, learn: full, prove: { ...base.prove, state: 'full' } })).toBe('watched')
    const board = learnBoard(allStageCubes([], seeds(), []))
    expect(board.queued).toHaveLength(12)
    expect(board.watched).toEqual([])
  })

  it('counts stages at 3 cubes, artifacts measured or written up of all, and solved blank tests', () => {
    const arts = [...withSeed0({ status: 'measured' }), { ...newArtifact('art-u', { ...formOf(null), title: 'u', stage: 1 }, OCT14), status: 'written up' as const }]
    const cubes = allStageCubes(stage0({ watch: true, build: true, teachback: true }), withSeed0({ commit: 'c0ffee1', grade: 4 }), [])
    expect(evidenceCounts(cubes, arts, [blank(0, 'solved'), blank(1, 'not_yet'), blank(2, 'solved', OCT14 + 1)]))
      .toEqual({ stages: 1, measured: 2, artifacts: 13, blank: 2 })
  })
})

describe('blank test helpers (C-PROJECTS §2.8)', () => {
  it('redo is due 10 days after the test', () => {
    expect(fmtDayMonYear(blankRedoDue(blank(1, 'not_yet')))).toBe('24 Oct 2026')
  })

  it('latest test per stage wins', () => {
    const tests = [blank(1, 'not_yet', OCT14), blank(1, 'solved', OCT14 + 60_000), blank(2, 'not_yet', OCT14 + 5)]
    expect(latestBlankTest(tests, 1)?.outcome).toBe('solved')
    expect(latestBlankTest(tests, 3)).toBeNull()
  })

  it('counts down 25:00 in mm:ss and ends at Time\'s up', () => {
    expect(countdown(OCT14, OCT14)).toEqual({ text: '25:00', over: false })
    expect(countdown(OCT14, OCT14 + 60_000)).toEqual({ text: '24:00', over: false })
    expect(countdown(OCT14, OCT14 + 61_500)).toEqual({ text: '23:59', over: false })
    expect(countdown(OCT14, OCT14 + 25 * 60_000)).toEqual({ text: '00:00', over: true })
    expect(countdown(OCT14, OCT14 + 99 * 60_000).over).toBe(true)
    expect(blankMinutes(OCT14, OCT14 + 61_000)).toBe(1)
    expect(blankMinutes(OCT14, OCT14 + 90 * 60_000)).toBe(25)
  })
})
