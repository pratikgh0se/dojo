// R2 W6: the writes of the Portfolio screen. A row is written only by Create draft, an edit of the text, a successful Publish or
// Mark as posted (portfolio.md): never on page load. Nothing here awaits the network inside a Dexie transaction.
import { AI_ERRORS, buildJobRequest } from '../ai/types'
import { isProven, latestReview } from '../rules/lab'
import {
  helpLine, journalLines, passingRun, repoReadme, resultsBlock, rung3Tickets, sitePage, strongerLines, trimPost, withLead,
  type OutputKind,
} from '../rules/portfolioDrafts'
import { callJob } from './aiActions'
import type { DojoDB } from './db'
import { exportLab } from './portfolioClient'
import type { PortfolioItem } from './types'

export const itemId = (labId: string, kind: OutputKind): string => `${labId}:${kind}`

/** Put the draft text. The row is a draft (a published row is read-only in the screen, so this never un-publishes one by hand). */
export async function saveDraft(d: DojoDB, labId: string, kind: OutputKind, draft: string, at: number): Promise<PortfolioItem> {
  return d.transaction('rw', d.portfolioItems, async () => {
    const prev = await d.portfolioItems.get(itemId(labId, kind))
    const row: PortfolioItem = { ...(prev ?? {}), id: itemId(labId, kind), labId, kind, status: 'draft', draft, updatedAt: at }
    await d.portfolioItems.put(row)
    return row
  })
}

/** Published (a push that succeeded: `url` set) or, for LinkedIn, posted by the learner's own hand (no `url`). */
export async function markPublished(d: DojoDB, labId: string, kind: OutputKind, at: number, url?: string): Promise<PortfolioItem> {
  return d.transaction('rw', d.portfolioItems, async () => {
    const prev = await d.portfolioItems.get(itemId(labId, kind))
    const row: PortfolioItem = { draft: '', ...(prev ?? {}), id: itemId(labId, kind), labId, kind, status: 'published', updatedAt: at, publishedAt: at, ...(url ? { url } : {}) }
    await d.portfolioItems.put(row)
    return row
  })
}

export type CreateResult = { ok: true; text: string } | { ok: false; code: string; message: string }
const fail = (code: string, message: string): CreateResult => ({ ok: false, code, message })
const NOT_SET_UP = 'The lab folder was not found, so set up the lab again.'

/**
 * Create draft (PORT-06 to PORT-14). Reads the write-up from the lab folder's HEAD through the export route, builds the text
 * (repo, site) or asks the `portfolio_draft` job (article, linkedin), and stores it. On a failure nothing is written but the aiLog row.
 * The site page needs the GitHub login (its Code link has the user name); the others do not.
 */
export async function createDraft(d: DojoDB, labId: string, kind: OutputKind, at: number, f?: typeof fetch): Promise<CreateResult> {
  const lab = await d.labs.get(labId)
  if (!lab) return fail('not_set_up', NOT_SET_UP)
  const reviews = await d.labReviews.where('labId').equals(labId).toArray()
  if (!isProven(reviews)) return fail('not_proven', 'This lab has not been proven yet.')
  const x = await exportLab({ labId, labsRoot: lab.root, login: kind === 'site' }, f)
  if (!x.ok) return fail(x.code, x.message)
  const info = x.value
  const runs = await d.labRuns.where('labId').equals(labId).toArray()
  const run = passingRun(runs)
  const titles = new Map((await d.tickets.toArray()).map(t => [t.id, t.title]))
  const help = helpLine(rung3Tickets(lab.hints, info.tickets).map(id => titles.get(id) ?? id))

  if (kind === 'repo') {
    const text = repoReadme(info.title, info.writeup, run, help)
    await saveDraft(d, labId, 'repo', text, at)
    return { ok: true, text }
  }
  if (kind === 'site') {
    if (!info.gh.ok) return fail(info.gh.code, info.gh.message)
    const article = await d.portfolioItems.get(itemId(labId, 'article'))
    const text = sitePage(info.title, info.writeup, run, { repoUrl: info.repoUrl ?? '', ...(article?.status === 'published' && article.url ? { articleUrl: article.url } : {}) }, help)
    await saveDraft(d, labId, 'site', text, at)
    return { ok: true, text }
  }
  const labTickets = new Set([...info.tickets, ...(await d.tickets.toArray()).filter(t => t.lab?.id === labId).map(t => t.id)])
  const request = buildJobRequest('portfolio_draft', { id: labId, title: info.title, track: 'ai' }, {
    kind, writeup: info.writeup, journal: journalLines(await d.journal.toArray(), labTickets),
    stronger: strongerLines(latestReview(reviews)?.items ?? []), results: run ? resultsBlock(run) : '',
  })
  const r = await callJob(d, 'portfolio_draft', request, at)
  if (!r.ok) return fail(r.code, AI_ERRORS[r.code].message)
  const text = kind === 'linkedin' ? trimPost(r.output.text) : withLead(r.output.text, help)
  await saveDraft(d, labId, kind, text, at)
  return { ok: true, text }
}
