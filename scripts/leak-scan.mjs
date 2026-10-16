// Leak scan (R2). One scan of text that must not go public, used by the lab export (server/portfolio/export.mjs) and by
// `publish:public` (through scripts/public-extract.mjs), so the term lists live in ONE place: scripts/plan/terms.mjs.
// That file is private; this one also ships in the public tree and the installed app, so it is loaded only when it exists (then the
// term rule applies; without it only the four generic rules run). W2's review bundle uses `looksLikeSecret` to withhold a file.
// Node standard library only.
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Token shapes that must never leave the learner's machine, each with a minimum length so ordinary words do not match. */
export const TOKEN_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  /\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained tokens
  /\bsk-[A-Za-z0-9_-]{16,}/, // secret keys such as sk-... and sk-ant-...
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ids
  /-----BEGIN\b/, // PEM blocks (private keys, certificates)
]

/** True when `text` holds something shaped like a token or a key. */
export function looksLikeSecret(text) {
  return TOKEN_SHAPES.some(re => re.test(text))
}

const LOCAL = /[A-Za-z0-9._%+-]/
const DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
/**
 * The first `local@domain.tld` in a line (local part of A-Za-z0-9._%+-, domain labels of A-Za-z0-9- separated by dots, a final label of
 * two or more letters). It looks outwards from each "@" instead of running one regex over the line, so a minified file with a very long
 * line and no "@" costs one pass, not a quadratic scan.
 */
function emailMatch(line) {
  for (let at = line.indexOf('@'); at >= 0; at = line.indexOf('@', at + 1)) {
    let start = at
    while (start > 0 && LOCAL.test(line[start - 1])) start--
    if (start === at) continue
    const m = DOMAIN.exec(line.slice(at + 1, at + 1 + 255))
    if (m) { const text = line.slice(start, at + 1 + m[0].length); return Object.assign([text], { index: start }) }
  }
  return null
}

/**
 * A private host name (labels of A-Za-z0-9- separated by dots, ending in .internal, .corp, .local, .lan or .intra) or a private IPv4
 * address (10/8, 192.168/16, 172.16/12). Not preceded or followed by more of the same token, so `1.10.0.1`, `x.internals` and
 * `a.local.example` do not match; `localhost` and `127.0.0.1` are not private-network names in this sense and never match.
 */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const HOST = new RegExp(
  `(?<![A-Za-z0-9._-])(?:(?:[A-Za-z0-9-]+\\.)+(?:internal|corp|local|lan|intra)(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])` +
  `|(?:10\\.${OCTET}|192\\.168|172\\.(?:1[6-9]|2\\d|3[01]))\\.${OCTET}\\.${OCTET}(?![\\d-]|\\.\\d))`,
  'i',
)

/** The generic rules (portfolio.md, "Leak scan rules"): a home path, an email address, a token shape, a private host. First match per rule per line. */
export const GENERIC_RULES = [
  { rule: 'home-path', test: line => /\/(?:Users|home)\/[A-Za-z0-9._-]+/.exec(line) },
  { rule: 'email', test: emailMatch },
  { rule: 'token', test: line => { for (const re of TOKEN_SHAPES) { const m = re.exec(line); if (m) return m } return null } },
  { rule: 'host', test: line => HOST.exec(line) },
]

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', '.dojo-dev'])
const PROBE = 8192
const SHOWN = 200

/** The personal and employer term lists of the public-release scrub: present in the private repo, absent from the public tree. */
const TERMS = await import(new URL('./plan/terms.mjs', import.meta.url).href).then(
  m => ({ rules: m.PERSONAL ?? [], allow: m.PERSONAL_ALLOW ?? [] }),
  () => ({ rules: [], allow: [] }),
)

export const formatHit = h => `${h.file}:${h.line} [${h.rule}] ${h.text}`

function* walk(dir, rel = '') {
  const entries = readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) yield* walk(dir, r) }
    else if (e.isFile()) yield r // a symlink is neither: never followed
  }
}

function isBinary(path) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(PROBE)
    const n = readSync(fd, buf, 0, PROBE, 0)
    return buf.subarray(0, n).includes(0)
  } finally { closeSync(fd) }
}

/** The line the learner has to fix, trimmed, cut to SHOWN characters around the match (`at` is its index in the untrimmed line). */
function shown(line, at) {
  const t = line.trim()
  if (t.length <= SHOWN) return t
  const pos = Math.max(0, at - (line.length - line.trimStart().length))
  const start = Math.max(0, Math.min(pos - Math.floor(SHOWN / 2), t.length - SHOWN))
  return `${start > 0 ? '…' : ''}${t.slice(start, start + SHOWN)}${start + SHOWN < t.length ? '…' : ''}`
}

/**
 * Scans the text files under `dir` and returns [{ file, line, rule, text }], ordered by file (code point), then line. `file` is posix
 * and relative to `dir`; `line` is 1-based; `text` is the offending line (trimmed, at most about 200 characters). Binary files (a NUL in
 * the first 8 KiB), symlinks, node_modules and .git are skipped.
 *   generic  (default true) the four generic rules; the term rule always runs when the term lists exist
 *   files    a RegExp on the relative path: only matching files are scanned
 *   allow    RegExps (flag g) removed from a line before the TERM rules look at it (never before the generic ones)
 *   extraTerms  strings matched case-insensitively as substrings, rule `term` (the DOJO_LEAK_EXTRA_TERMS test hook)
 */
export function scanTree(dir, { generic = true, files = null, allow = [], extraTerms = [] } = {}) {
  const hits = []
  const termAllow = [...TERMS.allow, ...allow]
  const extra = extraTerms.map(t => String(t).trim().toLowerCase()).filter(Boolean)
  for (const rel of walk(dir)) {
    if (files && !files.test(rel)) continue
    const abs = join(dir, rel)
    if (!lstatSync(abs).isFile() || isBinary(abs)) continue
    readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const add = (rule, at) => hits.push({ file: rel, line: i + 1, rule, text: shown(line, at) })
      if (generic) for (const { rule, test } of GENERIC_RULES) { const m = test(line); if (m) add(rule, m.index) }
      const rest = termAllow.reduce((s, re) => s.replace(re, ''), line)
      for (const re of TERMS.rules) { const m = re.exec(rest); if (m) add('term', Math.max(0, line.indexOf(m[0]))) }
      const low = rest.toLowerCase()
      for (const t of extra) { if (low.includes(t)) add('term', Math.max(0, line.toLowerCase().indexOf(t))) }
    })
  }
  return hits
}
