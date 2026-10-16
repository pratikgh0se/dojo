import { describe, expect, it } from 'vitest'
import { allMilestonesPassed, DEFAULT_LABS_ROOT, isProven, labStatus, labsRootOf, latestResultsRun, latestReview, latestRun, milestonePassed, readRun } from '../../src/rules/lab'
import { mkLabRow, mkReview, mkRun } from '../helpers/labRows'

const M1 = { ticket: 'T1', checkIds: ['c1'] }
const M2 = { ticket: 'T2', checkIds: ['c2', 'c3'] }

describe('milestonePassed', () => {
  it('needs one stored run with every check of the milestone at pass', () => {
    expect(milestonePassed(M1, [])).toBe(false)
    expect(milestonePassed(M1, [mkRun('x', 1, { c1: 'fail' })])).toBe(false)
    expect(milestonePassed(M1, [mkRun('x', 1, { c1: 'skip' })])).toBe(false)
    expect(milestonePassed(M1, [mkRun('x', 1, { c1: 'pass' })])).toBe(true)
    expect(milestonePassed(M2, [mkRun('x', 1, { c2: 'pass', c3: 'fail' })])).toBe(false)
    expect(milestonePassed(M2, [mkRun('x', 1, { c2: 'pass' })])).toBe(false) // c3 absent
    expect(milestonePassed(M2, [mkRun('x', 1, { c2: 'pass', c3: 'pass' })])).toBe(true)
  })
  it('is monotonic: breaking the check later does not un-pass it, and checks may pass in different runs only if one run has all of them', () => {
    const runs = [mkRun('x', 1, { c1: 'pass' }), mkRun('x', 2, { c1: 'fail' })]
    expect(milestonePassed(M1, runs)).toBe(true)
    expect(milestonePassed(M2, [mkRun('x', 1, { c2: 'pass', c3: 'fail' }), mkRun('x', 2, { c2: 'fail', c3: 'pass' })])).toBe(false)
  })
  it('a run with no results (timeout, no_results) counts for nothing; a milestone with no checks is never passed', () => {
    expect(milestonePassed(M1, [mkRun('x', 1, {}, { results: null, timedOut: true, exit: null })])).toBe(false)
    expect(milestonePassed({ checkIds: [] }, [mkRun('x', 1, { c1: 'pass' })])).toBe(false)
  })
})

describe('allMilestonesPassed and labStatus', () => {
  const lab = mkLabRow('x')
  const ms = [M1, M2]
  const all = [mkRun('x', 1, { c1: 'pass', c2: 'pass', c3: 'pass' })]
  it('not_set_up without a labs row, whatever else exists', () => {
    expect(labStatus({ lab: undefined, milestones: ms, runs: all, reviews: [] })).toBe('not_set_up')
    expect(labStatus({ lab: null, milestones: ms, runs: [], reviews: [] })).toBe('not_set_up')
  })
  it('building until every milestone is passed, then ready', () => {
    expect(labStatus({ lab, milestones: ms, runs: [], reviews: [] })).toBe('building')
    expect(labStatus({ lab, milestones: ms, runs: [mkRun('x', 1, { c1: 'pass' })], reviews: [] })).toBe('building')
    expect(allMilestonesPassed(ms, all)).toBe(true)
    expect(labStatus({ lab, milestones: ms, runs: all, reviews: [] })).toBe('ready')
    expect(allMilestonesPassed([], all)).toBe(false)
  })
  it('proven when the NEWEST review passed; a later not-yet review takes it back', () => {
    const base = { lab, milestones: ms, runs: all }
    expect(labStatus({ ...base, reviews: [mkReview('x', 5, true)] })).toBe('proven')
    expect(labStatus({ ...base, reviews: [mkReview('x', 5, true), mkReview('x', 9, false)] })).toBe('ready')
    expect(labStatus({ ...base, reviews: [mkReview('x', 9, false), mkReview('x', 5, true)] })).toBe('ready')
    expect(isProven([mkReview('x', 1, false), mkReview('x', 2, true)])).toBe(true)
    expect(isProven([])).toBe(false)
  })
  it('latest helpers pick by at', () => {
    const a = mkRun('x', 1, { c1: 'pass' }), b = mkRun('x', 7, {}, { results: null }), c = mkRun('x', 3, { c1: 'fail' })
    expect(latestRun([a, b, c])).toBe(b)
    expect(latestResultsRun([a, b, c])).toBe(c)
    expect(latestResultsRun([b])).toBeUndefined()
    expect(latestReview([mkReview('x', 2, true), mkReview('x', 4, false)])?.at).toBe(4)
  })
  it('on equal at the greater id wins, whatever the list order (the one Proven rule)', () => {
    const a = mkReview('x', 5, true, { id: 'rev-x-5' }), b = mkReview('x', 5, false, { id: 'rev-x-5b' })
    expect(latestReview([a, b])).toBe(b)
    expect(latestReview([b, a])).toBe(b)
    expect(isProven([a, b])).toBe(false)
    expect(isProven([b, a])).toBe(false)
  })
})

describe('labsRootOf', () => {
  it('is the typed value, trimmed, else ~/labs', () => {
    expect(labsRootOf({})).toBe(DEFAULT_LABS_ROOT)
    expect(labsRootOf({ labsRoot: '  ' })).toBe('~/labs')
    expect(labsRootOf({ labsRoot: ' ~/my-labs ' })).toBe('~/my-labs')
    expect(labsRootOf(undefined)).toBe('~/labs')
  })
})

describe('readRun (the guard before a server reply is stored)', () => {
  const ok = { at: 5, ms: 9, exit: 0, timedOut: false, tail: 'out', results: { checks: [{ id: 'c1', name: 'One', status: 'pass', detail: 'ok' }], summary: { pass: 9, fail: 9, skip: 9 } } }
  it('keeps a good run and recomputes the summary', () => {
    expect(readRun(ok)).toEqual({ at: 5, ms: 9, exit: 0, timedOut: false, tail: 'out', results: { checks: [{ id: 'c1', name: 'One', status: 'pass', detail: 'ok' }], summary: { pass: 1, fail: 0, skip: 0 } } })
  })
  it('accepts a killed run (exit null, results null) and an error', () => {
    expect(readRun({ at: 1, ms: 2, exit: null, timedOut: true, results: null, tail: '' })).toMatchObject({ exit: null, timedOut: true, results: null })
    expect(readRun({ at: 1, ms: 2, exit: 2, timedOut: false, results: null, tail: 'x', error: 'no_results' })).toMatchObject({ error: 'no_results' })
  })
  it.each([
    ['not an object', 5], ['no tail', { ...ok, tail: undefined }], ['a string exit', { ...ok, exit: '0' }], ['an unknown error', { ...ok, error: 'weird' }],
    ['results without a summary', { ...ok, results: { checks: [] } }], ['a check with a bad status', { ...ok, results: { checks: [{ id: 'c', name: 'n', status: 'x', detail: '' }], summary: {} } }],
  ])('rejects %s', (_n, v) => { expect(readRun(v)).toBeNull() })
  it('keeps only the last 4000 characters of the tail', () => {
    expect(readRun({ ...ok, tail: 'a'.repeat(5000) + 'END' })!.tail).toHaveLength(4000)
  })
})
