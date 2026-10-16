// The FX-PORT data (fixtures.md) as Dexie rows for the Portfolio unit tests: labs pf-a (Proven, rung-3 hints, one passing run between a
// failing earlier and later one, two journal rows), pf-b (Proven, rung 1 and 2 only) and pf-c (not Proven: its latest review failed).
import type { DojoDB } from '../../src/data/db'
import type { JournalRow, LabResults, LabReviewRow, LabRunRow, Ticket } from '../../src/data/types'
import { mkLabRow } from './labRows'

export const at = (day: string, hm = '12:00'): number => new Date(`${day}T${hm}:00+05:30`).getTime()
const res = (...c: [string, 'pass' | 'fail', string][]): LabResults => ({
  checks: c.map(([name, status, detail], i) => ({ id: `c${i + 1}`, name, status, detail })),
  summary: { pass: c.filter(x => x[1] === 'pass').length, fail: c.filter(x => x[1] === 'fail').length, skip: 0 },
})
const run = (labId: string, when: number, exit: number, results: LabResults): LabRunRow => ({ id: `run-${labId}-${when}`, labId, at: when, ms: 1200, exit, timedOut: false, results, tail: '' })
const rev = (labId: string, n: number, when: number, scores: number[], stronger: string[], passed: boolean): LabReviewRow => ({
  id: `rev-${labId}-${n}`, labId, at: when,
  items: scores.map((score, i) => ({ id: `r${i + 1}`, score: score as 0 | 1 | 2 | 3, evidence: [{ quote: 'def solve', file: 'src/main.py', line: 1 }], stronger: stronger[i] })),
  percent: Math.floor((scores.reduce((a, b) => a + b, 0) / (3 * scores.length)) * 100), passed, summary: 'Fixture review.',
})
const tk = (id: string, title: string, labId: string): Ticket => ({
  id, origin: 'mine', track: 'ai', kind: 'build', title, links: [], estMin: 45, plannedSprint: 1, sprint: 1, status: 'done', lab: { id: labId, gpu: 'none' },
} as unknown as Ticket)
const jr = (day: string, ticketId: string, over: Partial<JournalRow> = {}): JournalRow => ({
  id: `journal-${day}`, day, at: at(day, '20:00'), mode: 'studied', items: [{ ticketId, rating: null, explain: null }], ...over,
})

export const WRITEUPS = {
  'pf-a': `# Portfolio fixture lab A\n\n## Problem\nFind the smallest number that passes the fixture check.\n\n## Approach\nStart with brute force, then use a closed form.\n\n## Results\nThe fixture check passes in 0.4 seconds.\n\n## What I would change\nAdd a larger input.\n`,
  'pf-b': `# Portfolio fixture lab B\n\n## Problem\nReport the largest value in a list.\n\n## Approach\nSingle pass with a running maximum.\n\n## Results\nEvery check in the fixture passed locally.\n\n## What I would change\nHandle empty lists.\n`,
} as const
export const TITLES = { 'pf-a': 'Portfolio fixture lab A', 'pf-b': 'Portfolio fixture lab B', 'pf-c': 'Portfolio fixture lab C' } as const
export const LAB_TICKETS = { 'pf-a': ['pf-a.1', 'pf-a.2'], 'pf-b': ['pf-b.1'], 'pf-c': ['pf-c.1'] } as const
export const USER = 'fixture-user'
export const REPO_URL = (labId: string): string => `https://github.com/${USER}/ai-platform-lab/tree/main/labs/${labId}`

export async function seedPort(d: DojoDB): Promise<void> {
  await d.tickets.bulkPut([
    tk('pf-a.1', 'Fixture A first step', 'pf-a'), tk('pf-a.2', 'Fixture A second step', 'pf-a'), tk('pf-b.1', 'Fixture B only step', 'pf-b'), tk('pf-c.1', 'Fixture C only step', 'pf-c'),
  ])
  const hints = (t: string, rungs: (1 | 2 | 3)[], day: string) => rungs.map(rung => ({ ticketId: t, rung, at: at(day) }))
  await d.labs.bulkPut([
    mkLabRow('pf-a', { hints: [...hints('pf-a.1', [1, 2, 3], '2026-11-01'), ...hints('pf-a.2', [1, 2, 3], '2026-11-02')] }),
    mkLabRow('pf-b', { hints: hints('pf-b.1', [1, 2], '2026-11-02') }),
    mkLabRow('pf-c'),
  ])
  await d.labRuns.bulkPut([
    run('pf-a', at('2026-11-01', '09:00'), 1, res(['Parses input', 'pass', '12 cases'], ['Finds the answer', 'fail', 'wrong answer'])),
    run('pf-a', at('2026-11-02', '11:30'), 0, res(['Parses input', 'pass', '12 cases'], ['Finds the answer', 'pass', '0.4 s'])),
    run('pf-a', at('2026-11-03', '08:00'), 1, res(['Parses input', 'pass', '12 cases'], ['Finds the answer', 'fail', 'timeout in case 7'])),
    run('pf-c', at('2026-11-01', '15:00'), 0, res(['Parses input', 'pass', '12 cases'])),
  ])
  const inv = 'State the invariant.'
  await d.labReviews.bulkPut([
    rev('pf-a', 1, at('2026-11-02', '12:00'), [2, 1, 1], [inv, inv, inv], false), rev('pf-a', 2, at('2026-11-03', '15:00'), [3, 3, 2], [inv, inv, inv], true),
    rev('pf-b', 1, at('2026-11-03', '10:00'), [3, 3, 3], ['Name the edge cases.', 'Name the edge cases.', ''], true),
    rev('pf-c', 1, at('2026-11-01', '17:00'), [3, 3, 2], [inv, inv, inv], true), rev('pf-c', 2, at('2026-11-03', '18:00'), [1, 1, 0], [inv, inv, inv], false),
  ])
  await d.journal.bulkPut([jr('2026-11-01', 'pf-a.1'), jr('2026-11-02', 'pf-a.2', { hardest: 'Closed form' })])
}

/** What POST /portfolio/export answers for a fixture lab (kind repo), as the server builds it. */
export function exportReply(labId: keyof typeof TITLES, over: Record<string, unknown> = {}): Record<string, unknown> {
  const files = [{ path: '.gitignore', bytes: 6 }, { path: 'Makefile', bytes: 20 }, { path: 'README.md', bytes: 100 }, { path: 'WRITEUP.md', bytes: 200 }, { path: 'src/main.py', bytes: 30 }, { path: 'tests/test_solve.py', bytes: 40 }]
  return {
    ok: true, title: TITLES[labId], repo: 'ai-platform-lab', tickets: [...LAB_TICKETS[labId]], files, publishFiles: ['README.md', ...files.map(f => `labs/${labId}/${f.path}`)],
    writeup: labId in WRITEUPS ? WRITEUPS[labId as 'pf-a' | 'pf-b'] : '', uncommitted: false, hits: [], urls: [REPO_URL(labId)], repoUrl: REPO_URL(labId),
    gh: { ok: true, user: USER }, ...over,
  }
}
