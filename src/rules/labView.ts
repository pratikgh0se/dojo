// Pure view rules of the lab block and its review panel (R2 W3): check grouping, the plain lines of labs.md "Exact copy", the lab folder.
import { LAB_REVIEW_INVALID } from './labReview'
import type { LabCheckResult, LabCheckStatus, LabResults, LabRow, LabRunRow } from '../data/types'

export const STATUS_WORD: Record<LabCheckStatus, string> = { pass: 'Pass', fail: 'Fail', skip: 'Skip' }

/** The ticket's own checks first (in milestone order); every other check of the run after them. */
export function splitChecks(checks: readonly LabCheckResult[], checkIds: readonly string[]): { own: LabCheckResult[]; later: LabCheckResult[] } {
  const own = checkIds.flatMap(id => checks.filter(c => c.id === id))
  const mine = new Set(own.map(c => c.id))
  return { own, later: checks.filter(c => !mine.has(c.id)) }
}

export const summaryLine = (s: LabResults['summary']): string => `${s.pass} passed, ${s.fail} failed, ${s.skip} skipped`

const ERRORS: Record<string, string> = {
  bad_root: 'The labs folder must be inside your home folder, and not the home folder itself.',
  unknown_lab: 'This lab is not available in this copy of Dojo.',
  busy: 'The checks are already running. Wait for them to finish.',
  not_set_up: 'The lab folder was not found. Set up the lab again to create it.',
  make_missing: 'make was not found. Install the Xcode command line tools with xcode-select --install, then try again.',
  lab_dirty: 'Commit your work in the lab folder first, then request the review.',
  invalid_output: LAB_REVIEW_INVALID,
}
/** The plain line of an action failure: the contract's line for a known code, else the action's own message, else a fallback. */
export const labErrorText = (code: string, message?: string): string => ERRORS[code] ?? (message?.trim() ? message : 'That did not work. Try again.')

/** What went wrong inside a run that did run (a stop, no results file, an unreadable one), or null. `timeoutSec` is the lab's own. */
export function runProblem(run: Pick<LabRunRow, 'timedOut' | 'error' | 'results'> | undefined, timeoutSec: number): string | null {
  if (!run) return null
  if (run.timedOut) return `Checks took longer than ${timeoutSec} seconds and were stopped.`
  if (run.error === 'no_results') return 'The checks did not write a results file. Here is what they printed.'
  if (run.error === 'bad_results' || !run.results) return 'The results file could not be read. Here is what the checks printed.'
  return null
}

/** The distinct lab ids of live lab-linked tickets, sorted (a stable key for the definitions request). */
export const labIdsOf = (tickets: readonly { lab?: { id: string }; archived?: boolean }[]): string[] =>
  [...new Set(tickets.filter(t => !t.archived && t.lab).map(t => t.lab!.id))].sort()

/** The absolute folder of a set-up lab: `<root>/<repo>/<path>`, a leading `~` in the stored root replaced by the learner's home. */
export function labFolder(row: Pick<LabRow, 'root' | 'repo' | 'path'>, userHome?: string): string {
  const home = userHome?.replace(/\/+$/, '')
  const root = (home && /^~(?=\/|$)/.test(row.root) ? home + row.root.slice(1) : row.root).replace(/\/+$/, '')
  return `${root}/${row.repo}/${row.path}`
}
