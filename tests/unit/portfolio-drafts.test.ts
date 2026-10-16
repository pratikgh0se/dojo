// R2 W6: the draft builders, against the exact texts of portfolio.md (Preconditions, "Drafts, exact text").
import { describe, expect, it } from 'vitest'
import type { JournalRow, LabResults } from '../../src/data/types'
import {
  helpLine, journalLines, parseWriteup, passingRun, repoReadme, rung3Tickets, sitePage, strongerLines, trimPost, withLead, LINKEDIN_MAX,
  type DraftRun,
} from '../../src/rules/portfolioDrafts'

const norm = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n').trimEnd()
const AT = new Date(2026, 10, 2, 11, 30).getTime() // 2026-11-02 11:30 local
const results = (...c: [string, 'pass' | 'fail' | 'skip', string][]): LabResults => ({
  checks: c.map(([name, status, detail], i) => ({ id: `c${i + 1}`, name, status, detail })),
  summary: { pass: c.filter(x => x[1] === 'pass').length, fail: c.filter(x => x[1] === 'fail').length, skip: 0 },
})
const RUN: DraftRun = { at: AT, results: results(['Parses input', 'pass', '12 cases'], ['Finds the answer', 'pass', '0.4 s']) }
const WRITEUP_A = `# Portfolio fixture lab A

## Problem
Find the smallest number that passes the fixture check.

## Approach
Start with brute force, then use a closed form.

## Results
The fixture check passes in 0.4 seconds.

## What I would change
Add a larger input.
`
const WRITEUP_B = `# Portfolio fixture lab B

## Problem
Report the largest value in a list.

## Approach
Single pass with a running maximum.

## Results
Every check in the fixture passed locally.

## What I would change
Handle empty lists.
`
const HELP_A = 'Built with reference hints on Fixture A first step, Fixture A second step.'
const CODE_A = 'https://github.com/fixture-user/ai-platform-lab/tree/main/labs/pf-a'

describe('parseWriteup', () => {
  it('splits at lines that start "## " and trims blank lines; a missing section is empty; "### " does not split', () => {
    expect(parseWriteup(WRITEUP_A)).toEqual({
      problem: 'Find the smallest number that passes the fixture check.', approach: 'Start with brute force, then use a closed form.',
      results: 'The fixture check passes in 0.4 seconds.', change: 'Add a larger input.',
    })
    expect(parseWriteup('## Problem\n\n\nP1\n### Detail\nP2\n\n## Other\nignored\n')).toEqual({ problem: 'P1\n### Detail\nP2', approach: '', results: '', change: '' })
    expect(parseWriteup('nothing here')).toEqual({ problem: '', approach: '', results: '', change: '' })
  })
})

describe('passingRun', () => {
  const fail: DraftRun = { at: AT + 1000, results: results(['Parses input', 'pass', '12 cases'], ['Finds the answer', 'fail', 'timeout in case 7']) }
  const earlier: DraftRun = { at: AT - 1000, results: results(['A', 'pass', 'x']) }
  it('is the latest run whose results are non-null, hold a check and have every check at pass', () => {
    expect(passingRun([earlier, RUN, fail])).toBe(RUN)
    expect(passingRun([fail])).toBeNull()
    expect(passingRun([{ at: AT, results: null }, { at: AT, results: { checks: [], summary: { pass: 0, fail: 0, skip: 0 } } }])).toBeNull()
    expect(passingRun([{ at: AT, results: results(['A', 'pass', 'x'], ['B', 'skip', 'y']) }])).toBeNull()
  })
})

describe('the hint line (with help)', () => {
  it('lists the titles of the tickets with a rung 3 in the order of the lab ticket list; rungs 1 and 2 never count', () => {
    const hints = [1, 2, 3].map(rung => ({ ticketId: 'pf-a.2', rung })).concat([1, 2, 3].map(rung => ({ ticketId: 'pf-a.1', rung })))
    expect(rung3Tickets(hints, ['pf-a.1', 'pf-a.2'])).toEqual(['pf-a.1', 'pf-a.2'])
    expect(rung3Tickets([{ ticketId: 'x', rung: 2 }], ['x'])).toEqual([])
    expect(rung3Tickets([{ ticketId: 'y', rung: 3 }, { ticketId: 'y', rung: 3 }], ['x'])).toEqual(['y'])
    expect(helpLine(['Fixture A first step', 'Fixture A second step'])).toBe(HELP_A)
    expect(helpLine([])).toBe('')
    expect(withLead('# T', HELP_A)).toBe(`${HELP_A}\n\n# T`)
    expect(withLead('# T', '')).toBe('# T')
  })
})

describe('repoReadme', () => {
  it('pf-a: hint line, sections, results table and date, how to run (PORT-06)', () => {
    expect(norm(repoReadme('Portfolio fixture lab A', WRITEUP_A, RUN, HELP_A))).toBe(norm(`${HELP_A}

# Portfolio fixture lab A

## Problem
Find the smallest number that passes the fixture check.

## Approach
Start with brute force, then use a closed form.

## Results
The fixture check passes in 0.4 seconds.

| Check | Result | Detail |
|---|---|---|
| Parses input | pass | 12 cases |
| Finds the answer | pass | 0.4 s |

Measured on 2026-11-02.

## What I would change
Add a larger input.

## How to run
\`make check\``))
  })
  it('pf-b: no hint line and no table or date line (PORT-07)', () => {
    expect(norm(repoReadme('Portfolio fixture lab B', WRITEUP_B, null, ''))).toBe(norm(`# Portfolio fixture lab B

## Problem
Report the largest value in a list.

## Approach
Single pass with a running maximum.

## Results
Every check in the fixture passed locally.

## What I would change
Handle empty lists.

## How to run
\`make check\``))
  })
  it('ends with one newline; a lab with a run but no Results text gets the table straight under the heading', () => {
    const md = repoReadme('T', '## Problem\nP\n', RUN, '')
    expect(md.endsWith('`make check`\n')).toBe(true)
    expect(md).toContain('## Results\n| Check | Result | Detail |')
  })
})

describe('sitePage', () => {
  it('pf-a: no article published (PORT-09)', () => {
    expect(norm(sitePage('Portfolio fixture lab A', WRITEUP_A, RUN, { repoUrl: CODE_A }, HELP_A))).toBe(norm(`${HELP_A}

# Portfolio fixture lab A

## Problem
Find the smallest number that passes the fixture check.

## Approach
Start with brute force, then use a closed form.

## Measured numbers

| Check | Result | Detail |
|---|---|---|
| Parses input | pass | 12 cases |
| Finds the answer | pass | 0.4 s |

Measured on 2026-11-02.

## Links
- Code: ${CODE_A}`))
  })
  it('a published article adds the Article line after Code; no run means no Measured numbers (PORT-39)', () => {
    const md = sitePage('Portfolio fixture lab B', WRITEUP_B, null, { repoUrl: 'R', articleUrl: 'A' }, '')
    expect(md.startsWith('# Portfolio fixture lab B')).toBe(true)
    expect(md).not.toContain('## Measured numbers')
    expect(md.endsWith('## Links\n- Code: R\n- Article: A\n')).toBe(true)
  })
})

describe('trimPost (the contract Trim rule)', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${String(i + 1).padStart(2, '0')} of the fake long LinkedIn post.`).join(' ')
  it('leaves a post of 1300 characters or fewer alone', () => { expect(trimPost('One. Two.')).toBe('One. Two.') })
  it('keeps the longest prefix of at most 1300 characters that ends at . ! or ?', () => {
    expect(long).toHaveLength(1759)
    const t = trimPost(long)
    expect(t).toHaveLength(1275)
    expect(t.endsWith('Sentence 29 of the fake long LinkedIn post.')).toBe(true)
    expect(trimPost(`${'a '.repeat(640)}really? ${'b'.repeat(400)}`).endsWith('really?')).toBe(true)
  })
  it('with no sentence end it keeps the first 1300 characters', () => { expect(trimPost('word '.repeat(400))).toBe('word '.repeat(400).slice(0, LINKEDIN_MAX)) })
})

describe('article inputs', () => {
  const row = (day: string, over: Partial<JournalRow>): JournalRow => ({ id: `journal-${day}`, day, at: 1, mode: 'studied', items: [{ ticketId: 't1', rating: null, explain: null }], ...over })
  it('journalLines: one per row that lists a lab ticket, oldest first, with the note when there is one (n counts rows)', () => {
    const rows = [
      row('2026-11-02', { hardest: 'Closed form' }), row('2026-11-01', {}),
      row('2026-11-04', { items: [{ ticketId: 'other', rating: null, explain: null }], line: 'Not this lab.' }),
    ]
    expect(journalLines(rows, new Set(['t1']))).toEqual(['2026-11-01', '2026-11-02: Closed form'])
    expect(journalLines([], new Set(['t1']))).toEqual([])
  })
  it('strongerLines keeps the non-blank texts (m)', () => {
    expect(strongerLines([{ stronger: 'Name the edge cases.' }, { stronger: '  ' }, {}, { stronger: 'x' }])).toEqual(['Name the edge cases.', 'x'])
  })
})
