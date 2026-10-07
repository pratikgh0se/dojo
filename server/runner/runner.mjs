// The Go runner (C-RUNNER §1–§3): problem packs, the generated harness, the build, and the sandboxed
// run. Node standard library only. The packs' reference solutions (packs/<id>/ref.go) stay here on
// the server: publicPack() is the only view of a pack that ever leaves it.
//
// One run, in a fresh temp dir (removed afterwards):
//   <tmp>/mod   module "dojo": solution.go (the learner's file), dojo_main.go (generated), tk/tk.go
//   <tmp>/home  HOME and TMPDIR for the build and the program (go refuses a go.mod at the TMPDIR root)
//   <tmp>/prog  the binary, run under sandbox-exec (no network, no writes outside <tmp>, no exec/fork)
// The program writes toolkit events to fd 3 and case results to fd 4; fd 1 is the learner's stdout.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { accessSync, chmodSync, constants, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyStep, unshownStep } from '../../shared/stepShape.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKS_DIR = join(HERE, 'packs')
/** The app's root (app/: server, src, dist…). Neither the program nor the build may read it (I2). */
export const APP_DIR = join(HERE, '..', '..')
export const TK_DIR = join(HERE, 'tk')
export const TK_SOURCE = join(TK_DIR, 'tk.go')
export const PACK_IDS = [
  'p91', 'p198', 'p322', 'p62', 'p1143',
  // C-VISUAL §5
  'p743', 'p207', 'p802', 'p684', 'p1584', 'p877', 'p55', 'p875', 'p153', 'p3', 'p11', 'p206', 'p56', 'p215', 'p543',
]
export const EXAMPLES = 2

export const LIMITS = {
  wallMs: 3000,
  /**
   * R5: the program's own wall guard (tk/internal/wire) fires at wallMs + wallGraceMs, after the
   * runner's kill, so it only matters once the runner has lost the program (a server SIGKILLed mid-run).
   */
  wallGraceMs: 1000,
  /**
   * R5: RLIMIT_CPU, set in the program before learner code runs. macOS only sends SIGXCPU (never
   * SIGKILL, even past the hard limit) and Go's runtime ignores it, so wire also polls getrusage and
   * exits once the CPU used reaches cpuSoftSec (reported as a timeout). A single
   * thread cannot reach 4 s of CPU inside the 3 s wall; a program spinning several goroutines can.
   */
  cpuSoftSec: 4,
  cpuHardSec: 5,
  outputBytes: 1024 * 1024,
  /** safety net for fd 3 (tk itself stops after 20000 events, so this is never reached in practice) */
  eventBytes: 16 * 1024 * 1024,
  rssBytes: 512 * 1024 * 1024,
  codeBytes: 64 * 1024,
  compileMs: 30_000,
  maxEvents: 20_000,
  stdoutCap: 64 * 1024,
  stderrCap: 16 * 1024,
  rssPollMs: 50,
  /**
   * L3: the build's process group (go, compile, link) may use this much RSS in total. A normal build
   * peaked at ~255 MiB with a cold cache and ~90 MiB warm (measured 2026-10-04, go1.24, M-series), so
   * 1 GiB leaves 4x room; past it the build is killed as "the build used too much memory".
   */
  buildRssBytes: 1024 * 1024 * 1024,
  buildRssPollMs: 100,
  /** what the program may add to its temp dir, in total (RLIMIT_FSIZE caps each file at 64 MiB too) */
  diskBytes: 64 * 1024 * 1024,
  /** more entries than this in the temp dir counts as filling the disk */
  diskEntries: 10_000,
  diskPollMs: 100,
  /** the largest file a build may write (ulimit -f): the binary, an object file */
  buildFileBytes: 64 * 1024 * 1024,
  maxGoroutines: 10_000,
  /** the shared build cache under DOJO_HOME is cleaned when it grows past this */
  cacheBytes: 1024 * 1024 * 1024,
  cacheCheckMs: 10 * 60 * 1000,
}
export const STATUSES = ['ok', 'compile_error', 'runtime_error', 'timeout', 'output_limit', 'memory_limit', 'no_toolchain']
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
/** A run's temp dir is `<tmpdir>/dojo-run-<server pid>-XXXXXX` (R5: the pid names its owner). */
const RUN_PREFIX = 'dojo-run-'
const CANCELLED = 'the run was stopped before it finished'
const GO_FALLBACKS = ['/opt/homebrew/bin/go', '/usr/local/go/bin/go', '/usr/local/bin/go']

// ---------------------------------------------------------------- packs

const TYPES = new Set(['int', 'string', 'bool', '[]int', '[][]int', '[]string', '*ListNode', '*TreeNode'])

/** Loads every pack (public fields plus `ref`, the server-only reference source). */
export function loadPacks(dir = PACKS_DIR) {
  const packs = new Map()
  for (const id of readdirSync(dir)) {
    const p = JSON.parse(readFileSync(join(dir, id, 'pack.json'), 'utf8'))
    if (p.id !== id) throw new Error(`pack ${id}: id mismatch`)
    for (const t of [...p.params.map(x => x.type), p.returns]) if (!TYPES.has(t)) throw new Error(`pack ${id}: unsupported type ${t}`)
    packs.set(id, { ...p, ref: readFileSync(join(dir, id, 'ref.go'), 'utf8') })
  }
  return packs
}

/** A value as the page shows it in a call: arrays without spaces, strings JSON-quoted. */
export function showValue(v) {
  return JSON.stringify(v)
}

/** `numDecodings("226")`, `coinChange([1,2,5], 11)`, `longestCommonSubsequence("abcde", "ace")`. */
export function callText(pack, args) {
  return `${pack.fn}(${args.map(showValue).join(', ')})`
}

/** The part of a pack the page may see: never the reference. */
export function publicPack(pack) {
  return {
    id: pack.id, title: pack.title, fn: pack.fn, signature: pack.signature, starter: pack.starter, examples: EXAMPLES,
    cases: pack.cases.map((c, k) => ({ id: k + 1, call: callText(pack, c.args), expected: c.expected })),
  }
}

/** A Go literal for a JSON value of a pack type. */
export function goLiteral(type, v) {
  switch (type) {
    case 'int': return String(Math.trunc(v))
    case 'bool': return v ? 'true' : 'false'
    case 'string': return JSON.stringify(v)
    case '[]int': return `[]int{${v.map(x => goLiteral('int', x)).join(', ')}}`
    case '[]string': return `[]string{${v.map(x => goLiteral('string', x)).join(', ')}}`
    case '[][]int': return `[][]int{${v.map(x => `{${x.map(y => goLiteral('int', y)).join(', ')}}`).join(', ')}}`
    // C-VISUAL §5: a list is written as an int array, a tree as a level-order array with null
    case '*ListNode': return `dojo_list(${goLiteral('[]int', v)})`
    case '*TreeNode': return `dojo_tree([]int{${v.map(x => (x === null ? '0' : goLiteral('int', x))).join(', ')}}, []bool{${v.map(x => (x === null ? 'false' : 'true')).join(', ')}})`
    default: throw new Error(`unsupported type ${type}`)
  }
}

const FORMATTERS = {
  int: 'dojo_int', string: 'dojo_q', bool: 'dojo_bool', '[]int': 'dojo_ints', '[][]int': 'dojo_intss', '[]string': 'dojo_strs',
  '*ListNode': 'dojo_listout', '*TreeNode': 'dojo_treeout',
}

// ---------------------------------------------------------------- source and harness

/**
 * I1: whether the first token after whitespace and comments is `package` (one linear pass; the regex
 * this replaces backtracked exponentially on runs of comments and froze the event loop).
 */
export function startsWithPackageClause(code) {
  const s = String(code)
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { i++; continue }
    if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i + 2)
      if (nl < 0) return false
      i = nl + 1
      continue
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2)
      if (end < 0) return false
      i = end + 2
      continue
    }
    return s.startsWith('package', i) && /\s/.test(s[i + 7] ?? '')
  }
  return false
}

/** The learner's file as built. Without its own package clause it gets `package main` on top (offset 1). */
export function prepareSource(code) {
  const hasPackage = startsWithPackageClause(code)
  return hasPackage ? { source: code, offset: 0 } : { source: `package main\n${code}`, offset: 1 }
}

/**
 * dojo_main.go: hands one closure per case to tk.DojoHarness, which runs them and reports each result
 * on fd 4, framed with the run key (see tk/internal/wire). Only formatting lives in package main.
 */
export function harnessMain(pack, cases, limits = LIMITS) {
  const fmtr = FORMATTERS[pack.returns]
  const calls = cases.map(c => {
    const args = c.args.map((a, i) => goLiteral(pack.params[i].type, a)).join(', ')
    return `\t\tfunc() string { return ${fmtr}(${pack.fn}(${args})) },`
  }).join('\n')
  return `// Code generated by the Dojo runner. DO NOT EDIT.
package main

import (
	dojo_tk "dojo/tk"
	dojo_strconv "strconv"
)

func dojo_q(s string) string {
	const hex = "0123456789abcdef"
	b := []byte{'"'}
	for _, r := range s {
		switch {
		case r == '"' || r == '\\\\':
			b = append(b, '\\\\', byte(r))
		case r < 0x20:
			b = append(b, '\\\\', 'u', '0', '0', hex[r>>4], hex[r&15])
		default:
			b = append(b, string(r)...)
		}
	}
	return string(append(b, '"'))
}

// C-VISUAL Addendum 4: an int beyond ±2^53 is written as exact text (a JSON number would lose digits)
func dojo_int(v int) string {
	if v > 1<<53-1 || v < -(1<<53-1) {
		return "\\"" + dojo_strconv.Itoa(v) + "\\""
	}
	return dojo_strconv.Itoa(v)
}

func dojo_bool(v bool) string { return dojo_strconv.FormatBool(v) }

func dojo_ints(v []int) string {
	s := "["
	for i, x := range v {
		if i > 0 {
			s += ","
		}
		s += dojo_int(x)
	}
	return s + "]"
}

func dojo_intss(v [][]int) string {
	s := "["
	for i, x := range v {
		if i > 0 {
			s += ","
		}
		s += dojo_ints(x)
	}
	return s + "]"
}

func dojo_strs(v []string) string {
	s := "["
	for i, x := range v {
		if i > 0 {
			s += ","
		}
		s += dojo_q(x)
	}
	return s + "]"
}

// C-VISUAL §5: the list and tree types every pack's file can use (redeclaring one is a compile error).
type ListNode struct {
	Val  int
	Next *ListNode
}

type TreeNode struct {
	Val   int
	Left  *TreeNode
	Right *TreeNode
}

func dojo_list(v []int) *ListNode {
	var head *ListNode
	for i := len(v) - 1; i >= 0; i-- {
		head = &ListNode{Val: v[i], Next: head}
	}
	return head
}

// dojo_tree builds a tree from a LeetCode level-order array (ok[i] false is a null).
func dojo_tree(v []int, ok []bool) *TreeNode {
	if len(v) == 0 || !ok[0] {
		return nil
	}
	root := &TreeNode{Val: v[0]}
	queue := []*TreeNode{root}
	for i := 1; i < len(v) && len(queue) > 0; {
		n := queue[0]
		queue = queue[1:]
		if ok[i] {
			n.Left = &TreeNode{Val: v[i]}
			queue = append(queue, n.Left)
		}
		i++
		if i < len(v) && ok[i] {
			n.Right = &TreeNode{Val: v[i]}
			queue = append(queue, n.Right)
		}
		i++
	}
	return root
}

// dojo_listout writes a list as an int array, or "cycle" when it loops.
func dojo_listout(head *ListNode) string {
	seen := map[*ListNode]bool{}
	s := "["
	for n := head; n != nil; n = n.Next {
		if seen[n] {
			return "\\"cycle\\""
		}
		seen[n] = true
		if n != head {
			s += ","
		}
		s += dojo_int(n.Val)
	}
	return s + "]"
}

// dojo_treeout writes a tree as a level-order array with null and no trailing nulls ("cycle" when a node repeats).
func dojo_treeout(root *TreeNode) string {
	seen := map[*TreeNode]bool{}
	out := []string{}
	queue := []*TreeNode{root}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		if n == nil {
			out = append(out, "null")
			continue
		}
		if seen[n] {
			return "\\"cycle\\""
		}
		seen[n] = true
		out = append(out, dojo_int(n.Val))
		queue = append(queue, n.Left, n.Right)
	}
	for len(out) > 0 && out[len(out)-1] == "null" {
		out = out[:len(out)-1]
	}
	s := "["
	for i, x := range out {
		if i > 0 {
			s += ","
		}
		s += x
	}
	return s + "]"
}

func main() {
	dojo_tk.DojoHarness([]func() string{
${calls}
	})
}
`
}

/**
 * tk/internal/wire/limits.go for one run (security round 2 M-A): the limits are build constants, so
 * fd 5, which the learner can replace before a re-exec, carries the key only. `prog` is the binary's
 * real path, which wire removes at start (the one-instance check).
 */
export function wireLimits({ limits = LIMITS, prog }) {
  const u = n => String(Math.trunc(n))
  return `// Code generated by the Dojo runner. DO NOT EDIT.

package wire

const (
	maxMem        uint64 = ${u(limits.rssBytes)}
	maxGoroutines        = ${u(limits.maxGoroutines)}
	maxFileBytes  uint64 = ${u(limits.diskBytes + 1024 * 1024)}
	cpuSoft       uint64 = ${u(limits.cpuSoftSec)}
	cpuHard       uint64 = ${u(limits.cpuHardSec)}
	wallGuardMs          = ${u(Math.max(1, limits.wallMs + limits.wallGraceMs))}
	progPath             = ${JSON.stringify(prog)}
)
`
}

/** The learner's `package` clause line (1 when there is none). */
function packageLine(code) {
  const k = String(code).split('\n').findIndex(l => /^\s*package\s/.test(l))
  return k >= 0 ? k + 1 : 1
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Code review M1: a compile error as the learner should read it. Internal names (dojo_main.go, the
 * harness's helpers, temp and toolchain paths) never show; the common mistakes get a plain sentence.
 * Returns null for a line that is noise (go's "finding module" progress).
 */
function friendly(e, ctx) {
  const r = mapFriendly(e, ctx)
  return r && r !== e ? { ...r, mapped: true } : r
}

function mapFriendly(e, { pack, code }) {
  const m = e.message
  let x
  if (/^finding module for package /.test(m)) return null
  if (/found packages .*\(solution\.go\)/.test(m)) return { ...e, line: packageLine(code), col: 0, message: 'Your file must be package main' }
  if (/^main redeclared/.test(m)) return { ...e, message: 'Remove your func main: Dojo calls your function' }
  // L4: a name the generated harness declares (its helpers, its import names): only when the error
  // references the harness file; a learner's own dojo_x declared twice is just a redeclaration
  if ((x = /^(ListNode|TreeNode) redeclared in this block/.exec(m)) && /dojo_main\.go/.test(m)) {
    return { ...e, message: `Dojo already declares ${x[1]}: remove your own type ${x[1]}`, reserved: true }
  }
  if ((x = /^(\w+) (?:redeclared in this block|already declared through import of package)/.exec(m)) && /dojo_main\.go/.test(m)) {
    return { ...e, message: `${x[1]} is a reserved name in Dojo's runner`, reserved: true }
  }
  if ((x = /use of internal package (\S+) not allowed/.exec(m))) {
    const at = /solution\.go:(\d+)(?::(\d+))?/.exec(m)
    return { line: at ? e.offsetLine(Number(at[1])) : e.line, col: at?.[2] ? Number(at[2]) : 0, message: `Unknown import ${x[1]}: only dojo/tk is available` }
  }
  if ((x = /package (\S+) is not in std/.exec(m))) {
    return { ...e, message: x[1].startsWith('dojo/') ? `Unknown import ${x[1]}: only dojo/tk is available` : `Unknown import ${x[1]}: it is not in the standard library` }
  }
  if ((x = /cannot find module providing package ([^\s:]+)/.exec(m)) || (x = /no required module provides package ([^\s:;]+)/.exec(m))) {
    return { ...e, message: `Unknown import ${x[1]}: only the standard library and dojo/tk are available` }
  }
  if (e.harness && pack) {
    const fn = escapeRe(pack.fn)
    if ((x = new RegExp(`cannot use ${fn}\\(.*\\) \\(value of type (.+?)\\) as (\\S+) value`).exec(m))) {
      return { ...e, message: `${pack.fn} returns ${x[1]}, but it must return ${x[2]}: ${pack.signature}` }
    }
    if (new RegExp(`undefined: ${fn}\\b`).test(m)) return { ...e, message: `Define a function named ${pack.fn}: ${pack.signature}` }
    // L4: the name is declared, but not as the function (a type, a variable): one message, not one per case
    if (new RegExp(`cannot convert .* to type ${fn}$|${fn} \\(type\\) is not an expression|cannot call non-function ${fn}\\b`).test(m)) {
      return { ...e, message: `Define a function named ${pack.fn}: ${pack.signature}` }
    }
    // L4: extra (or no) results: the harness formats f(x), and f returns (int, error) or nothing
    if ((x = /too many arguments in call to dojo_\w+ have \((.+?)\) want \(/.exec(m))) {
      return { ...e, message: `${pack.fn} returns (${x[1]}), but it must return ${pack.returns}` }
    }
    if (new RegExp(`${fn}\\(.*\\) \\(no value\\) used as value`).test(m)) {
      return { ...e, message: `${pack.fn} returns nothing, but it must return ${pack.returns}` }
    }
    if (new RegExp(`(?:not enough|too many) arguments in call to ${fn}\\b|cannot use .* as .* value in argument to ${fn}\\b`).test(m)) {
      return { ...e, message: `${pack.fn} must take the parameters in: ${pack.signature}` }
    }
  }
  return e
}

/** Removes internal file names and paths from a message (the temp dir is stripped before parsing). */
function scrub(message, harness = false) {
  const m = message
    .replace(/\s*(?:\.\/)?dojo_main\.go:\d+(?::\d+)?:?/g, '')
    // a stray learner-file location (an own redeclaration's "other declaration" line)
    .replace(/\s*(?:\.\/)?solution\.go:\d+(?::\d+)?:?/g, '')
  // L4: no harness helper name survives in an error from the harness file (dojo_tk / dojo_strconv are
  // its import names). An error in the learner's file names the learner's own identifiers: kept.
  const h = harness
    ? m
      .replace(/ in argument to dojo_[\w.]+/g, '')
      .replace(/\bdojo_(tk|strconv)\./g, '$1.')
      .replace(/\bdojo_\w+/g, 'a Dojo helper')
    : m
  return h
    .replace(/\s*\((?:\/[^)]*)\)/g, '')
    .replace(/(?:\/[\w.@+-]+)+\/(?=[\w.-]+\.go\b)/g, '')
    .trim()
}

/**
 * go build output → [{line, col, message}] in the learner's own line numbers. `ctx` ({ tmp, pack,
 * code }) turns on the friendly messages and path stripping (code review M1); repeats (one per case
 * from the harness) are dropped (M2).
 */
export function parseCompileErrors(text, offset, fnLine = 1, ctx = null) {
  let t = String(text)
  if (ctx?.tmp) t = t.split(`${ctx.tmp}/mod/`).join('').split(`${ctx.tmp}/mod`).join('').split(ctx.tmp).join('')
  const offsetLine = n => Math.max(1, n - offset)
  const raw = []
  for (const rawLine of t.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = /^(?:\.\/)?((?:[\w.-]+\/)*[\w.-]+\.go):(\d+)(?::(\d+))?: (.*)$/.exec(line)
    if (m) {
      const [, file, ln, col, message] = m
      if (file === 'solution.go') raw.push({ line: offsetLine(Number(ln)), col: col ? Number(col) : 0, message })
      else raw.push({ line: fnLine, col: 0, message, harness: true })
    } else if (/^\t/.test(line) && raw.length) {
      raw[raw.length - 1].message += ` ${line.trim()}`
    } else if (line.trim() && !line.startsWith('#')) {
      raw.push({ line: fnLine, col: 0, message: line.trim().replace(/^go: /, '') })
    }
  }
  const out = []
  const seen = new Set()
  for (const r of raw) {
    let e = r
    if (ctx) {
      e = friendly({ ...r, offsetLine }, ctx)
      if (!e) continue
      e = { ...e, message: e.reserved ? e.message : scrub(e.message, !!e.harness) }
    }
    const message = e.harness && !e.mapped ? `Dojo could not call your function: ${e.message}` : e.message
    const err = { line: e.line, col: e.col, message }
    const k = `${err.line}\u0000${err.message}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(err)
  }
  return out
}

/** Go's escapes in an interpreted string or rune literal body (an import path may spell itself so). */
function unquoteGo(body) {
  return body.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([0-7]{3})|(.))/g, (_, x, u, U, o, c) => {
    if (x || u || U || o) {
      const n = parseInt(x ?? u ?? U ?? o, x || u || U ? 16 : 8)
      try { return String.fromCodePoint(n) } catch { return '' }
    }
    return { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[c] ?? c
  })
}

/**
 * The import paths a Go file declares, with their lines: a linear tokenizer that skips comments,
 * strings and runes, then reads `import "p"`, `import name "p"` and `import ( … )` blocks. Paths are
 * unquoted as the compiler does (raw strings, \x / \u / octal escapes).
 */
export function importPaths(code) {
  const src = String(code)
  const toks = []
  let line = 1
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === '\n') { line++; i++; continue }
    if (/\s/.test(c)) { i++; continue }
    if (src.startsWith('//', i)) { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      let k = i + 1
      while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1
      if (c === '"') toks.push({ t: 's', v: unquoteGo(src.slice(i + 1, k)), line })
      else toks.push({ t: 'p', v: 'rune', line })
      i = k + 1
      continue
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      const stop = end < 0 ? src.length : end
      toks.push({ t: 's', v: src.slice(i + 1, stop).replace(/\r/g, ''), line })
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++
      i = stop + 1
      continue
    }
    const w = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i, i + 256))
    if (w) { toks.push({ t: 'i', v: w[0], line }); i += w[0].length; continue }
    toks.push({ t: 'p', v: c, line })
    i++
  }
  const out = []
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t !== 'i' || toks[k].v !== 'import') continue
    if (toks[k + 1]?.v === '(' && toks[k + 1].t === 'p') {
      for (k += 2; k < toks.length && !(toks[k].t === 'p' && toks[k].v === ')'); k++) if (toks[k].t === 's') out.push({ path: toks[k].v, line: toks[k].line })
    } else {
      const j = toks[k + 1]?.t === 's' ? k + 1 : k + 2
      if (toks[j]?.t === 's') out.push({ path: toks[j].v, line: toks[j].line })
    }
  }
  return out
}

/**
 * R5: packages learner code may not import. os/signal could ignore SIGURG (turning off async
 * preemption) and so starve the program's own CPU and wall guards (tk/internal/wire) once its server
 * is gone; DP code never needs it.
 */
const REFUSED_IMPORTS = [/^os\/signal(?:\/|$)/]
/**
 * SEC-D-02: syscall and unsafe are refused too. On arm64 macOS, syscall.Syscall with a negative trap number is a
 * Mach trap, so pure Go reached the bootstrap port and any launchd service (the profile now denies mach-lookup as
 * well: two walls). DP code never needs either. `allowRaw` is for the runner's own attack tests only (dojo-server
 * --test-allow-raw-imports, refused with --real): they need raw system calls to prove the sandbox holds.
 */
const RAW_IMPORTS = [/^syscall(?:\/|$)/, /^unsafe$/]
export const RAW_IMPORT_MESSAGE = 'Dojo runs your code without raw system calls or unsafe memory access'

/**
 * Directives the runner refuses before building (security M1): //go:linkname would reach the run key
 * in tk/internal/wire (and runtime internals). Reported as compile errors at the learner's line.
 */
export function refusedDirectives(code, { allowRaw = false } = {}) {
  const errors = []
  String(code).split('\n').forEach((l, k) => {
    if (/go:linkname/.test(l)) errors.push({ line: k + 1, col: 0, message: '//go:linkname is not allowed in Dojo' })
    if (/^\s*(?:import\s*(?:\(\s*)?)?(?:\w+\s+)?"C"\s*\)?\s*(?:\/\/.*)?$/.test(l)) errors.push({ line: k + 1, col: 0, message: 'cgo (import "C") is not available in Dojo' })
  })
  for (const { path, line } of importPaths(code)) {
    if (REFUSED_IMPORTS.some(re => re.test(path))) errors.push({ line, col: 0, message: `import ${JSON.stringify(path)} is not available in Dojo` })
    else if (!allowRaw && RAW_IMPORTS.some(re => re.test(path))) errors.push({ line, col: 0, message: `import ${JSON.stringify(path)} is not available: ${RAW_IMPORT_MESSAGE}` })
  }
  return errors
}

/** The learner's line declaring the pack's function (where harness-side errors point), else 1. */
export function functionLine(code, fn) {
  const lines = String(code).split('\n')
  const k = lines.findIndex(l => new RegExp(`^\\s*func\\s+${fn}\\s*\\(`).test(l))
  return k >= 0 ? k + 1 : 1
}

// ---------------------------------------------------------------- toolkit events

/** Splits a wire line into tokens: JSON strings and bare words. */
function tokens(line) {
  const out = []
  let i = 0
  while (i < line.length) {
    if (line[i] === ' ') { i++; continue }
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1
      out.push(JSON.parse(line.slice(i, j + 1)))
      i = j + 1
    } else {
      let j = i
      while (j < line.length && line[j] !== ' ') j++
      out.push(line.slice(i, j))
      i = j
    }
  }
  return out
}

const int = s => {
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error('not a number')
  return n
}

/**
 * Keeps the lines that start with the run key (and a space), with the key removed; drops the rest
 * (security M1: the learner can write to fd 3 and fd 4 but cannot read the key). A null key keeps
 * every line unchanged (for parser tests).
 */
export function framedLines(text, key) {
  const lines = String(text).split('\n')
  if (key == null) return lines
  const prefix = `${key} `
  return lines.filter(l => l.startsWith(prefix)).map(l => l.slice(prefix.length))
}

/** fd 3's text → { steps, truncated } (C-RUNNER §3: at most maxEvents steps). Malformed or unframed lines are skipped. */
export function parseEvents(text, maxEvents = LIMITS.maxEvents, key = null) {
  const steps = []
  const rules = new Map()
  const fns = new Map()
  const tables = new Map()
  let truncated = false
  let pendingCase = null
  for (const line of framedLines(text, key)) {
    if (!line) continue
    let tk
    try { tk = line.startsWith('V ') ? ['V'] : tokens(line) } catch { continue }
    const [tag, ...a] = tk
    try {
      if (tag === 'R') { rules.set(int(a[0]), String(a[1])); continue }
      if (tag === 'F') { fns.set(int(a[0]), String(a[1])); continue }
      if (tag === 'Z') { truncated = true; continue }
      if (tag === 'C') { pendingCase = int(a[0]); continue }
      let ev = null
      if (tag === 'V') {
        // C-VISUAL §2: the JSON object is the step itself. Addendum 3: one the page cannot draw is still a
        // step ("not shown"), so no event is dropped and no case marker is orphaned
        let obj = null
        try { obj = JSON.parse(line.slice(2)) } catch { obj = null }
        ev = familyStep(obj) ?? unshownStep(obj)
      } else if (tag === 'T') {
        ev = { op: 'table', t: int(a[0]), rows: int(a[1]), cols: int(a[2]), name: String(a[3]) }
        tables.set(ev.t, ev.name)
      } else if (tag === 'S') {
        const nd = int(a[5])
        const deps = []
        for (let k = 0; k < nd; k++) deps.push([int(a[6 + 2 * k]), int(a[7 + 2 * k])])
        const rule = int(a[4])
        ev = { op: 'set', t: int(a[0]), i: int(a[1]), j: int(a[2]), v: int(a[3]), deps }
        if (rule >= 0 && rules.has(rule)) ev.rule = rules.get(rule)
      } else if (tag === 'G') {
        ev = { op: 'get', t: int(a[0]), i: int(a[1]), j: int(a[2]), v: int(a[3]) }
      } else if (tag === 'E' || tag === 'H') {
        const n = int(a[1])
        ev = { op: tag === 'E' ? 'enter' : 'hit', fn: fns.get(int(a[0])) ?? '?', args: a.slice(2, 2 + n).map(int) }
      } else if (tag === 'X') {
        ev = { op: 'exit', v: int(a[0]) }
      } else if (tag === 'L') {
        ev = { op: 'link', fn: String(a[0]), table: String(a[1]) }
      }
      if (!ev) continue
      if (steps.length >= maxEvents) { truncated = true; continue }
      // M5: the case's first event carries its id, so the view can reset its call stack there.
      if (pendingCase !== null) { ev.case = pendingCase; pendingCase = null }
      steps.push(ev)
    } catch { /* a malformed (e.g. cut-off) line */ }
  }
  return { steps, truncated }
}

// ---------------------------------------------------------------- sandbox and toolchain

const sbString = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * The run's macOS sandbox profile: no network at all, no process creation besides the program itself,
 * no writes outside the run's temp dir, and no reads of the real home, DOJO_HOME or the app's own
 * directory (the packs' ref.go above all: I2, for an app that does not live under HOME), unless inside tmp.
 * H2: signals only to itself (`(deny signal (target others))` alone does not stop kill(2) under
 * `allow default`), no proc_info on other processes, and sysctl reads only of what Go's runtime needs
 * at start (hw.* for the page size and CPU count, kern.os* for the OS release).
 * Security M2: no chflags and no chmod, even inside tmp, so the program cannot make its temp dir
 * hard to remove (removeTree copes with what is left, such as a directory created with mode 0).
 * Security round 2 M-A: the program may unlink its own binary (tk/internal/wire does so before any
 * learner code runs) but never write, replace, rename onto or link that path, so the one path it may
 * exec is gone by the time the learner's code could try to exec itself again.
 */
export function sandboxProfile({ tmp, prog, home = realOr(homedir()), dojoHome = null, appDir = realOr(APP_DIR) }) {
  const denyRead = [home, dojoHome, appDir, ...SHARED_READ_DENY].filter(Boolean).map(p => `(subpath ${sbString(p)})`).join(' ')
  return `(version 1)
(allow default)
(deny network*)
(deny system-socket)
(deny mach-lookup)
(deny mach-register)
(deny iokit-open)
(deny ipc-posix*)
(deny ipc-sysv*)
(deny file-link)
(deny process-fork)
(deny process-exec)
(allow process-exec (literal ${sbString(prog)}))
(deny signal)
(allow signal (target self))
(deny process-info*)
(allow process-info* (target self))
(deny sysctl-read)
(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name-prefix "kern.os"))
(deny file-read* ${denyRead})
(allow file-read* (subpath ${sbString(tmp)}))
(deny file-write*)
(allow file-write* (subpath ${sbString(tmp)}) (literal "/dev/null"))
(deny file-write* (literal ${sbString(prog)}))
(allow file-write-unlink (literal ${sbString(prog)}))
(deny file-write-flags)
(deny file-write-mode)
`
}

/**
 * SEC-D-02: besides the user's home, DOJO_HOME and the app, the program reads nothing under these: other users'
 * homes and /Users/Shared, mounted and network volumes, and every app's temp and cache dirs (the run's own temp
 * dir, which is under /private/var/folders, is allowed back after them).
 */
const SHARED_READ_DENY = ['/Users', '/Volumes', '/private/var/folders', '/private/tmp']

/**
 * The build's profile: the compiler may run its tools, but has no network, writes only tmp and the
 * cache, and cannot read the app's directory (a //go:embed or an import cannot reach ref.go: I2).
 */
export function buildProfile({ tmp, cache, appDir = realOr(APP_DIR) }) {
  return `(version 1)
(allow default)
(deny network*)
(deny file-read* (subpath ${sbString(appDir)}))
(allow file-read* (subpath ${sbString(tmp)}) (subpath ${sbString(cache)}))
(deny file-write*)
(allow file-write* (subpath ${sbString(tmp)}) (subpath ${sbString(cache)}) (literal "/dev/null"))
`
}

/** Gives the owner rwx on every directory and rw on every file under p, never following a symlink. */
async function makeRemovable(p) {
  let st
  try { st = await lstat(p) } catch { return }
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) {
    try { await chmod(p, 0o700) } catch { /* not ours */ }
    let names = []
    try { names = await readdir(p) } catch { /* unreadable */ }
    for (const n of names) await makeRemovable(join(p, n))
  } else if ((st.mode & 0o600) !== 0o600) {
    try { await chmod(p, 0o600) } catch { /* not ours */ }
  }
}

/**
 * Security M2: removes a run's temp dir whatever the program left in it (immutable or append-only
 * flags, read-only or mode-000 directories). Never rejects; resolves false, after logging, when the
 * tree could not be removed (a leaked temp dir). L2: asynchronous throughout (fs/promises and an
 * async chflags), so a big tree never blocks the event loop and /db stays responsive.
 */
export async function removeTree(dir, log = () => {}) {
  try {
    await rm(dir, { recursive: true, force: true })
    return true
  } catch { /* fall through to the slow path */ }
  await new Promise(resolve => {
    try {
      execFile('/usr/bin/chflags', ['-R', '-P', 'nouchg,nouappnd', dir], { timeout: 10_000 }, () => resolve(undefined))
    } catch { resolve(undefined) }
  })
  await makeRemovable(dir)
  try {
    await rm(dir, { recursive: true, force: true })
    return true
  } catch (e) {
    try { log(`runner: leaked temp dir ${dir}: ${e instanceof Error ? e.message : e}`) } catch { /* ignore */ }
    return false
  }
}

/** `ps` rows for every process: { pid, ppid, pgid, uid, command } (null when ps fails). */
function listProcesses() {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,uid=,command='], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => {
      if (e) return resolve(null)
      const rows = []
      for (const l of String(out).split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(l)
        if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]), command: m[5].trim() })
      }
      resolve(rows)
    })
  })
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

/**
 * R5: which run dir under `root` a process belongs to, or null. Only two exact command lines count,
 * both naming a binary inside `<root>/dojo-run-*`: the program itself (sandbox-exec execs it, so its
 * command line is exactly `<run>/prog`) and the build (`<go> build -o <run>/prog .`). Nothing else a
 * user runs has such a command line, so the sweep never matches the user's other processes.
 */
export function runOfProcess(command, root) {
  const esc = escapeRe(root)
  const m = new RegExp(`^${esc}/(${RUN_PREFIX}[^/\\s]+)/prog$`).exec(command) ??
    new RegExp(`^\\S+ build -o ${esc}/(${RUN_PREFIX}[^/\\s]+)/prog \\.$`).exec(command)
  return m ? m[1] : null
}

/**
 * L2 + R5: the startup (and shutdown) sweep of the runner's temp root `dir` (the OS temp dir).
 *   1. Kills orphaned runs: processes of this user whose command line is a run's (runOfProcess) and
 *      whose parent is gone (ppid 1), or, at shutdown, whose parent is this server. The whole group
 *      when the process leads it (the runner spawns each in its own session), then waits until it is
 *      gone. A run with a live parent (another server's run in flight) is left alone.
 *   2. Removes `dojo-run-*` directories of this user, never one with a process still in it: those of
 *      a server that is gone (the pid in the name is dead; at shutdown, this server's own), and any
 *      older than `maxAgeMs` (what an older server, which named its dirs without a pid, left behind).
 * Resolves with the number of dirs removed; never rejects.
 */
export async function sweepStaleRunDirs(dir = tmpdir(), maxAgeMs = 10 * 60_000, log = () => {}, { shutdown = false, selfPid = process.pid } = {}) {
  const root = realOr(dir)
  const uid = process.getuid?.() ?? -1
  const busy = new Set()
  const procs = await listProcesses()
  if (procs) {
    const victims = []
    for (const p of procs) {
      if (p.uid !== uid || p.pid === selfPid) continue
      const run = runOfProcess(p.command, root)
      if (!run) continue
      if (p.ppid === 1 || (shutdown && p.ppid === selfPid)) victims.push({ ...p, run })
      else busy.add(run)
    }
    for (const v of victims) {
      try { process.kill(v.pgid === v.pid ? -v.pid : v.pid, 'SIGKILL') } catch { /* gone */ }
      try { log(`runner: killed orphaned run process ${v.pid} (${v.run})`) } catch { /* ignore */ }
    }
    for (const v of victims) {
      const t0 = Date.now()
      while (pidAlive(v.pid) && Date.now() - t0 < 2000) await pause(20)
      if (pidAlive(v.pid)) busy.add(v.run)
    }
  }
  let removed = 0
  let names = []
  try { names = await readdir(root) } catch { return 0 }
  for (const n of names) {
    if (!n.startsWith(RUN_PREFIX) || busy.has(n)) continue
    const p = join(root, n)
    try {
      const st = await lstat(p)
      if (!st.isDirectory() || (uid >= 0 && st.uid !== uid)) continue
      const owner = /^dojo-run-(\d+)-[A-Za-z0-9]{6}$/.exec(n)?.[1]
      const ownerGone = owner !== undefined && (Number(owner) === selfPid ? shutdown : !pidAlive(Number(owner)))
      // without a process list a dir is only provably stale by its age
      if (!(Date.now() - st.mtimeMs > maxAgeMs || (procs && ownerGone))) continue
      if (await removeTree(p, log)) removed++
    } catch { /* gone, or not ours */ }
  }
  return removed
}

function realOr(p) {
  try { return realpathSync(p) } catch { return p }
}

function isExecutable(p) {
  try {
    accessSync(p, constants.X_OK)
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** DOJO_GO_BIN when set (and only it), else `go` on PATH, else the usual install places (a Dock launch has a bare PATH). */
export function resolveGo(env = process.env) {
  const want = env.DOJO_GO_BIN
  if (want) {
    if (want.includes('/')) return isExecutable(want) ? want : null
    for (const dir of String(env.PATH ?? '').split(delimiter)) if (dir && isExecutable(join(dir, want))) return join(dir, want)
    return null
  }
  for (const dir of String(env.PATH ?? '').split(delimiter)) if (dir && isExecutable(join(dir, 'go'))) return join(dir, 'go')
  return GO_FALLBACKS.find(isExecutable) ?? null
}

function killGroup(child, signal = 'SIGKILL') {
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* gone */ } }
}

const pause = ms => new Promise(r => setTimeout(r, ms))

/**
 * R5: SIGKILLs process group `pgid` until it is gone (kill(-pgid, 0) fails with ESRCH), for at most
 * `ms`. Called after the child's 'close' (its leader already reaped by Node's waitpid), so it confirms
 * that nothing else in the group survived before the temp dir is removed. Resolves whether it is gone.
 */
export async function reapGroup(pgid, ms = 2000) {
  if (!pgid) return true
  const t0 = Date.now()
  for (;;) {
    try { process.kill(-pgid, 0) } catch (e) { return e?.code === 'ESRCH' || e?.code === 'EPERM' }
    try { process.kill(-pgid, 'SIGKILL') } catch { /* raced to exit */ }
    if (Date.now() - t0 > ms) return false
    await pause(10)
  }
}

/** Calls f once when signal aborts (at once if it already has); returns the unsubscribe. */
function onAbort(signal, f) {
  if (!signal) return () => {}
  if (signal.aborted) { f(); return () => {} }
  signal.addEventListener('abort', f, { once: true })
  return () => signal.removeEventListener('abort', f)
}

function rssBytes(pid) {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 1000 }, (e, out) => {
      const kb = Number(String(out).trim())
      resolve(e || !Number.isFinite(kb) ? 0 : kb * 1024)
    })
  })
}

/** The total RSS of every process in process group `pid` (0 when none is left or ps fails). */
export function groupRssBytes(pid) {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-A', '-o', 'pgid=,rss='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => {
      if (e) return resolve(0)
      let kb = 0
      for (const l of String(out).split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)/.exec(l)
        if (m && Number(m[1]) === pid) kb += Number(m[2])
      }
      resolve(kb * 1024)
    })
  })
}

/**
 * L3: polls the RSS of process group `pid` every pollMs; past capBytes it kills the whole group and
 * calls onOver (once). Returns stop().
 */
export function watchGroupRss({ pid, capBytes, pollMs, onOver, onSample = () => {} }) {
  let stopped = false
  let busy = false
  const timer = setInterval(async () => {
    if (busy || stopped) return
    busy = true
    try {
      const b = await groupRssBytes(pid)
      if (stopped) return
      onSample(b)
      if (b > capBytes) {
        stopped = true
        clearInterval(timer)
        try { process.kill(-pid, 'SIGKILL') } catch { /* gone */ }
        onOver(b)
      }
    } finally {
      busy = false
    }
  }, pollMs)
  return () => { stopped = true; clearInterval(timer) }
}

/** Runs the compiler; resolves { ok, output }, with `memory: true` when the RSS watchdog stopped it. */
function build({ goBin, tmp, cache, gopath, limits, signal }) {
  return new Promise(resolve => {
    const profile = join(tmp, 'build.sb')
    writeFileSync(profile, buildProfile({ tmp, cache }))
    const env = {
      PATH: `${dirname(goBin)}:/usr/bin:/bin`, HOME: join(tmp, 'home'), TMPDIR: join(tmp, 'home'),
      GOCACHE: cache, GOPATH: gopath, GOMODCACHE: join(gopath, 'pkg', 'mod'),
      GOPROXY: 'off', GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'local', GOWORK: 'off', GOSUMDB: 'off', GOENV: 'off',
      GO111MODULE: 'on', CGO_ENABLED: '0', GOTELEMETRY: 'off',
    }
    const useSandbox = isExecutable(SANDBOX_EXEC)
    const cmd = SANDBOX_EXEC
    // ulimit -f: no file the build writes (the binary above all: a huge static array links a huge
    // binary) may pass buildFileBytes; the linker then fails with "file too large".
    const blocks = Math.ceil(limits.buildFileBytes / 512)
    const sh = ['/bin/sh', '-c', `ulimit -f ${blocks} && exec "$0" "$@"`, goBin, 'build', '-o', join(tmp, 'prog'), '.']
    const args = useSandbox ? ['-f', profile, ...sh] : sh.slice(1)
    const child = spawn(useSandbox ? cmd : '/bin/sh', args, { cwd: join(tmp, 'mod'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const add = c => { if (output.length < 64 * 1024) output += c }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    let timedOut = false
    let memory = false
    let cancelled = false
    const timer = setTimeout(() => { timedOut = true; killGroup(child) }, limits.compileMs)
    const unAbort = onAbort(signal, () => { cancelled = true; killGroup(child) })
    const stopWatch = child.pid
      ? watchGroupRss({ pid: child.pid, capBytes: limits.buildRssBytes, pollMs: limits.buildRssPollMs, onOver: () => { memory = true } })
      : () => {}
    child.on('error', e => { clearTimeout(timer); stopWatch(); unAbort(); resolve({ ok: false, output: e.message, spawnError: true }) })
    child.on('close', async code => {
      clearTimeout(timer)
      stopWatch()
      unAbort()
      killGroup(child) // nothing the build started may outlive it
      const gone = await reapGroup(child.pid)
      if (!gone) resolve({ ok: false, output: '', alive: true })
      else if (cancelled) resolve({ ok: false, output: '', cancelled: true })
      else if (memory) resolve({ ok: false, output: '', memory: true })
      else if (timedOut) resolve({ ok: false, output: `compiling took longer than ${limits.compileMs / 1000} s` })
      else resolve({ ok: code === 0, output })
    })
  })
}

/**
 * Disk use under dir (allocated blocks, so a sparse file counts what it really takes), never following
 * symlinks. Stops counting past maxEntries entries, which itself counts as over.
 */
export function treeUsage(dir, maxEntries = LIMITS.diskEntries) {
  let bytes = 0
  let entries = 0
  const stack = [dir]
  while (stack.length) {
    const p = stack.pop()
    let st
    try { st = lstatSync(p) } catch { continue }
    if (++entries > maxEntries) return { bytes, entries, over: true }
    bytes += (st.blocks ?? 0) * 512
    if (st.isDirectory()) {
      let names = []
      try { names = readdirSync(p) } catch { /* unreadable */ }
      for (const n of names) stack.push(join(p, n))
    }
  }
  return { bytes, entries, over: false }
}

/**
 * treeUsage without blocking the event loop (L2), for the build cache, which can hold a GiB in many
 * thousands of files. Each directory's entries are lstat'ed in parallel batches.
 */
export async function treeUsageAsync(dir, maxEntries = LIMITS.diskEntries) {
  let bytes = 0
  let entries = 0
  const dirs = []
  try {
    const st = await lstat(dir)
    entries = 1
    bytes = (st.blocks ?? 0) * 512
    if (st.isDirectory()) dirs.push(dir)
  } catch {
    return { bytes, entries, over: false }
  }
  while (dirs.length) {
    const d = dirs.pop()
    let names = []
    try { names = await readdir(d) } catch { continue }
    for (let k = 0; k < names.length; k += 64) {
      const batch = names.slice(k, k + 64).map(n => join(d, n))
      const sts = await Promise.all(batch.map(p => lstat(p).catch(() => null)))
      for (let i = 0; i < batch.length; i++) {
        const st = sts[i]
        if (!st) continue
        if (++entries > maxEntries) return { bytes, entries, over: true }
        bytes += (st.blocks ?? 0) * 512
        if (st.isDirectory()) dirs.push(batch[i])
      }
    }
  }
  return { bytes, entries, over: false }
}

/** Runs the binary in the sandbox with the wall, output, memory and disk limits. */
function execute({ tmp, limits, dojoHome, key, signal }) {
  return new Promise(resolve => {
    const prog = join(tmp, 'prog')
    const profile = join(tmp, 'run.sb')
    writeFileSync(profile, sandboxProfile({ tmp, prog, dojoHome }))
    const env = { PATH: '/usr/bin:/bin', HOME: join(tmp, 'home'), TMPDIR: join(tmp, 'home'), LANG: 'C.UTF-8' }
    // The disk baseline, taken before the start, leaves out the binary: the program removes it at
    // start (M-A), which would otherwise give it the binary's size in extra room.
    let progBytes = 0
    try { progBytes = (lstatSync(prog).blocks ?? 0) * 512 } catch { /* no binary */ }
    const diskBase = treeUsage(tmp, limits.diskEntries).bytes - progBytes
    const child = spawn(SANDBOX_EXEC, ['-f', profile, prog], { cwd: join(tmp, 'home'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
    // The run key (and only the key: the limits are build constants, see wireLimits) goes in on fd 5,
    // which tk/internal/wire reads and closes before the learner's code runs.
    child.stdio[5].on('error', () => { /* the program died before reading it */ })
    child.stdio[5].end(`${key}\n`)
    const started = Date.now()
    const out = []
    let stdoutBytes = 0
    let stderr = ''
    const events = []
    let eventBytes = 0
    let results = ''
    let killed = null
    const kill = why => {
      if (killed) return
      killed = why
      killGroup(child)
    }
    // Addendum 1 Q5: the 1 MiB cap is on stdout only; events are capped by count inside tk (20000 lines).
    const overOutput = () => { if (stdoutBytes > limits.outputBytes) kill('output') }
    child.stdout.on('data', c => {
      if (stdoutBytes < limits.stdoutCap) out.push(c)
      stdoutBytes += c.length
      overOutput()
    })
    child.stderr.on('data', c => { if (stderr.length < limits.stderrCap) stderr += c.toString('utf8') })
    let keptBytes = 0
    child.stdio[3].on('data', c => {
      eventBytes += c.length
      // keep what fits under the cap, even part of a chunk (eventText drops the cut line)
      const room = limits.eventBytes - keptBytes
      if (room <= 0) return
      const part = c.length <= room ? c : c.subarray(0, room)
      events.push(part)
      keptBytes += part.length
    })
    // M11: anything past the byte cap is dropped, and the run is then truncated. Only whole lines
    // count: a line cut by the cap (or by a kill) is dropped rather than misread.
    const eventText = () => {
      const t = Buffer.concat(events).toString('utf8')
      const nl = t.lastIndexOf('\n')
      return nl < 0 ? '' : t.slice(0, nl + 1)
    }
    child.stdio[4].on('data', c => { if (results.length < 1024 * 1024) results += c.toString('utf8') })
    const wall = setTimeout(() => kill('timeout'), limits.wallMs)
    // R5: a cancelled run (the client went away, the server is stopping) is killed at once
    const unAbort = onAbort(signal, () => kill('cancelled'))
    // Disk: the temp dir may grow by diskBytes in total (polled; checked once more after the exit).
    const overDisk = () => {
      const u = treeUsage(tmp, limits.diskEntries)
      return u.over || u.bytes - diskBase > limits.diskBytes
    }
    // L2: the poll walks the tree asynchronously (a sync pass cost ~30 ms of every 100 ms)
    let diskBusy = false
    const disk = setInterval(async () => {
      if (diskBusy || killed) return
      diskBusy = true
      try {
        const u = await treeUsageAsync(tmp, limits.diskEntries)
        if (!killed && (u.over || u.bytes - diskBase > limits.diskBytes)) kill('disk')
      } finally { diskBusy = false }
    }, limits.diskPollMs)
    let polling = false
    const poll = setInterval(async () => {
      if (polling || killed) return
      polling = true
      if (await rssBytes(child.pid) > limits.rssBytes) kill('memory')
      polling = false
    }, limits.rssPollMs)
    child.on('error', e => {
      clearTimeout(wall)
      clearInterval(poll)
      clearInterval(disk)
      unAbort()
      resolve({ spawnError: e.message })
    })
    child.on('close', async (code, sig) => {
      clearTimeout(wall)
      clearInterval(poll)
      clearInterval(disk)
      unAbort()
      // R5: Node has reaped the program (waitpid); confirm its group is empty before the caller
      // removes the temp dir, so a dir is never gone while something of the run still lives
      killGroup(child)
      const alive = !(await reapGroup(child.pid))
      if (!killed && overDisk()) killed = 'disk'
      const stdout = Buffer.concat(out).subarray(0, limits.stdoutCap).toString('utf8')
      resolve({ code, signal: sig, alive, killed, stdout, stdoutTruncated: stdoutBytes > limits.stdoutCap, stderr, events: eventText(), eventsCut: eventBytes > limits.eventBytes, results, ms: Date.now() - started })
    })
  })
}

/**
 * fd 4's text → { byId, limit, done }; only lines framed with the run key count (security M1).
 * `limit` is what tk/internal/wire stopped the program for: "memory" or "goroutines".
 */
export function parseResults(text, key = null) {
  const out = { byId: new Map(), limit: null, done: false }
  for (const line of framedLines(text, key)) {
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (typeof r.limit === 'string') out.limit ??= r.limit
    else if (r.done) out.done = true
    else if (Number.isInteger(r.id)) out.byId.set(r.id, r)
  }
  return out
}

/** What a program that died without reporting (a fatal runtime error, an os.Exit) shows the learner. */
export function crashMessage({ stderr = '', code = null, signal = null }) {
  if (/stack overflow|goroutine stack exceeds/.test(stderr)) return 'stack overflow (infinite recursion?)'
  if (/thread exhaustion|-thread limit|failed to create new OS thread/.test(stderr)) return 'your program started too many OS threads'
  const msg = String(stderr).trim().split('\n').filter(l => l && !/^goroutine |^\t|^\s*$|^runtime stack:|^\[signal /.test(l)).slice(0, 3).join(' ')
  if (msg) return msg
  return code === 0 ? 'the program stopped before every case ran (os.Exit?)' : `the program exited with ${code ?? signal}`
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The first frame in the learner's file in a Go stack trace, as a learner line number. */
export function stackLine(stack, offset) {
  const m = /\/solution\.go:(\d+)/.exec(String(stack))
  return m ? Math.max(1, Number(m[1]) - offset) : null
}

const cacheCheckedAt = new Map()

/**
 * GOCACHE growth: every learner build adds its objects to the shared cache under DOJO_HOME, which Go
 * itself only trims of entries unused for days. At most every cacheCheckMs, a cache over cacheBytes
 * is removed outright (the next build re-warms it: the standard library and tk in a few seconds).
 * L2: asynchronous (the walk and the removal never block the event loop), and createRunner runs it
 * after the run's reply, before the next build may start. Never rejects.
 */
export async function trimCache(cache, limits = LIMITS, log = () => {}, now = Date.now()) {
  if (now - (cacheCheckedAt.get(cache) ?? -Infinity) < limits.cacheCheckMs) return false
  cacheCheckedAt.set(cache, now)
  try {
    const u = await treeUsageAsync(cache, 2_000_000)
    if (!u.over && u.bytes <= limits.cacheBytes) return false
    const ok = await removeTree(cache, log)
    try { log(`runner: build cache ${cache} over ${limits.cacheBytes >> 20} MiB: ${ok ? 'cleaned' : 'could not clean it'}`) } catch { /* ignore */ }
    return ok
  } catch {
    return false
  }
}

/**
 * One run: { pack, code, mode } → the C-RUNNER §2 response body. `home` is DOJO_HOME (the build cache
 * lives in it). Never throws for anything the learner's code does.
 */
export async function runGo({ pack, code, mode }, { home, env = process.env, limits = LIMITS, log = () => {}, signal, allowRawImports = false } = {}) {
  const t0 = Date.now()
  const cases = mode === 'submit' ? pack.cases : pack.cases.slice(0, EXAMPLES)
  const base = cases.map((c, k) => ({ id: k + 1, call: callText(pack, c.args), expected: c.expected, got: null, pass: false }))
  const reply = (status, extra = {}) => ({ status, cases: base, errors: [], stdout: '', steps: [], truncated: false, ms: Date.now() - t0, ...extra })
  const goBin = resolveGo(env)
  if (!goBin) return reply('no_toolchain')
  if (!isExecutable(SANDBOX_EXEC)) return reply('runtime_error', { errors: [{ line: 1, col: 0, message: 'sandbox-exec is missing: the Go runner needs macOS' }] })
  const { source, offset } = prepareSource(code)
  const fnLine = functionLine(code, pack.fn)
  const refused = refusedDirectives(code, { allowRaw: allowRawImports })
  if (refused.length) return reply('compile_error', { errors: refused })
  if (signal?.aborted) return reply('runtime_error', { errors: [{ line: 1, col: 0, message: CANCELLED }] })
  // R5: the owner's pid is in the name, so a sweep can tell a dead server's runs from a live one's
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), `${RUN_PREFIX}${process.pid}-`)))
  let keep = false
  try {
    mkdirSync(join(tmp, 'mod', 'tk'), { recursive: true })
    // Go's telemetry mode lives under the (temp) HOME. "off" keeps the go command from starting its
    // background telemetry child, which would outlive the build and write into the removed temp dir.
    mkdirSync(join(tmp, 'home', 'Library', 'Application Support', 'go', 'telemetry'), { recursive: true })
    writeFileSync(join(tmp, 'home', 'Library', 'Application Support', 'go', 'telemetry', 'mode'), 'off')
    writeFileSync(join(tmp, 'mod', 'go.mod'), 'module dojo\n\ngo 1.22\n')
    cpSync(TK_DIR, join(tmp, 'mod', 'tk'), { recursive: true, filter: src => !src.endsWith('_test.go') })
    // RLIMIT_FSIZE (maxFileBytes) is 1 MiB over the total disk cap, so a program that hits it is over the total too.
    writeFileSync(join(tmp, 'mod', 'tk', 'internal', 'wire', 'limits.go'), wireLimits({ limits, prog: join(tmp, 'prog') }))
    writeFileSync(join(tmp, 'mod', 'solution.go'), source)
    writeFileSync(join(tmp, 'mod', 'dojo_main.go'), harnessMain(pack, cases, limits))
    // Sandbox profiles match real paths (/var is /private/var on macOS).
    mkdirSync(join(home, 'gocache'), { recursive: true })
    const realHome = realpathSync(home)
    const cache = join(realHome, 'gocache')
    const gopath = join(realHome, 'gopath')
    const b = await build({ goBin, tmp, cache, gopath, limits, signal })
    if (b.alive) keep = true
    if (b.spawnError) return reply('no_toolchain')
    if (b.cancelled || b.alive || signal?.aborted) return reply('runtime_error', { errors: [{ line: 1, col: 0, message: CANCELLED }] })
    if (b.memory) return reply('compile_error', { errors: [{ line: 1, col: 0, message: 'the build used too much memory' }] })
    if (!b.ok) return reply('compile_error', { errors: parseCompileErrors(b.output, offset, fnLine, { tmp, pack, code }) })
    const key = randomBytes(24).toString('hex')
    const r = await execute({ tmp, limits, dojoHome: realHome, key, signal })
    if (r.alive) keep = true
    if (r.killed === 'cancelled') return reply('runtime_error', { errors: [{ line: 1, col: 0, message: CANCELLED }] })
    if (r.spawnError) return reply('runtime_error', { errors: [{ line: 1, col: 0, message: r.spawnError }] })
    const res = parseResults(r.results, key)
    const parsed = parseEvents(r.events, limits.maxEvents, key)
    const steps = parsed.steps
    const truncated = parsed.truncated || r.eventsCut
    const errors = []
    let panicked = false
    const out = base.map(c => {
      const got = res.byId.get(c.id)
      if (!got) return c
      if ('panic' in got) {
        panicked = true
        const line = stackLine(got.stack, offset) ?? fnLine
        // C-VISUAL §2: a toolkit misuse reads as its own message ("tk: …"), each distinct one once
        const message = /^tk: /.test(String(got.panic)) ? String(got.panic) : `panic: ${got.panic} (${c.call})`
        if (!errors.some(e => e.line === line && e.message === message)) errors.push({ line, col: 0, message })
        return c
      }
      return { ...c, got: got.got, pass: deepEqual(got.got, c.expected) }
    })
    let status = 'ok'
    // R5: "cpu" and "wall" are the program's own guards (RLIMIT_CPU, the compiled-in wall guard)
    if (r.killed === 'timeout' || res.limit === 'cpu' || res.limit === 'wall') status = 'timeout'
    else if (r.killed === 'output') status = 'output_limit'
    else if (r.killed === 'memory' || res.limit === 'memory') status = 'memory_limit'
    else if (r.killed === 'disk') {
      status = 'runtime_error'
      errors.push({ line: fnLine, col: 0, message: `your program wrote more than ${limits.diskBytes >> 20} MiB (or ${limits.diskEntries} files) to disk` })
    } else if (res.limit === 'goroutines') {
      status = 'runtime_error'
      errors.push({ line: fnLine, col: 0, message: `your program started more than ${limits.maxGoroutines} goroutines` })
    } else if (panicked || r.code !== 0 || !res.done) {
      status = 'runtime_error'
      if (!panicked) errors.push({ line: stackLine(r.stderr, offset) ?? fnLine, col: 0, message: crashMessage(r).split(`${tmp}/mod/`).join('').split(tmp).join('') })
    }
    let stdout = r.stdout
    if (r.stdoutTruncated) stdout += '\n… (output truncated)' // C-PYTHON Addendum 2 Q2: the first 64 KiB, then the mark
    return { status, cases: out, errors, stdout, steps, truncated, ms: Date.now() - t0 }
  } finally {
    // R5: a run whose processes could not be confirmed dead keeps its dir, so the sweep can find it
    if (keep) {
      try { log(`runner: a process of ${tmp} survived SIGKILL; leaving the dir for the sweep`) } catch { /* ignore */ }
    } else await removeTree(tmp, log)
  }
}

/** The route's state: the packs and the one-run-at-a-time guard. */
export function createRunner({ home, env = process.env, limits = LIMITS, packsDir = PACKS_DIR, log = () => {}, allowRawImports = false } = {}) {
  const packs = loadPacks(packsDir)
  let busy = false
  let active = Promise.resolve()
  /** R5: aborts the run in flight (server shutdown). */
  let current = null
  /** The build-cache trim after the latest run (L2): off the reply path, and done before the next build. */
  let maintenance = Promise.resolve()
  const trim = async () => {
    try { await trimCache(join(realpathSync(home), 'gocache'), limits, log) } catch { /* never fails a run */ }
  }
  return {
    packs,
    get busy() { return busy },
    /** Claims the runner synchronously; false when a run is in flight. */
    claim() {
      if (busy) return false
      busy = true
      return true
    },
    /** `signal` (the client went away) stops the run, as abort() does. */
    run(req, { signal } = {}) {
      const ac = new AbortController()
      current = ac
      const unAbort = onAbort(signal, () => ac.abort())
      const p = (async () => {
        try {
          await maintenance
          return await runGo(req, { home, env, limits, log, signal: ac.signal, allowRawImports })
        } finally {
          unAbort()
          if (current === ac) current = null
          busy = false
          maintenance = trim()
        }
      })()
      active = p.catch(() => {})
      return p
    },
    /** R5: kills the run in flight, if any (SIGKILL, confirmed before its dir is removed). */
    abort() {
      current?.abort()
    },
    /** R5: the shutdown sweep (orphans of this server, its own leftover dirs). */
    sweep(opts = {}) {
      return sweepStaleRunDirs(undefined, 10 * 60_000, log, opts)
    },
    /** Resolves once a run in flight (its temp-dir removal included) and the cache trim are done. */
    async settled() {
      await active
      await maintenance
    },
  }
}
