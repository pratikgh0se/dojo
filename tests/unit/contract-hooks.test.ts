// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ATTRIBUTES, attributeBound, attributePairsOf, attributesOf, expandAlternatives, FORBIDDEN, forbiddenPresent, hookEntries, hookPresent, hooksOf,
  missingAttributes, missingHooks, reservedOf, retiredPatterns, retiredPlaceholderPrefixes, retiredRegex, retiredRequired,
  RETIRED_BY_D2, stripComments, testIdsOf, unboundAttributes, vanishedIds,
} from '../../scripts/check-contract-hooks.mjs'

const MD = `# C
## Clauses
### X-01 t
Given a
## Required hooks

| data-testid / attribute | Element | Purpose |
|---|---|---|
| \`screen-path\` | section | Screen |
| \`row-<ticketId>\` (attrs \`data-lane\`, \`data-kind\`) | li | Row |
| \`start-button\` (attr \`data-accent="primary"\`) | button | Start |
| \`a-1\`, \`a-2\` | x | y |
| route \`/path\` | - | - |
| \`GET /db/state\`, \`data-home\` | api | z |
| \`screen-onboarding\` (existing), \`onboarding-start-date\`, \`onboarding-submit\` (attr \`data-accent="primary"\`), \`form-error\` | screen | after parens |
| \`path-row-lane\` (attr \`data-lane\`), \`path-row-est\` | text | y |
| \`ladder-*\`, \`ticket-check-results\`, \`ticket-reviewer\` | reserved | R2 panels; must not exist in R1 |

## After
| \`not-a-hook\` | x | y |
`

describe('check-contract-hooks: parsing', () => {
  it('reads the first cell of the Required hooks table only, keeping hooks that follow a parenthesised note', () => {
    expect(hooksOf(MD)).toEqual([
      'screen-path', 'row-<ticketId>', 'start-button', 'a-1', 'a-2', 'data-home',
      'screen-onboarding', 'onboarding-start-date', 'onboarding-submit', 'form-error', 'path-row-lane', 'path-row-est', 'ladder-*',
    ])
  })
  it('does not require the reserved R2 hooks, and finds them as reserved', () => {
    expect(hooksOf(MD)).not.toContain('ticket-check-results')
    expect(reservedOf(MD)).toEqual(['ticket-check-results', 'ticket-reviewer'])
    expect(FORBIDDEN).toEqual(['ticket-check-results', 'ticket-reviewer'])
  })
  it('collects the data-* attributes named in the parenthesised Attr part', () => {
    expect(attributesOf(MD).sort()).toEqual(['data-accent', 'data-kind', 'data-lane'])
  })
  it('reads every Required hooks section of a file', () => {
    const two = `## Required hooks\n| a |\n|---|\n| \`x-1\` | e | p |\n\n## Mid\ntext\n\n## Required hooks\n| a |\n|---|\n| \`x-2\` | e | p |\n`
    expect(hooksOf(two)).toEqual(['x-1', 'x-2'])
  })
})

describe('check-contract-hooks: matching', () => {
  it('finds static hooks as string literals and rejects names that are only a prefix of another', () => {
    const src = `<b data-testid="start-button" /> <i data-testid="a-1" /> <i data-testid="a-10" />`
    expect(hookPresent('start-button', src)).toBe(true)
    expect(hookPresent('a-1', src)).toBe(true)
    expect(hookPresent('a-2', src)).toBe(false)
    expect(hookPresent('start', src)).toBe(false)
  })
  it('finds a templated static hook from its template plus the varying part written as a literal', () => {
    const src = "<a data-testid={`shell-nav-${id}`} /> const ids = ['today', 'path'] <div data-testid={`screen-${name}`} /> type S = 'path'"
    expect(hookPresent('shell-nav-today', src)).toBe(true)
    expect(hookPresent('shell-nav-review', src)).toBe(false)
    expect(hookPresent('screen-path', src)).toBe(true)
    expect(hookPresent('screen-nope', src)).toBe(false)
  })
  it('finds a hook whose middle segment varies and a hook built as prefix-${expr}-suffix', () => {
    const src = "<h data-testid={`notes-section-${s.id}-title`} /> const s = [{ id: 'data-model' }] <b data-testid={`path-lane-${l}`} /> const l = 'dsa'"
    expect(hookPresent('notes-section-data-model-title', src)).toBe(true)
    expect(hookPresent('path-lane-dsa', src)).toBe(true)
    expect(hookPresent('path-lane-zzz', src)).toBe(false)
  })
  it('requires the template form for a <placeholder> hook, not any string that starts with the prefix', () => {
    expect(hookPresent('row-<ticketId>', '<li data-testid={`row-${t.id}`} />')).toBe(true)
    expect(hookPresent('row-<ticketId>', "data-testid=\"row-header\"")).toBe(false)
    expect(hookPresent('do-<ticketId>', "data-testid=\"do-title\"")).toBe(false)
    expect(hookPresent('kit-link-<from>-<to>', '<g data-testid={`kit-link-${a}-${b}`} />')).toBe(true)
    expect(hookPresent('kit-link-<from>-<to>', '<g data-testid={`kit-link-${a}`} />')).toBe(false)
    expect(hookPresent('row-<ticketId>', "id = 'row-' + t.id")).toBe(true)
  })
  it('accepts numbered hooks enumerated as literals, and a composed child id of a present parent', () => {
    expect(hookPresent('session-close-q-<n>', '<fieldset data-testid="session-close-q-1"><fieldset data-testid="session-close-q-2">')).toBe(true)
    expect(hookPresent('session-close-q-<n>', '<fieldset data-testid="session-close-x-1">')).toBe(false)
    const parent = '<G testId={`session-dive-score-${i + 1}`} /> const tid = testId ? `${testId}-${v}` : undefined'
    expect(hookPresent('session-dive-score-<n>-<value>', parent)).toBe(true)
    expect(hookPresent('session-dive-score-<n>-<value>', '<G testId={`session-dive-score-${i + 1}`} />')).toBe(false)
  })
  it('matches a trailing * hook by prefix', () => {
    expect(hookPresent('ladder-*', "data-testid=\"ladder-step\"")).toBe(true)
    expect(hookPresent('ladder-*', "data-testid=\"other\"")).toBe(false)
  })
  it('lists the missing hooks', () => {
    expect(missingHooks(hooksOf(MD), 'data-testid="screen-path" data-testid={`row-${x}`} data-testid="start-button" data-testid="a-1" data-testid="data-home"').slice(0, 2)).toEqual(['a-2', 'screen-onboarding'])
  })
})

describe('check-contract-hooks: reserved, attributes, retired', () => {
  it('flags the reserved R2 hooks when the source writes them', () => {
    expect(forbiddenPresent('data-testid="ticket-lab"')).toEqual([])
    expect(forbiddenPresent('<i data-testid="ticket-reviewer" /><p data-testid="ticket-check-results" />')).toEqual(['ticket-check-results', 'ticket-reviewer'])
  })
  it('finds an attribute as a JSX attribute or a quoted key and reports the absent ones', () => {
    const src = `<i data-count={n} data-empty="true" {...{ 'data-value': 3 }} />`
    expect(missingAttributes(src, ['data-count', 'data-empty', 'data-value', 'data-lane'])).toEqual(['data-lane'])
  })
  it('turns the README Retired hooks table into patterns and checks required hooks against them', () => {
    const readme = '### Retired hooks\n\n| Group | Hooks |\n|---|---|\n| Board | `board-*`, `strip`, `undo` (board undo) |\n| Map | `path-<sprint>` (old Map), `rooms*` |\n\n## Next\n| x | `board-keep` |\n'
    const pats = retiredPatterns(readme)
    expect(pats).toEqual(['board-*', 'strip', 'undo', 'rooms*'])
    expect(retiredRegex('board-*').test('board-card')).toBe(true)
    expect(retiredRegex('strip').test('strip-x')).toBe(false)
    expect(retiredRequired(['board-card', 'path-doing', 'undo'], pats)).toEqual(['board-card', 'undo'])
  })
})

const PIPE_MD = `## Required hooks

| data-testid / attribute | Element | Purpose |
|---|---|---|
| \`session-close-q-<n>\`, \`session-close-chose\`, \`session-close-answer-<2|3|5>\`, \`session-close-q4-<0..3|none>\`, \`session-close-next\` (attr \`data-accent="primary"\`) | fieldset | The five-question close; \`NEXT · SCORE\` |
`

describe('check-contract-hooks: a | inside a backticked name', () => {
  it('keeps the whole row and expands the alternatives, so the hooks after the | are checked too', () => {
    expect(hooksOf(PIPE_MD)).toEqual([
      'session-close-q-<n>', 'session-close-chose', 'session-close-answer-2', 'session-close-answer-3', 'session-close-answer-5',
      'session-close-q4-<n>', 'session-close-q4-none', 'session-close-next',
    ])
    expect(attributePairsOf(PIPE_MD)).toEqual([{ hook: 'session-close-next', attr: 'data-accent' }])
  })
  it('expands <a|b>, <0..3|none> and leaves a plain placeholder alone', () => {
    expect(expandAlternatives('x-<2|3|5>')).toEqual(['x-2', 'x-3', 'x-5'])
    expect(expandAlternatives('x-<0..3|none>')).toEqual(['x-<n>', 'x-none'])
    expect(expandAlternatives('x-<id>')).toEqual(['x-<id>'])
  })
  it('reports an expanded hook the source lacks', () => {
    const src = '<a data-testid="session-close-answer-2" /><a data-testid="session-close-answer-3" /><i data-testid={`session-close-q4-${i}`} />'
    expect(missingHooks(hooksOf(PIPE_MD), src)).toEqual(['session-close-q-<n>', 'session-close-chose', 'session-close-answer-5', 'session-close-q4-none', 'session-close-next'])
  })
})

describe('check-contract-hooks: comments and test files', () => {
  it('strips block, JSX and line comments but keeps strings, templates and URLs', () => {
    const src = [
      '/* data-testid="in-block" */ const a = 1 // data-testid="in-line"',
      '<div>{/* data-testid="in-jsx" */}</div>',
      'const u = "https://example.com/a" // tail',
      'const t = `x//y ${f(/* c */ 1)} z`',
      "<p>don't // data-testid=\"after-apostrophe\"</p>",
      '<b data-testid="kept" />',
    ].join('\n')
    const out = stripComments(src)
    for (const gone of ['in-block', 'in-line', 'in-jsx', 'tail', 'c */']) expect(out).not.toContain(gone)
    expect(out).toContain('https://example.com/a')
    expect(out).toContain('`x//y ${f(')
    expect(out).toContain('data-testid="kept"')
    expect(out.split('\n')).toHaveLength(src.split('\n').length)
  })
  it('does not count a hook that only a comment writes, in any of the matching routes', () => {
    expect(hookPresent('only-comment', '// <i data-testid="only-comment" />')).toBe(false)
    expect(hookPresent('only-comment', '/* data-testid="only-comment" */')).toBe(false)
    expect(hookPresent('only-comment', '{/* <i data-testid="only-comment" /> */}')).toBe(false)
    expect(hookPresent('row-<id>', '// <li data-testid={`row-${t.id}`} />')).toBe(false)
    expect(hookPresent('nav-today', '<a data-testid={`nav-${id}`} />\n// const ids = ["today"]')).toBe(false)
    expect(hookPresent('only-comment', '<i data-testid="only-comment" />')).toBe(true)
    expect(forbiddenPresent('// data-testid="ticket-reviewer"')).toEqual([])
    expect(missingAttributes('// data-count={n}', ['data-count'])).toEqual(['data-count'])
  })
  it('wants a plain literal to follow a test-id carrier, not any string', () => {
    expect(hookPresent('some-hook', "const label = 'some-hook'")).toBe(false)
    expect(hookPresent('some-hook', "const ids = ['some-hook']")).toBe(false)
    for (const ok of ['data-testid="some-hook"', "data-testid={'some-hook'}", "testId: 'some-hook'", 'testId="some-hook"', "{ id: 'some-hook' }", "f.setAttribute('data-testid', 'some-hook')"]) {
      expect(hookPresent('some-hook', ok), ok).toBe(true)
    }
  })
})

describe('check-contract-hooks: attribute binding', () => {
  it('pairs each attribute with the hook directly before its note, and "both with" with the group', () => {
    const md = '## Required hooks\n| a |\n|---|\n| `a-1` (attr `data-lane`), `a-2`, `a-3` (attrs `data-kind`, `data-state`) | x | y |\n| `b-1`, `b-2` (both with `data-count`) | x | y |\n'
    expect(hookEntries(md)).toEqual([
      { hook: 'a-1', attrs: ['data-lane'] }, { hook: 'a-2', attrs: [] }, { hook: 'a-3', attrs: ['data-kind', 'data-state'] },
      { hook: 'b-1', attrs: ['data-count'] }, { hook: 'b-2', attrs: ['data-count'] },
    ])
    expect(attributePairsOf(MD)).toContainEqual({ hook: 'row-<ticketId>', attr: 'data-kind' })
    expect(attributePairsOf(MD)).not.toContainEqual({ hook: 'screen-path', attr: 'data-lane' })
  })
  it('accepts an attribute next to the hook and flags one that is only somewhere else in src', () => {
    const near = { f: 'src/A.tsx', text: '<li data-testid={`row-${t.id}`} data-lane={t.lane} />' }
    const far = { f: 'src/B.tsx', text: `<li data-testid={\`row-\${t.id}\`} />\n${'// pad\n'.repeat(200)}${' '.repeat(2000)}\n<i data-lane={x} />` }
    const elsewhere = { f: 'src/C.tsx', text: '<i data-lane={x} />' }
    expect(attributeBound('row-<ticketId>', 'data-lane', [near])).toBe(true)
    expect(attributeBound('row-<ticketId>', 'data-lane', [far, elsewhere])).toBe(false)
    expect(attributeBound('row-<ticketId>', 'data-lane', [far, near])).toBe(true)
    expect(unboundAttributes([{ hook: 'row-<ticketId>', attr: 'data-lane' }, { hook: 'row-<ticketId>', attr: 'data-kind' }], [near])).toEqual([{ hook: 'row-<ticketId>', attr: 'data-kind' }])
    expect(unboundAttributes([{ hook: 'gone-hook', attr: 'data-lane' }], [near])).toEqual([])
  })
  it('does not count an attribute that a comment writes near the hook', () => {
    const f = { f: 'src/A.tsx', text: '<b data-testid="x-y" />\n// data-count={n}' }
    expect(attributeBound('x-y', 'data-count', [f])).toBe(false)
  })
  it('binds the shared Meter hooks through the INDIRECT map to the component that writes the attributes', () => {
    const meter = { f: 'src/screens/skills/Meter.tsx', text: '<span data-done={done} data-total={total} data-testid={testId} />' }
    const user = { f: 'src/screens/skills/Area.tsx', text: '<SkMeter testId={`skills-area-meter-${id}`} />' }
    expect(attributeBound('skills-area-meter-<areaId>', 'data-done', [user, meter])).toBe(true)
    expect(attributeBound('skills-area-meter-<areaId>', 'data-done', [user])).toBe(false)
    const noAttr = { f: 'src/screens/skills/Meter.tsx', text: '<span data-testid={testId} />' }
    expect(attributeBound('skills-node-meter-<nodeId>', 'data-total', [user, noAttr])).toBe(false)
  })
})

describe('check-contract-hooks: foundation test ids (GLOBAL-10)', () => {
  const lines = [
    '<b data-testid="bank-chip" /> <i data-testid={\'quoted\'} />',
    "<G testId=\"g-one\" /> const T = { testId: 'g-two' }",
    '<li data-testid={`row-${t.id}`} /> <p testId={`cube-${k}`} /> <q data-testid="ai-blank-${pad2(n)}" />',
    "f.setAttribute('data-testid', 'py-frame')",
    'const contestId = 3',
  ]
  it('collects exact ids and template prefixes from the lines of a commit', () => {
    const { ids, prefixes } = testIdsOf(lines)
    expect(ids.sort()).toEqual(['bank-chip', 'g-one', 'g-two', 'py-frame', 'quoted'])
    expect(prefixes.sort()).toEqual(['ai-blank-', 'cube-', 'row-'])
  })
  it('subtracts README retirements and the remaining list, and wants everything else in the current source', () => {
    const found = testIdsOf(lines)
    const head = '<i data-testid="g-one" /> <li data-testid={`row-${t.id}`} /> <b data-testid="py-frame" />'
    expect(vanishedIds(found, head, ['ai-blank-*'], [])).toEqual(['bank-chip', 'cube-${...}', 'g-two', 'quoted'])
    expect(vanishedIds(found, head, ['ai-blank-*'], ['bank-chip', 'quoted'])).toEqual(['cube-${...}', 'g-two'])
    expect(vanishedIds(found, head, ['ai-blank-*', 'cube-*'], ['bank-chip', 'quoted', 'g-two'])).toEqual([])
    expect(vanishedIds(found, head, ['ai-blank-*'], ['bank-chip', 'quoted', 'g-two'], ['cube-'])).toEqual([])
  })
  it('reads the placeholder patterns of the README Retired table as prefixes', () => {
    expect(retiredPlaceholderPrefixes('### Retired hooks\n| G | H |\n|---|---|\n| Map | `lane-*`, `path-<sprint>` (old Map) |\n\n## N\n| x | `z-<q>` |')).toEqual(['path-'])
  })
  // docs/contracts is private-only (scripts/public-extract.mjs): the two README-reading tests skip in the public tree
  it.skipIf(!existsSync('docs/contracts/README.md'))('the README Retired table now covers the 26 names S7 used to ledger by hand (form-name and form-next are the Pom card hooks again)', () => {
    const S7 = [
      'bank-chip', 'shift-dialog', 'slide-dialog', 'carrot-hp-bar', 'health-chart', 'no-study-sessions',
      'redo-passed-value', 'redo-failed-value', 'redo-refunded-value', 'open-map', 'weekday', 'coverage', 'start-session',
      'session-resume', 'session-focus', 'timer-panel-readout', 'timer-busy-dialog', 'timer-busy-text', 'timer-busy-go',
      'timer-busy-stop', 'timer-busy-cancel', 'plan-dialog', 'brief-chip', 'ai-rung-', 'cube-', 'ring-',
    ]
    const patterns = retiredPatterns(readFileSync(join(process.cwd(), 'docs/contracts/README.md'), 'utf8'))
    expect(S7).toHaveLength(26)
    expect(S7.filter(n => !patterns.some(p => retiredRegex(p).test(n)))).toEqual([])
  })
  it.skipIf(!existsSync('docs/contracts/README.md'))('the remaining list holds only names the README table does not cover, once each', () => {
    const patterns = retiredPatterns(readFileSync(join(process.cwd(), 'docs/contracts/README.md'), 'utf8'))
    expect(new Set(RETIRED_BY_D2).size).toBe(RETIRED_BY_D2.length)
    expect(RETIRED_BY_D2.filter(n => patterns.some(p => retiredRegex(p).test(n)))).toEqual([])
  })
  it('the README Retired table now covers every D2 name, so the list is empty', () => {
    expect(RETIRED_BY_D2).toEqual([])
  })
})

const roots: string[] = []
afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })))
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
const cli = (cwd: string, ...a: string[]) => {
  try { return { code: 0, out: execFileSync('node', [join(process.cwd(), 'scripts/check-contract-hooks.mjs'), ...a], { cwd, encoding: 'utf8' }) } }
  catch (e) { const r = e as { status: number; stdout: string }; return { code: r.status, out: r.stdout } }
}
/** A throwaway repo: eight minimal contracts, a README with a Retired table, and a foundation commit whose src is replaced by the current one. */
function fixtureRepo(foundationSrc: string, headSrc: string, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hooks-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/contracts'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  const files = ['today-and-shell.md', 'path.md', 'review.md', 'ticket-view.md', 'skills-slice.md', 'design-session-v2.md', 'migration.md', 'launch.md']
  for (const f of files) writeFileSync(join(root, 'docs/contracts', f), f === 'path.md' ? '# p\n## Required hooks\n\n| a |\n|---|\n| `screen-path` (attr `data-lane`) | x | y |\n' : '# c\n')
  writeFileSync(join(root, 'docs/contracts/README.md'), '### Retired hooks\n\n| Group | Hooks |\n|---|---|\n| Old | `old-*`, `path-<sprint>` |\n\n## Next\n')
  git(root, 'init', '-q')
  writeFileSync(join(root, 'src/a.tsx'), foundationSrc)
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'foundation')
  const sha = git(root, 'rev-parse', '--short', 'HEAD')
  writeFileSync(join(root, 'src/a.tsx'), headSrc)
  // the global attribute scan wants every ATTRIBUTES name written (some in two files); these files satisfy it without sitting near any hook
  const attrs = ATTRIBUTES.map(a => `<i ${a}={1} />`).join('\n')
  writeFileSync(join(root, 'src/attrs1.tsx'), attrs)
  writeFileSync(join(root, 'src/attrs2.tsx'), attrs)
  for (const [f, t] of Object.entries(extra)) writeFileSync(join(root, f), t)
  return { root, sha }
}

describe('check-contract-hooks: the CLI on a throwaway repo', () => {
  const FOUNDATION = '<i data-testid="screen-path" data-lane="x" /> <i data-testid="kept" /> <i data-testid="old-card" /> <i data-testid="ledgered" /> <i data-testid="lost" /> <i data-testid={`path-${n}`} />'
  const HEAD = '<i data-testid="screen-path" data-lane="x" /> <i data-testid="kept" />'
  it('exits 1 and lists a foundation id that vanished without a retirement; README patterns excuse the rest', () => {
    const { root, sha } = fixtureRepo(FOUNDATION, HEAD)
    const r = cli(root, 'docs/contracts', 'src', '--foundation', sha)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/vanished: lost/)
    expect(r.out).toMatch(/vanished: ledgered/)
    expect(r.out).not.toMatch(/vanished: old-card/)
    expect(r.out).not.toMatch(/vanished: path-/)
    expect(r.out).not.toMatch(/missing: /)
    expect(cli(root, 'docs/contracts', 'src', '--no-foundation').code).toBe(0)
    expect(cli(root, 'docs/contracts', 'src', '--foundation', 'deadbeef').out).toMatch(/commit not found, skipped/)
  })
  it('exits 0 when every foundation id is still written or retired', () => {
    const { root, sha } = fixtureRepo('<i data-testid="a" /> <i data-testid="old-x" />', '<i data-testid="a" /> <i data-testid="screen-path" data-lane="1" />')
    const r = cli(root, 'docs/contracts', 'src', '--foundation', sha)
    expect(r.out).toMatch(/0 vanished without retirement/)
    expect(r.code).toBe(0)
  })
  it('fails a hook that only a comment or a test file writes, and an attribute that is not near its hook', () => {
    const { root } = fixtureRepo('', '// <i data-testid="screen-path" data-lane="1" />', { 'src/a.test.tsx': '<i data-testid="screen-path" data-lane="1" />' })
    const r = cli(root, 'docs/contracts', 'src', '--no-foundation')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/missing: screen-path/)
    writeFileSync(join(root, 'src/a.tsx'), `<i data-testid="screen-path" />\n${' '.repeat(800)}\n<b data-lane="1" />`)
    const r2 = cli(root, 'docs/contracts', 'src', '--no-foundation')
    expect(r2.code).toBe(1)
    expect(r2.out).toMatch(/attribute not near hook: screen-path data-lane/)
    writeFileSync(join(root, 'src/a.tsx'), '<i data-testid="screen-path" data-lane="1" />')
    expect(cli(root, 'docs/contracts', 'src', '--no-foundation').code).toBe(0)
  })
})

// docs/contracts is private-only (scripts/public-extract.mjs), so this one runs in the private repo and skips in a public clone.
describe.skipIf(!existsSync('docs/contracts'))('check-contract-hooks: the real contracts', () => {
  it('finds every hook the eight contracts require in src/ and none of the reserved ones, each attribute next to its hook', () => {
    const out = execFileSync('node', ['scripts/check-contract-hooks.mjs', 'docs/contracts', 'src', '--no-foundation'], { encoding: 'utf8' })
    expect(out).toMatch(/today-and-shell\.md: \d+ hooks, 0 missing/)
    expect(Number(/design-session-v2\.md: (\d+) hooks/.exec(out)?.[1])).toBeGreaterThanOrEqual(103)
    expect(out).not.toMatch(/missing: /)
    expect(out).toMatch(/reserved R2 hooks .*: 0 present/)
    expect(out).toMatch(/attribute binding: \d+ hook\/attribute pairs, 0 not written near their hook/)
  })
})
