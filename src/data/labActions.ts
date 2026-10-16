// Lab actions (R2 W1 + W2): Set up lab, Run checks, hints and Request review. Each talks to the /labs/* routes through labClient and
// writes ONLY on the learner's action, in one transaction: labs (set up, hints), labRuns (a run that ran), labReviews and redos (a review).
// Nothing here awaits the network inside a Dexie transaction.
import { buildJobRequest } from '../ai/types'
import { allMilestonesPassed, labsRootOf, latestResultsRun, readRun } from '../rules/lab'
import { checkReview, LAB_REVIEW_INVALID, passedAt, percent, reviewRedos, reviewResults } from '../rules/labReview'
import { callJob } from './aiActions'
import { rungAllowed, rungShown } from '../rules/labHints'
import { getSettings, patchSettings, type DojoDB } from './db'
import {
  labBundleCall, labHintCall, labInfoCall, labRunCall, labSetupCall, type LabHintReply, type LabInfo,
} from './labClient'
import type { LabReviewRow, LabRow, LabRunRow } from './types'

export type { LabInfo } from './labClient'
/** Success carries the fields; a failure carries a code (a lab code of the server, or an AI error code) and a plain message. */
export type LabResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string }
type Fetch = typeof fetch

export const fail = (code: string, message: string): { ok: false; code: string; message: string } => ({ ok: false, code, message })
const NOT_SET_UP = 'The lab folder was not found. Set up the lab again to create it.'

/** The lab's definition from the server, or null (unknown lab, no server, read-only browser). Never throws. */
export async function fetchLabInfo(labId: string, f?: Fetch): Promise<LabInfo | null> {
  const r = await labInfoCall(labId, f)
  return r.ok ? (({ ok: _ok, ...info }) => info as LabInfo)(r) : null
}

/**
 * Set up lab. A new folder stores the `labs` row; an existing folder is left alone and stored as is. Set up again after the folder was
 * deleted replaces `baseCommit`, `setupAt` and `root` and keeps `hints`. `root` is the labs folder as Settings holds it now, unexpanded.
 */
export async function setupLab(d: DojoDB, labId: string, at: number, f?: Fetch): Promise<LabResult<{ status: 'created' | 'exists'; path: string; lab: LabRow }>> {
  const info = await labInfoCall(labId, f)
  if (!info.ok) return fail(info.code, info.message)
  const root = labsRootOf(await getSettings(d))
  const r = await labSetupCall(labId, root, f)
  if (!r.ok) return fail(r.code, r.message)
  const lab = await d.transaction('rw', d.labs, async (): Promise<LabRow> => {
    const prev = await d.labs.get(labId)
    const row: LabRow = {
      labId, repo: info.repo, path: info.path, root, version: info.version, hints: prev?.hints ?? [],
      baseCommit: r.baseCommit ?? prev?.baseCommit ?? '',
      setupAt: r.status === 'created' || !prev ? at : prev.setupAt,
    }
    await d.labs.put(row)
    return row
  })
  return { ok: true, status: r.status, path: r.path, lab }
}

/**
 * Run checks in the folder the lab was set up in. A run that ran (also a timeout, no results, bad results) is stored as a `labRuns`
 * row (stamped with the app clock `at` of the click); make_missing, not_set_up, busy, bad_root and an unreachable server store nothing.
 */
export async function runChecks(d: DojoDB, labId: string, at: number, f?: Fetch): Promise<LabResult<{ run: LabRunRow }>> {
  const lab = await d.labs.get(labId)
  if (!lab) return fail('not_set_up', NOT_SET_UP)
  const r = await labRunCall(labId, lab.root, f)
  if (!r.ok) return fail(r.code, r.message)
  const parsed = readRun(r.run)
  if (!parsed) return fail('server_error', 'The checks came back in a form Dojo cannot read.')
  // R2 I-5 (LAB-09): `at` and the id come from the app clock at the click, not from the server's time.
  const run: LabRunRow = { id: `run-${labId}-${at}`, labId, ...parsed, at }
  await d.labRuns.put(run)
  return { ok: true, run }
}

/**
 * Show a hint: the authored text from the server (no model call, no XP). Rung n opens after n-1 was shown for that ticket. The first
 * time a (ticket, rung) is shown it is appended to `labs.hints`; showing it again stores nothing.
 */
export async function getHint(d: DojoDB, labId: string, ticketId: string, rung: 1 | 2 | 3, at: number, f?: Fetch): Promise<LabResult<LabHintReply>> {
  const lab = await d.labs.get(labId)
  if (!lab) return fail('not_set_up', NOT_SET_UP)
  if (!rungAllowed(lab.hints, ticketId, rung)) return fail('locked', 'Open the earlier hints first.')
  const r = await labHintCall(labId, ticketId, rung, f)
  if (!r.ok) return fail(r.code, r.message)
  await d.transaction('rw', d.labs, async () => {
    const now = await d.labs.get(labId)
    if (now && !rungShown(now.hints, ticketId, rung)) await d.labs.put({ ...now, hints: [...now.hints, { ticketId, rung, at }] })
  })
  const { ok: _ok, ...hint } = r
  return { ok: true, ...hint }
}

/** Settings' "Labs folder": the typed value, trimmed; empty clears it (absent means ~/labs). The server judges it at set up (bad_root). */
export async function saveLabsRoot(d: DojoDB, value: string): Promise<void> {
  const v = value.trim()
  if (v) {
    await patchSettings(d, { labsRoot: v })
    return
  }
  await d.transaction('rw', d.settings, async () => {
    const { labsRoot: _gone, ...rest } = await getSettings(d)
    await d.settings.put(rest)
  })
}

/**
 * Request review. Available when EVERY milestone of the lab is passed (ruling R-1), the lab folder exists and its work is committed.
 * Builds the bundle (server, committed work only), asks the `lab_review` job (tools off, logged in `aiLog`), judges the reply
 * (`checkReview`: ids, scores, verbatim quotes) and computes the percent itself. One valid reply = one `labReviews` row, and a Review
 * card for each item scored 0 or 1, written together. An unusable reply stores nothing: Retry asks again.
 * Failures: not_set_up, not_ready (a milestone is not passed), lab_dirty, bad_root, make no_server, an AI error code, or invalid_output.
 */
export async function requestReview(d: DojoDB, labId: string, at: number, f?: Fetch): Promise<LabResult<{ review: LabReviewRow }>> {
  const lab = await d.labs.get(labId)
  if (!lab) return fail('not_set_up', NOT_SET_UP)
  const info = await labInfoCall(labId, f)
  if (!info.ok) return fail(info.code, info.message)
  const runs = await d.labRuns.where('labId').equals(labId).toArray()
  if (!allMilestonesPassed(info.milestones, runs)) return fail('not_ready', 'Pass every milestone of the lab before you request the review.')
  const b = await labBundleCall(labId, lab.root, f)
  if (!b.ok) return fail(b.code, b.message)
  const ticket = { id: info.closingTicket, title: info.title, track: 'ai' as const }
  const res = await callJob(d, 'lab_review', buildJobRequest('lab_review', ticket, { bundle: b.bundle, results: reviewResults(latestResultsRun(runs)?.results) }), at)
  if (!res.ok) return fail(res.code, res.code === 'invalid_output' ? LAB_REVIEW_INVALID : res.error)
  const checked = checkReview(res.output, b.bundle, info.rubric)
  if (!checked.ok) return fail('invalid_output', LAB_REVIEW_INVALID)
  const pct = percent(checked.items)
  const review: LabReviewRow = { id: `rev-${labId}-${at}`, labId, at, items: checked.items, percent: pct, passed: passedAt(pct), summary: checked.summary }
  await d.transaction('rw', d.labReviews, d.redos, async () => {
    await d.labReviews.put(review)
    const cards = reviewRedos({ labId, labTitle: info.title, closingTicket: info.closingTicket, items: checked.items, rubric: info.rubric, existing: await d.redos.toArray(), nowMs: at })
    if (cards.length) await d.redos.bulkPut(cards)
  })
  return { ok: true, review }
}