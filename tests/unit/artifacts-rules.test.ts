// app/tests/unit/artifacts-rules.test.ts
import { describe, expect, it } from 'vitest'
import type { Measure } from '../../src/data/types'
import {
  applyForm, boardColumns, FIELD_ERRORS, formOf, GATE_MESSAGES, gateFailure, isDone, isWriteupLink, latestMeasure,
  moveBlocked, newArtifact, rungMeasured, seedArtifacts, stepTarget, validateForm, withStatus,
  type ArtifactForm, type ArtifactRecord, type FormField,
} from '../../src/rules/artifacts'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T0 = ist('2026-10-14T10:00:00')
const REPO = 'https://github.com/example-user/forge'
const m = (name: string, value: number, at = T0): Measure => ({ name, value, unit: '', at, sprint: 1 })
const form = (p: Partial<ArtifactForm> = {}): ArtifactForm => ({ ...formOf(null), title: 'micrograd engine', stage: 1, ...p })
const A = (p: Partial<ArtifactRecord> = {}): ArtifactRecord => ({ ...newArtifact('art-a', form(), T0), ...p })

describe('seedArtifacts (C-PROJECTS §2.4 Seed)', () => {
  it('seeds art-stage-00…11, titled per §0, not started, with no evidence', () => {
    const s = seedArtifacts(T0)
    expect(s.map(a => a.id)).toEqual(Array.from({ length: 12 }, (_, i) => `art-stage-${String(i).padStart(2, '0')}`))
    expect(s[0].title).toBe('Stage 00 · Setup + math by picture')
    expect(s[4].title).toBe('Stage 04 · Tokenizer (BPE)')
    expect(s[11].title).toBe('Stage 11 · Research')
    expect(s.every(a => a.status === 'not started' && a.measures.length === 0 && !a.repo && !a.commit && !a.userAdded)).toBe(true)
    expect(s[1]).toMatchObject({ stage: 1, block: 1, statusAt: { 'not started': T0 }, statusLog: [{ status: 'not started', at: T0 }], createdAt: T0 })
    expect(s[11].block).toBe(15)
  })
})

describe('validateForm (C-PROJECTS §2.5)', () => {
  const cases: [Partial<ArtifactForm>, FormField, string][] = [
    [{ title: '' }, 'title', 'Title is required.'],
    [{ title: '   ' }, 'title', 'Title is required.'],
    [{ title: 'x'.repeat(81) }, 'title', FIELD_ERRORS.titleLong],
    [{ repo: 'github.com/x' }, 'repo', 'Enter an http(s) URL.'],
    [{ repo: 'ftp://x.y/z' }, 'repo', 'Enter an http(s) URL.'],
    [{ commit: 'xyz123' }, 'commit', 'A commit is 7–40 hex characters.'],
    [{ commit: 'a1b2c3' }, 'commit', 'A commit is 7–40 hex characters.'],
    [{ commit: 'a'.repeat(41) }, 'commit', 'A commit is 7–40 hex characters.'],
    [{ writeup: 'notes/foo.txt' }, 'writeup', 'Use an obsidian:// link, a URL, or a .md path.'],
    [{ writeup: '/abs/notes.md' }, 'writeup', 'Use an obsidian:// link, a URL, or a .md path.'],
  ]
  it.each(cases)('%o gives the %s error', (p, field, msg) => {
    expect(validateForm(form(p))[field]).toBe(msg)
  })

  it('accepts valid values and blank optional fields', () => {
    expect(validateForm(form())).toEqual({})
    expect(validateForm(form({ title: 'x'.repeat(80), repo: REPO, commit: 'A1B2C3D', writeup: 'forge/micrograd.md' }))).toEqual({})
    expect(validateForm(form({ commit: 'b4c5d6e7', writeup: 'obsidian://open?vault=notes&file=forge%2Fmicrograd' }))).toEqual({})
    expect(isWriteupLink('https://example.com/post')).toBe(true)
    expect(isWriteupLink('C:/notes/x.md')).toBe(false)
  })
})

describe('evidence gates (C-PROJECTS §2.4)', () => {
  const none = { measures: [] as Measure[] }
  const committed = { repo: REPO, commit: 'a1b2c3d', measures: [] as Measure[] }

  it('building needs nothing', () => {
    expect(gateFailure(none, 'building')).toBeNull()
  })

  it('runs needs a repo URL and a valid commit', () => {
    expect(gateFailure(none, 'runs')).toBe('Runs needs a repo URL and a commit.')
    expect(gateFailure({ ...none, repo: REPO }, 'runs')).toBe(GATE_MESSAGES.runs)
    expect(gateFailure({ ...none, commit: 'a1b2c3d' }, 'runs')).toBe(GATE_MESSAGES.runs)
    expect(gateFailure({ ...committed, commit: 'xyz' }, 'runs')).toBe(GATE_MESSAGES.runs)
    expect(gateFailure(committed, 'runs')).toBeNull()
  })

  it('checks every gate up to the target and reports the first failure', () => {
    expect(gateFailure(none, 'written up')).toBe(GATE_MESSAGES.runs)
    expect(gateFailure(committed, 'written up')).toBe('Measured needs at least one measure.')
    expect(gateFailure({ ...committed, measures: [m('loss', 2.5)] }, 'written up')).toBe('Written up needs a write-up link.')
    expect(gateFailure({ ...committed, measures: [m('loss', 2.5)] }, 'measured')).toBeNull()
  })

  it('never blocks a backward or same-status move', () => {
    expect(moveBlocked(none, 'runs', 'not started')).toBeNull()
    expect(moveBlocked(none, 'measured', 'measured')).toBeNull()
    expect(moveBlocked(none, 'not started', 'runs')).toBe(GATE_MESSAGES.runs)
  })

  it('steps one column and stops at both ends', () => {
    expect(stepTarget('not started', 1)).toBe('building')
    expect(stepTarget('measured', 1)).toBe('written up')
    expect(stepTarget('written up', 1)).toBeNull()
    expect(stepTarget('not started', -1)).toBeNull()
    expect(stepTarget('runs', -1)).toBe('building')
  })
})

describe('status history and edits', () => {
  it('stamps statusAt and appends to statusLog; a same-status move returns the same row', () => {
    const b = withStatus(A(), 'building', T0 + 1)
    expect(b.statusAt).toEqual({ 'not started': T0, building: T0 + 1 })
    expect(b.statusLog).toEqual([{ status: 'not started', at: T0 }, { status: 'building', at: T0 + 1 }])
    expect(withStatus(b, 'building', T0 + 2)).toBe(b)
  })

  it('synthesises a log from statusAt for a row that has none', () => {
    const a: ArtifactRecord = { ...A(), statusLog: undefined, statusAt: { runs: T0 + 5, 'not started': T0 } }
    expect(withStatus(a, 'measured', T0 + 9).statusLog).toEqual([
      { status: 'not started', at: T0 }, { status: 'runs', at: T0 + 5 }, { status: 'measured', at: T0 + 9 },
    ])
  })

  it('trims fields, drops blank optional fields, and keeps stage and block in sync', () => {
    const a = applyForm(A({ note: 'old' }), form({ title: '  value class ', stage: 3, note: '  ', repo: ` ${REPO} ` }), T0)
    expect(a).toMatchObject({ title: 'value class', stage: 3, block: 3, repo: REPO })
    expect('note' in a).toBe(false)
  })

  it('clears commitFound when the commit or repo changes, keeps the grade (Review Focus #1)', () => {
    const graded = A({ repo: REPO, commit: 'a1b2c3d', commitFound: true, grade: 4 })
    expect(applyForm(graded, form({ repo: REPO, commit: 'A1B2C3D' }), T0).commitFound).toBe(true)
    const changed = applyForm(graded, form({ repo: REPO, commit: 'b4c5d6e7' }), T0)
    expect(changed.commitFound).toBeUndefined()
    expect(changed.grade).toBe(4)
    expect(isDone(changed)).toBe(false)
    expect(applyForm(graded, form({ repo: 'https://github.com/x/other', commit: 'a1b2c3d' }), T0).commitFound).toBeUndefined()
  })

  it('a new artifact is user-added and starts its log at its chosen status', () => {
    const a = newArtifact('art-x', form({ status: 'building' }), T0)
    expect(a).toMatchObject({ id: 'art-x', userAdded: true, status: 'building', createdAt: T0, statusLog: [{ status: 'building', at: T0 }] })
  })
})

describe('board order, chips and badges', () => {
  it('orders a column by stage, then creation time', () => {
    const seeds = seedArtifacts(T0)
    const user = newArtifact('art-user', form({ title: 'micrograd engine', stage: 1 }), T0 + 1000)
    const col = boardColumns([user, ...seeds])['not started'].map(a => a.title)
    expect(col.slice(0, 4)).toEqual(['Stage 00 · Setup + math by picture', 'Stage 01 · micrograd', 'micrograd engine', 'Stage 02 · makemore'])
    expect(boardColumns(seeds).building).toEqual([])
  })

  it('a same-instant tie (frozen clock: seed and add at the same nowMs) still keeps the seed first (scenario 4)', () => {
    const seeds = seedArtifacts(T0)
    const user = newArtifact('art-mv7m2mo0-nvijvw', form({ title: 'micrograd engine', stage: 1 }), T0)
    const col = boardColumns([...seeds, user])['not started'].map(a => a.title)
    expect(col.slice(0, 4)).toEqual(['Stage 00 · Setup + math by picture', 'Stage 01 · micrograd', 'micrograd engine', 'Stage 02 · makemore'])
  })

  it('the chip is the latest-added measure', () => {
    expect(latestMeasure(A())).toBeNull()
    expect(latestMeasure(A({ measures: [m('loss', 1.98), m('eval score', 0.82), m('loss', 1.41, T0 - 5)] }))).toMatchObject({ name: 'loss', value: 1.41 })
  })

  it('Done = valid repo + valid commit + commitFound + stored grade ≥ 3, whatever the status', () => {
    const base = A({ repo: REPO, commit: 'c0ffee1', commitFound: true, grade: 4 })
    expect(isDone(base)).toBe(true)
    expect(isDone({ ...base, status: 'runs' })).toBe(true)
    expect(isDone({ ...base, grade: 3 })).toBe(true)
    expect(isDone({ ...base, grade: 2 })).toBe(false)
    expect(isDone({ ...base, commitFound: false })).toBe(false)
    expect(isDone({ ...base, commitFound: undefined })).toBe(false)
    expect(isDone({ ...base, repo: undefined })).toBe(false)
    expect(isDone({ ...base, grade: undefined })).toBe(false)
  })

  it('the rung cube follows only the seeded artifact of the stage (C-PROJECTS §2.7)', () => {
    const seeds = seedArtifacts(T0)
    const user = { ...newArtifact('art-u', form({ stage: 0 }), T0), status: 'measured' as const }
    expect(rungMeasured([...seeds, user], 0)).toBe(false)
    expect(rungMeasured([{ ...seeds[0], status: 'measured' }], 0)).toBe(true)
    expect(rungMeasured([{ ...seeds[0], status: 'written up' }], 0)).toBe(true)
    expect(rungMeasured([{ ...seeds[0], status: 'runs' }], 0)).toBe(false)
  })
})
