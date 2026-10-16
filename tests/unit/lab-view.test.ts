import { describe, expect, it } from 'vitest'
import { labErrorText, labFolder, labIdsOf, runProblem, splitChecks, STATUS_WORD, summaryLine } from '../../src/rules/labView'
import { mkLabRow, mkRun } from '../helpers/labRows'

const checks = [
  { id: 'a', name: 'A', status: 'pass' as const, detail: '' }, { id: 'b', name: 'B', status: 'fail' as const, detail: 'x' },
  { id: 'c', name: 'C', status: 'skip' as const, detail: '' },
]

describe('splitChecks', () => {
  it('puts the ticket checks first in milestone order and the rest under later', () => {
    expect(splitChecks(checks, ['b', 'a'])).toEqual({ own: [checks[1], checks[0]], later: [checks[2]] })
  })
  it('ignores milestone ids the run does not have', () => {
    expect(splitChecks(checks, ['zzz'])).toEqual({ own: [], later: checks })
  })
})

describe('summaryLine and status words', () => {
  it('counts every check of the run', () => {
    expect(summaryLine({ pass: 0, fail: 3, skip: 0 })).toBe('0 passed, 3 failed, 0 skipped')
    expect(summaryLine({ pass: 3, fail: 0, skip: 0 })).toBe('3 passed, 0 failed, 0 skipped')
  })
  it('has a word for every status', () => { expect(STATUS_WORD).toEqual({ pass: 'Pass', fail: 'Fail', skip: 'Skip' }) })
})

describe('runProblem', () => {
  it('says a stopped run with the lab timeout in seconds', () => {
    expect(runProblem(mkRun('l', 1, {}, { timedOut: true, results: null }), 3)).toBe('Checks took longer than 3 seconds and were stopped.')
  })
  it('says a missing or unreadable results file', () => {
    expect(runProblem(mkRun('l', 1, {}, { error: 'no_results', results: null }), 3)).toBe('The checks did not write a results file. Here is what they printed.')
    expect(runProblem(mkRun('l', 1, {}, { error: 'bad_results', results: null }), 3)).toBe('The results file could not be read. Here is what the checks printed.')
  })
  it('is null for a run that produced results, and for no run', () => {
    expect(runProblem(mkRun('l', 1, { a: 'pass' }), 3)).toBeNull()
    expect(runProblem(undefined, 3)).toBeNull()
  })
})

describe('labErrorText', () => {
  it('writes the contract line per known code', () => {
    expect(labErrorText('bad_root')).toBe('The labs folder must be inside your home folder, and not the home folder itself.')
    expect(labErrorText('unknown_lab')).toBe('This lab is not available in this copy of Dojo.')
    expect(labErrorText('busy')).toBe('The checks are already running. Wait for them to finish.')
    expect(labErrorText('not_set_up')).toBe('The lab folder was not found. Set up the lab again to create it.')
    expect(labErrorText('make_missing')).toBe('make was not found. Install the Xcode command line tools with xcode-select --install, then try again.')
    expect(labErrorText('lab_dirty')).toBe('Commit your work in the lab folder first, then request the review.')
    expect(labErrorText('invalid_output')).toBe('The review did not come through in a form Dojo can read. Nothing is lost: Retry asks again.')
  })
  it('passes an unknown code through with its message, or a plain fallback', () => {
    expect(labErrorText('weird', 'The helper is busy.')).toBe('The helper is busy.')
    expect(labErrorText('weird')).toBe('That did not work. Try again.')
  })
})

describe('labIdsOf', () => {
  it('lists the distinct lab ids of live tickets, sorted', () => {
    const t = (id: string | null, archived = false) => ({ lab: id ? { id } : undefined, archived })
    expect(labIdsOf([t('u1'), t('b1-tokensim'), t('u1'), t(null), t('gone', true)])).toEqual(['b1-tokensim', 'u1'])
  })
})

describe('labFolder', () => {
  it('expands a leading ~ with the home folder and joins without doubled slashes', () => {
    expect(labFolder(mkLabRow('t-lab', { root: '~/labs' }), '/Users/t')).toBe('/Users/t/labs/ai-platform-lab/labs/t-lab')
    expect(labFolder(mkLabRow('t-lab', { root: '~/my-labs/' }), '/Users/t/')).toBe('/Users/t/my-labs/ai-platform-lab/labs/t-lab')
  })
  it('keeps an absolute root, and keeps the ~ when the home is not known', () => {
    expect(labFolder(mkLabRow('t-lab', { root: '/Users/t/labs' }), '/x')).toBe('/Users/t/labs/ai-platform-lab/labs/t-lab')
    expect(labFolder(mkLabRow('t-lab', { root: '~/labs' }), undefined)).toBe('~/labs/ai-platform-lab/labs/t-lab')
  })
})
