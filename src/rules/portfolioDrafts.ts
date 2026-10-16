// Portfolio drafts (portfolio.md): the repo README and the site page are built from the lab's WRITEUP.md at HEAD and its latest
// passing run, word for word as the contract's examples show; the article and the LinkedIn post come from the `portfolio_draft` job.
// Pure: no React, no Dexie.
import type { JournalRow, LabResults } from '../data/types'
import { localDayKey } from '../lib/dates'

export const LINKEDIN_MAX = 1300
export type OutputKind = 'repo' | 'site' | 'article' | 'linkedin'

export interface DraftRun { at: number; results: LabResults | null }
export interface DraftLinks { repoUrl: string; articleUrl?: string }
export interface WriteupSections { problem: string; approach: string; results: string; change: string }

const SECTION: Record<string, keyof WriteupSections> = { problem: 'problem', approach: 'approach', results: 'results', 'what i would change': 'change' }
const trimBlank = (lines: string[]): string => {
  let a = 0
  let b = lines.length
  while (a < b && lines[a].trim() === '') a++
  while (b > a && lines[b - 1].trim() === '') b--
  return lines.slice(a, b).join('\n')
}

/** The Problem, Approach, Results and What I would change sections of a write-up: it is split at the lines that start `## `. */
export function parseWriteup(md: string): WriteupSections {
  const out: WriteupSections = { problem: '', approach: '', results: '', change: '' }
  let cur: keyof WriteupSections | null = null
  let buf: string[] = []
  const flush = () => { if (cur) out[cur] = trimBlank(buf); buf = [] }
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) { flush(); cur = SECTION[line.slice(3).trim().toLowerCase()] ?? null; continue }
    if (cur) buf.push(line)
  }
  flush()
  return out
}

/** The latest run (by `at`) that has results, at least one check and every check at `pass`; null when none. */
export function passingRun<R extends DraftRun>(runs: readonly R[]): R | null {
  let best: R | null = null
  for (const r of runs) {
    const cs = r.results?.checks
    if (!cs || cs.length === 0 || cs.some(c => c.status !== 'pass')) continue
    if (!best || r.at > best.at) best = r
  }
  return best
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
const metricText = (m: Record<string, unknown>): string => Object.entries(m).map(([k, v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ')

/** `| Check | Result | Detail |` and one row per check, then a blank line and `Measured on <local date>.` */
export function resultsBlock(run: DraftRun): string {
  const rows = (run.results?.checks ?? []).map(c => {
    const detail = c.detail.trim() !== '' || !c.metrics ? c.detail : metricText(c.metrics)
    return `| ${cell(c.name)} | ${c.status} | ${cell(detail)} |`
  })
  return [`| Check | Result | Detail |`, '|---|---|---|', ...rows, '', `Measured on ${localDayKey(run.at)}.`].join('\n')
}

/** Tickets on which the learner used a rung 3 (the reference excerpt), once each, in the order of the lab's ticket list. */
export function rung3Tickets(hints: readonly { ticketId: string; rung: number }[], labTickets: readonly string[]): string[] {
  const used = new Set(hints.filter(h => h.rung === 3).map(h => h.ticketId))
  const listed = labTickets.filter(t => used.has(t))
  const rest = [...used].filter(t => !labTickets.includes(t)).sort()
  return [...listed, ...rest]
}
/** `Built with reference hints on <titles>.` for a lab built with a rung 3; '' otherwise. Rungs 1 and 2 never count. */
export const helpLine = (titles: readonly string[]): string => (titles.length ? `Built with reference hints on ${titles.join(', ')}.` : '')
/** The hint line, a blank line, then the text (the text alone when there is no line). */
export const withLead = (text: string, lead: string): string => (lead ? `${lead}\n\n${text}` : text)

const section = (heading: string, body: string): string => `## ${heading}\n${body}`
const join = (parts: string[]): string => `${parts.join('\n\n')}\n`

/** The README of the public lab folder. */
export function repoReadme(title: string, writeup: string, run: DraftRun | null, help: string): string {
  const w = parseWriteup(writeup)
  const parts: string[] = []
  if (help) parts.push(help)
  parts.push(`# ${title}`)
  if (w.problem) parts.push(section('Problem', w.problem))
  if (w.approach) parts.push(section('Approach', w.approach))
  const results = [w.results, run ? resultsBlock(run) : ''].filter(Boolean).join('\n\n')
  if (results) parts.push(section('Results', results))
  if (w.change) parts.push(section('What I would change', w.change))
  parts.push(section('How to run', '`make check`'))
  return join(parts)
}

/** The portfolio site page: `## Measured numbers` only with a passing run, `- Article:` only with a published article. */
export function sitePage(title: string, writeup: string, run: DraftRun | null, links: DraftLinks, help: string): string {
  const w = parseWriteup(writeup)
  const parts: string[] = []
  if (help) parts.push(help)
  parts.push(`# ${title}`)
  if (w.problem) parts.push(section('Problem', w.problem))
  if (w.approach) parts.push(section('Approach', w.approach))
  if (run) parts.push(`## Measured numbers\n\n${resultsBlock(run)}`)
  parts.push(section('Links', [`- Code: ${links.repoUrl}`, links.articleUrl ? `- Article: ${links.articleUrl}` : ''].filter(Boolean).join('\n')))
  return join(parts)
}

/** A LinkedIn reply over 1300 characters: the longest prefix of at most 1300 that ends at `.`, `!` or `?`; with none, the first 1300. */
export function trimPost(text: string, max = LINKEDIN_MAX): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const end = Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'))
  return end >= 0 ? head.slice(0, end + 1) : head
}

/** One line per journal row that lists a ticket of the lab, oldest day first: the day, then its note when there is one. */
export function journalLines(rows: readonly JournalRow[], ticketIds: ReadonlySet<string>, max = 60): string[] {
  return rows
    .filter(r => r.items.some(i => ticketIds.has(i.ticketId)))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-max)
    .map(r => {
      const body = [r.line, r.hardest, r.notes].filter((x): x is string => !!x && x.trim() !== '').join(' / ')
      return body ? `${r.day}: ${body.slice(0, 300)}` : r.day
    })
}

/** The non-blank "what a stronger version does" texts of a review. */
export const strongerLines = (items: readonly { stronger?: string }[]): string[] => items.map(i => (i.stronger ?? '').trim()).filter(Boolean)
