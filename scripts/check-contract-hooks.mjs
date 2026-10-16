#!/usr/bin/env node
// Compares the "Required hooks" tables of the R1 contracts with the hooks written in src/.
//   node scripts/check-contract-hooks.mjs [contractsDir] [srcDir]
// Exit 1 and a list when a hook a contract requires is not written in the source, when a data-* attribute named in a
// table never occurs in the source, or when a reserved R2 hook exists. It checks that a name is *written* in the
// source; the blind tests (which never read src/) check that it works.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Contracts whose Required hooks tables are read. launch.md has no hook table today; it stays listed so one added later is checked. */
const SCOPE2 = ['board.md', 'journal.md', 'nav-and-topics.md', 'trees-and-banks.md', 'labs.md', 'rituals.md', 'portfolio.md']
export const CONTRACTS = [
  'today-and-shell.md', 'path.md', 'review.md', 'ticket-view.md', 'skills-slice.md',
  'design-session-v2.md', 'migration.md', 'launch.md', 'board.md', 'journal.md', 'nav-and-topics.md', 'trees-and-banks.md', 'labs.md', 'rituals.md', 'portfolio.md',
]

/** Reserved hooks asserted ABSENT. Empty since R2 W3: `ticket-check-results` and `ticket-reviewer` are live and required (labs.md). */
export const FORBIDDEN = []

/** data-* attribute hooks that must occur in the source even if a table row is edited; `min` is the least number of files. */
export const ATTRIBUTES = [
  'data-count', 'data-value', 'data-empty', 'data-ticket-id', 'data-action', 'data-accent', 'data-content', 'data-glyph',
  'data-done', 'data-total', 'data-layer', 'data-state', 'data-met', 'data-lane', 'data-kind', 'data-target', 'data-file',
]
/** Cross-screen attributes (README Hook rules) written by more than one screen. */
export const MIN_FILES = { 'data-count': 2, 'data-value': 1, 'data-empty': 2 }

const sectionLines = markdown => {
  const out = []
  let inTable = false
  for (const line of markdown.split('\n')) {
    if (/^##\s+Required hooks/i.test(line)) { inTable = true; continue }
    if (inTable && /^##\s/.test(line)) { inTable = false; continue }
    if (inTable && line.startsWith('|') && !/retired in R2/i.test(line)) out.push(line) // a retired family is asserted by the README Retired hooks, not required
  }
  return out
}
const PIPE = '\u0001'
/** Cells of a table row. A `|` inside a backtick span (`session-close-answer-<2|3|5>`) belongs to the name, not to the table. */
const cellsOf = line => line.replace(/`[^`]*`/g, m => m.replaceAll('|', PIPE)).split('|').map(c => c.replaceAll(PIPE, '|'))
const firstCell = line => cellsOf(line)[1] ?? ''

/** `a-<2|3|5>` and `a-<0..3|none>` list alternatives: plain ones become literal names, a numeric range `0..3` becomes the
 *  numbered placeholder `<n>` (the source may write it as a template or enumerate it). Other names pass through. */
export function expandAlternatives(name) {
  const m = /<([^<>]*\|[^<>]*)>/.exec(name)
  if (!m) return [name]
  const out = []
  let range = false
  for (const alt of m[1].split('|').map(x => x.trim())) {
    if (/^\d+\.\.\d+$/.test(alt)) { if (!range) out.push(...expandAlternatives(name.replace(m[0], '<n>'))); range = true } else out.push(...expandAlternatives(name.replace(m[0], alt)))
  }
  return out
}

/** Every hook of every Required hooks row with the data-* attributes the row's parenthesised note names for it:
 *  [{ hook, attrs }]. A note binds to the hook directly before it; "(both with `data-count`)" binds to the group before it. */
export function hookEntries(markdown) {
  const out = []
  for (const line of sectionLines(markdown)) {
    let group = []
    for (const m of firstCell(line).matchAll(/\(([^)]*)\)|`([^`]+)`/g)) {
      if (m[2] !== undefined) {
        const t = m[2].trim()
        if (t.startsWith('/') || /[=\s]/.test(t) || FORBIDDEN.includes(t)) continue
        for (const hook of expandAlternatives(t)) { const e = { hook, attrs: [] }; out.push(e); group.push(e) }
      } else {
        const attrs = [...m[1].matchAll(/`(data-[a-z][a-z0-9-]*)(?:=[^`]*)?`/g)].map(x => x[1])
        const targets = /^\s*both\b/.test(m[1]) ? group : group.slice(-1)
        for (const e of targets) e.attrs.push(...attrs)
        group = []
      }
    }
  }
  return out
}

/** Hook names from the first cell of every row of every "Required hooks" table. Parenthesised notes are ignored, so the
 *  hooks listed after a "(attrs ...)" note are kept; routes, assignments and API calls are skipped. */
export const hooksOf = markdown => [...new Set(hookEntries(markdown).map(e => e.hook))]

/** Reserved hook names that a Required hooks table lists (the script asserts these absent from src). */
export function reservedOf(markdown) {
  const out = new Set()
  for (const line of sectionLines(markdown)) {
    for (const m of firstCell(line).matchAll(/`([^`]+)`/g)) if (FORBIDDEN.includes(m[1].trim())) out.add(m[1].trim())
  }
  return [...out]
}

/** data-* attribute names a table names in the parenthesised Attr part of a first cell (`attr data-count`, `attrs data-lane`). */
export const attributesOf = markdown => [...new Set(hookEntries(markdown).flatMap(e => e.attrs))]

/** [{hook, attr}] pairs: each attribute with the hook it was written next to in the table. */
export const attributePairsOf = markdown => [...new Map(hookEntries(markdown).flatMap(e => e.attrs.map(attr => [`${e.hook}\u0000${attr}`, { hook: e.hook, attr }]))).values()]

/** Remove block comments (also the JSX brace-wrapped kind) and line comments. Strings and templates are copied as they are, so a URL such as
 *  "https://x" or a `//` inside a template survives. An unterminated ' or " ends at the line end (JSX text may hold apostrophes). */
export function stripComments(src) {
  let out = ''
  const n = src.length
  const quote = (i, q) => {
    let j = i + 1
    while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
    out += src.slice(i, Math.min(j + 1, n))
    return Math.min(j + 1, n)
  }
  function code(i, inExpr) {
    let depth = 0
    while (i < n) {
      const c = src[i]
      const d = src[i + 1]
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2)
        const stop = end === -1 ? n : end + 2
        out += ' ' + src.slice(i, stop).replace(/[^\n]/g, '')
        i = stop
        continue
      }
      if (c === '"' || c === "'") { i = quote(i, c); continue }
      if (c === '`') { i = template(i); continue }
      if (c === '{') depth++
      if (c === '}') { if (inExpr && depth === 0) return i; depth-- }
      out += c
      i++
    }
    return i
  }
  function template(i) {
    out += '`'
    i++
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') { out += '${'; i = code(i + 2, true); out += '}'; i++; continue }
      out += src[i++]
    }
    if (i < n) { out += '`'; i++ }
    return i
  }
  code(0, false)
  return out
}
const strippedCache = new Map()
const stripped = text => {
  let out = strippedCache.get(text)
  if (out === undefined) {
    if (strippedCache.size >= 1024) strippedCache.clear()
    strippedCache.set(text, (out = stripComments(text)))
  }
  return out
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const QUOTES = ['"', "'", '`']
const quoted = (s, lit) => QUOTES.some(q => s.includes(`${q}${lit}${q}`))
/** A static hook counts as written when a quoted literal follows a test-id carrier: data-testid=, testId=, testId:, id:, a
 *  `*TestId` prop, tid, setAttribute('data-testid', ...). A bare string elsewhere (a label, a constant list) does not. Names built from a template are matched by
 *  the template route below, which needs the template and the varying part. */
const CARRIER = /(?:(?:data-testid|testid|[A-Za-z]*TestId|testId|tid|id)["']?\s*[=:]|setAttribute\(\s*["']data-testid["']\s*,)\s*\{?\s*$/
const anchoredLiteral = (hook, text) => {
  for (const q of QUOTES) {
    const lit = q + hook + q
    for (let k = text.indexOf(lit); k !== -1; k = text.indexOf(lit, k + 1)) if (CARRIER.test(text.slice(Math.max(0, k - 80), k))) return true
  }
  return false
}
const TPL = '\\$\\{[^`]*?\\}'

/** True when the source writes the hook. Static names are found as a string literal, or as a template with the varying part
 *  written as a literal elsewhere (`shell-nav-${id}` + 'today', `notes-section-${id}-title` + 'requirements'). A dynamic name
 *  `a-<id>-b` needs the template `a-${...}-b`, never just a string that starts with `a-`; `x-*` is matched by prefix.
 *  A plain literal must follow a test-id carrier (see CARRIER). */
function present(hook, srcText) {
  // the Journal's segmented buttons are written once as `${testId}-${option.id}` (journal.md: `journal-rating-<id>-again`, `journal-obstacle-time`):
  // the group hook is present, the option id is a quoted literal and the composing template exists
  const seg = /^(journal-[a-z]+(?:-<[^>]+>)?)-([a-z]+)$/.exec(hook)
  if (seg && present(seg[1], srcText) && quoted(srcText, seg[2]) && srcText.includes('`${testId}-${')) return true
  const ph = hook.search(/<|\*/)
  if (ph !== -1) {
    if (hook[ph] === '*') {
      const needle = hook.slice(0, ph)
      return QUOTES.some(q => srcText.includes(`${q}${needle}`))
    }
    const segs = hook.split(/<[^>]+>/).map(esc)
    if (new RegExp('`' + segs.join(TPL) + '`').test(srcText)) return true
    // numbered hooks (`<n>`) may be enumerated as literals: session-close-q-1 ... session-close-q-5
    if (/<n>/.test(hook) && new RegExp('["\'`]' + hook.split(/<n>/).map(esc).join('\\d+') + '["\'`]').test(srcText)) return true
    // child of a composed id: `${parentTestId}-${v}` when the parent hook `a-<n>` is itself present (session-dive-score-<n>-<value>)
    const parent = /^(.*[^-])-<[^>]+>$/.exec(hook)
    if (parent && /<[^>]+>/.test(parent[1]) && present(parent[1], srcText) && /`\$\{[^`}]+\}-\$\{[^`}]+\}`/.test(srcText)) return true
    // string concatenation: 'prefix-' + id  (single placeholder at the end)
    const m = /^([^<]+)<[^>]+>$/.exec(hook)
    return m ? new RegExp(`["']${esc(m[1])}["']\\s*\\+`).test(srcText) : false
  }
  if (anchoredLiteral(hook, srcText)) return true
  const parts = hook.split('-')
  // replace a run of dash-separated segments by ${...}; the run itself must be a literal somewhere in the source
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      if (i === 0 && j === parts.length) continue
      const pre = parts.slice(0, i).join('-') + (i ? '-' : '')
      const post = (j < parts.length ? '-' : '') + parts.slice(j).join('-')
      const run = parts.slice(i, j).join('-')
      if (!pre && !post) continue
      const re = new RegExp('`' + esc(pre) + TPL + esc(post) + '`')
      if (re.test(srcText) && quoted(srcText, run)) return true
    }
  }
  return false
}

export const hookPresent = (hook, srcText) => present(hook, stripped(srcText))
export const missingHooks = (hooks, srcText) => hooks.filter(h => !hookPresent(h, srcText))
export const forbiddenPresent = srcText => FORBIDDEN.filter(h => stripped(srcText).includes(h))
const attrWritten = (srcText, a) => { const t = stripped(srcText); return t.includes(`${a}=`) || quoted(t, a) }
export const missingAttributes = (srcText, attrs = ATTRIBUTES) => attrs.filter(a => !attrWritten(srcText, a))

/** Retired-hook patterns from the README table ("Retired hooks"): `board-*` becomes a prefix pattern, placeholders are skipped. */
export function retiredPatterns(readme) {
  const out = []
  let on = false
  for (const line of readme.split('\n')) {
    if (/^###\s+Retired hooks/i.test(line)) { on = true; continue }
    if (on && /^#{1,3}\s/.test(line)) break
    if (!on || !line.startsWith('|')) continue
    // a sentence after the list ("`ticket-lab` is not retired") names hooks that stay live: only the first sentence retires
    const cell = (line.split('|')[2] ?? '').replace(/\([^)]*\)/g, '').split(/`\.\s/)[0]
    // `path-<sprint>` (old Map) is skipped: a placeholder pattern would swallow every live `path-*` hook
    for (const m of cell.matchAll(/`([^`]+)`/g)) if (!/</.test(m[1])) out.push(m[1].trim())
  }
  return out
}
/** README retired patterns with a placeholder (`path-<sprint>`): the literal prefix before it (`path-`). They are kept out of
 *  `retiredPatterns` (a regex would swallow every live `path-*` hook) and used only for a foundation id built as `path-${x}`. */
export function retiredPlaceholderPrefixes(readme) {
  const out = []
  let on = false
  for (const line of readme.split('\n')) {
    if (/^###\s+Retired hooks/i.test(line)) { on = true; continue }
    if (on && /^#{1,3}\s/.test(line)) break
    if (!on || !line.startsWith('|')) continue
    // a sentence after the list ("`ticket-lab` is not retired") names hooks that stay live: only the first sentence retires
    const cell = (line.split('|')[2] ?? '').replace(/\([^)]*\)/g, '').split(/`\.\s/)[0]
    for (const m of cell.matchAll(/`([^`<]+)<[^`]*`/g)) out.push(m[1])
  }
  return out
}
export function retiredRegex(pattern) {
  return new RegExp('^' + pattern.split(/(\*|<[^>]+>)/).map(p => (p === '*' || p.startsWith('<') ? '.*' : esc(p))).join('') + '$')
}
export const retiredRequired = (hooks, patterns) => hooks.filter(h => patterns.some(p => retiredRegex(p).test(h)))

/** Hooks whose attributes are written by a shared component that receives the hook as a prop: the attribute is looked for
 *  next to `anchor` inside the named file (path suffix) instead of next to the hook's own literal. */
export const INDIRECT = {
  'skills-area-meter-<areaId>': { file: 'screens/skills/Meter.tsx', anchor: 'data-testid={testId}' },
  'skills-node-meter-<nodeId>': { file: 'screens/skills/Meter.tsx', anchor: 'data-testid={testId}' },
  // W5: the Review card and the Floor session share one CardView that writes both prefixes from a table
  'review-card': { file: 'screens/Review.tsx', anchor: 'data-testid={T.cardTestId}' },
  'review-reveal': { file: 'screens/Review.tsx', anchor: 'data-testid={T.revealTestId}' },
  'review-redo': { file: 'screens/Review.tsx', anchor: 'data-testid={T.redoTestId}' },
  'floor-card': { file: 'screens/Review.tsx', anchor: 'data-testid={T.cardTestId}' },
  'floor-reveal': { file: 'screens/Review.tsx', anchor: 'data-testid={T.revealTestId}' },
  'floor-redo': { file: 'screens/Review.tsx', anchor: 'data-testid={T.redoTestId}' },
}
export const ATTR_WINDOW = 300

const occurrences = (text, needle) => {
  const out = []
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i)
  return out
}
/** Indices in `text` where the hook is written: its quoted literal, or its template / string prefix (`shell-nav-${`, 'row-' + id). */
export function hookAnchors(hook, text) {
  const out = []
  const ph = hook.search(/<|\*/)
  if (ph !== -1) {
    const prefix = hook.slice(0, ph)
    if (prefix) for (const q of QUOTES) out.push(...occurrences(text, q + prefix))
    return out
  }
  for (const q of QUOTES) out.push(...occurrences(text, q + hook + q))
  const parts = hook.split('-')
  for (let i = parts.length - 1; i >= 1; i--) {
    const pre = parts.slice(0, i).join('-') + '-'
    const at = occurrences(text, '`' + pre + '${')
    if (at.length) { out.push(...at); break }
  }
  return out
}
const nearAttr = (text, k, len, attr) => {
  const win = text.slice(Math.max(0, k - ATTR_WINDOW), k + len + ATTR_WINDOW)
  return win.includes(`${attr}=`) || QUOTES.some(q => win.includes(`${q}${attr}${q}`))
}
/** True when `attr` is written within ATTR_WINDOW characters of an occurrence of the hook in one file ([{ f, text }]). */
export function attributeBound(hook, attr, files) {
  const ind = INDIRECT[hook]
  for (const { f, text: raw } of files) {
    if (ind && !f.replaceAll('\\', '/').endsWith(ind.file)) continue
    const text = stripped(raw)
    const at = ind ? occurrences(text, ind.anchor) : hookAnchors(hook, text)
    const len = ind ? ind.anchor.length : hook.length
    if (at.some(k => nearAttr(text, k, len, attr))) return true
  }
  return false
}
/** Pairs from `attributePairsOf` whose hook is written (hooks reported missing are left out) but whose attribute is not near it. */
export const unboundAttributes = (pairs, files) => {
  const all = files.map(x => x.text).join('\n')
  return pairs.filter(p => hookPresent(p.hook, all) && !attributeBound(p.hook, p.attr, files))
}

/** The explicit remaining list: foundation test ids that GLOBAL-10 lets go although the README Retired table has no entry for them.
 *  Empty since contracts ccbfe60: the README Retired table now lists every name that D2 and 2a dropped. Add a name here only with a ledger entry,
 *  and delete it once the README table covers it. */
export const RETIRED_BY_D2 = [
  // R2 W7 ledger: the brief editor, check dialog and deliverable dialog were deleted (R-8). The README Retired table does not name their hooks yet; delete these
  // names once it does.
  'brief-editor', 'check-correction', 'check-dialog', 'check-no-questions', 'check-verdict', 'deliverable-dialog', 'deliverable-error', 'deliverable-feedback',
]
export const DEFAULT_FOUNDATION = '92df701'

/** Test ids written in the lines `git grep` returned: { ids: exact names, prefixes: names cut at a `${` } (a prefix stands for `name${...}`). */
export function testIdsOf(lines) {
  const ids = new Set()
  const prefixes = new Set()
  const add = raw => {
    const i = raw.indexOf('${')
    if (i === -1) ids.add(raw)
    else if (i > 0) prefixes.add(raw.slice(0, i))
  }
  const forms = [
    /\b(?:data-testid|testId)=\{?\s*(["'])([^"']+)\1/g,
    /\btestId:\s*(["'])([^"']+)\1/g,
    /\bsetAttribute\(\s*'data-testid',\s*(["'])([^"']+)\1/g,
    /\b(?:data-testid|testId)=\{\s*`([^`]*)`/g,
  ]
  for (const line of lines) {
    for (const re of forms) for (const m of line.matchAll(re)) add(m[2] ?? m[1])
  }
  return { ids: [...ids], prefixes: [...prefixes] }
}
/** Foundation test ids that are neither retired (README patterns, RETIRED_BY_D2) nor still written in `headText`. */
export function vanishedIds({ ids, prefixes }, headText, patterns, extraRetired = RETIRED_BY_D2, placeholderPrefixes = []) {
  const retired = name => extraRetired.includes(name) || patterns.some(p => retiredRegex(p).test(name))
  const out = []
  for (const id of ids) if (!retired(id) && !hookPresent(id, headText)) out.push(id)
  for (const p of prefixes) {
    const name = `${p}<x>`
    if (!retired(p) && !retired(`${p}x`) && !placeholderPrefixes.includes(p) && !hookPresent(name, headText)) out.push(`${p}\${...}`)
  }
  return [...new Set(out)].sort()
}
const isTestFile = f => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)__tests__\//.test(f)

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !isTestFile(p) ? [p] : []
  })
}

function foundationLines(commit, srcDir) {
  return execFileSync('git', ['grep', '-hE', 'data-testid|testId *[=:]', commit, '--', srcDir, ':!*.test.*', ':!*.spec.*'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n')
}
const commitExists = commit => { try { execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' }); return true } catch { return false } }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  let foundation = DEFAULT_FOUNDATION
  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--foundation') foundation = args[++i]
    else if (args[i] === '--no-foundation') foundation = null
    else positional.push(args[i])
  }
  const contracts = positional[0] ?? 'docs/contracts'
  const src = positional[1] ?? 'src'
  const files = walk(src).map(f => ({ f, text: stripComments(readFileSync(f, 'utf8')) }))
  const text = files.map(x => x.text).join('\n')
  let bad = 0
  const required = []
  const attrs = new Set()
  const pairs = []
  for (const file of CONTRACTS) {
    if (SCOPE2.includes(file) && !existsSync(join(contracts, file))) continue // a contracts folder from before scope 2 has no scope-2 contracts
    const md = readFileSync(join(contracts, file), 'utf8')
    const hooks = hooksOf(md)
    required.push(...hooks)
    for (const a of attributesOf(md)) attrs.add(a)
    pairs.push(...attributePairsOf(md))
    const miss = missingHooks(hooks, text)
    console.log(`${file}: ${hooks.length} hooks, ${miss.length} missing`)
    for (const m of miss) console.log(`  missing: ${m}`)
    bad += miss.length
  }
  const forbidden = forbiddenPresent(text)
  console.log(`reserved R2 hooks (${FORBIDDEN.join(', ')}): ${forbidden.length} present`)
  for (const f of forbidden) console.log(`  present but reserved: ${f}`)
  bad += forbidden.length
  const wanted = [...new Set([...ATTRIBUTES, ...attrs])]
  const missAttr = missingAttributes(text, wanted)
  const fewFiles = Object.entries(MIN_FILES).filter(([a, n]) => files.filter(x => attrWritten(x.text, a)).length < n)
  console.log(`attributes: ${wanted.length} checked, ${missAttr.length + fewFiles.length} problems`)
  for (const a of missAttr) console.log(`  attribute never written: ${a}`)
  for (const [a, n] of fewFiles) if (!missAttr.includes(a)) console.log(`  attribute written in fewer than ${n} files: ${a}`)
  bad += missAttr.length + fewFiles.filter(([a]) => !missAttr.includes(a)).length
  const unbound = unboundAttributes(pairs, files)
  console.log(`attribute binding: ${pairs.length} hook/attribute pairs, ${unbound.length} not written near their hook`)
  for (const u of unbound) console.log(`  attribute not near hook: ${u.hook} ${u.attr}`)
  bad += unbound.length
  const patterns = retiredPatterns(readFileSync(join(contracts, 'README.md'), 'utf8'))
  // README "Board and sprint machinery": the new Board (board.md) reuses `screen-board`, which the old retired list also names
  const clash = retiredRequired(required, patterns).filter(h => h !== 'screen-board' && h !== 'shell-tab-more') // README "Old nav": `shell-tab-more` is the new tab-bar item, not the retired `more-button`
  console.log(`retired hooks (${patterns.length} patterns): ${clash.length} also required by a table`)
  for (const c of clash) console.log(`  retired but required: ${c}`)
  bad += clash.length
  if (foundation && !commitExists(foundation)) console.log(`foundation ${foundation}: commit not found, skipped`)
  else if (foundation) {
    const found = testIdsOf(foundationLines(foundation, src))
    const readme = readFileSync(join(contracts, 'README.md'), 'utf8')
    const gone = vanishedIds(found, text, patterns, RETIRED_BY_D2, retiredPlaceholderPrefixes(readme))
    console.log(`foundation ${foundation}: ${found.ids.length + found.prefixes.length} test ids, ${RETIRED_BY_D2.length} retired by the remaining list + ${patterns.length} README patterns, ${gone.length} vanished without retirement`)
    for (const g of gone) console.log(`  vanished: ${g}`)
    bad += gone.length
  }
  process.exit(bad === 0 ? 0 : 1)
}
