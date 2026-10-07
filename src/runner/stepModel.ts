// C-VISUAL §3: the one step model over every event kind. Steps 1..N count every event (DP and family); the
// DP half (dpModel) draws dp-table and dp-tree, the family half (families/model) every family panel. Both are
// built once per run; each step's view is then derived without replaying from step 1.
import { buildModel, narrate as narrateDp, type DpModel } from './dpModel'
import { buildFamilyModel, type FamilyModel } from './families/model'
import type { Step } from './types'
import { NOT_SHOWN } from './families/model'

export interface StepModel {
  N: number
  dp: DpModel
  /** null when the run has no family step (a DP-only run renders exactly as in Part 4a) */
  fam: FamilyModel | null
}

export function buildStepModel(steps: Step[]): StepModel {
  const fam = buildFamilyModel(steps)
  return { N: steps.length, dp: buildModel(steps), fam: fam.kinds.length ? fam : null }
}

/** A line saying what step k did: the DP narration, or the family step's caption. */
export function narrate(m: StepModel, k: number): string {
  if (m.dp.steps[k - 1]?.op === 'unshown') return NOT_SHOWN
  if (m.fam && k >= 1 && k <= m.N && m.fam.kindAt[k - 1] !== null) return m.fam.caption[k - 1]
  return narrateDp(m.dp, k)
}

/** The longest input a case label quotes before it ends in "…". */
export const CASE_INPUT_MAX = 40

/** The arguments of a case's call, as written: `numDecodings("226")` → `("226")`; '' when there are none. */
export function caseInput(call: string | undefined): string {
  const open = call?.indexOf('(') ?? -1
  if (!call || open < 0) return ''
  const args = call.slice(open).trim()
  if (args === '()') return ''
  return args.length > CASE_INPUT_MAX ? `${args.slice(0, CASE_INPUT_MAX - 2)}…)` : args
}

/**
 * UAT J4: the case each step belongs to, as "Case i of n" (index k, 1-based; [0] is unused). A case's first
 * event carries its id (the run's case ids, in order); steps before any marker belong to no case.
 * UAT r3 J4: with the run's calls it also names the input, as the mockup does: `Case 2 of 2 ("226")`.
 */
export function caseLabels(steps: Step[], caseIds: readonly number[], calls: Readonly<Record<number, string>> = {}): (string | null)[] {
  const out: (string | null)[] = [null]
  let cur: string | null = null
  for (const s of steps) {
    if (s.case !== undefined) {
      const i = caseIds.indexOf(s.case)
      const input = caseInput(calls[s.case])
      cur = i >= 0 ? `Case ${i + 1} of ${caseIds.length}${input ? ` ${input}` : ''}` : null
    }
    out.push(cur)
  }
  return out
}
