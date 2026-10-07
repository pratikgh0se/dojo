import type { GradeOutput, ProviderName } from '../ai/types'
import { newId } from '../lib/id'
import { GRADE_MAX, gradePassed, type ArtifactRecord } from '../rules/artifacts'
import { canGrade, GRADE_DISABLED_REASON, gradeRequest } from '../rules/grade'
import { callJob } from './aiActions'
import type { DojoDB } from './db'
import { ARTIFACT_MISSING } from './projectActions'

export type GradeRun = { ok: true; output: GradeOutput } | { ok: false; error: string; code?: string }

/** Runs the grade job; on success stores the result, on failure writes nothing (C-PROJECTS §2.6). `projectRepo`: the learner's local project repo from /db/health (G6), or null; `repoFolder`: the dialog's Repo folder, when given. */
export async function requestGrade(d: DojoDB, id: string, commitSummary: string, clock: () => number, projectRepo: string | null = null, repoFolder?: string): Promise<GradeRun> {
  const a = (await d.artifacts.get(id)) as ArtifactRecord | undefined
  if (!a) return { ok: false, error: ARTIFACT_MISSING }
  if (!canGrade(a)) return { ok: false, error: GRADE_DISABLED_REASON }
  const res = await callJob(d, 'grade', gradeRequest(a, commitSummary, projectRepo, repoFolder), clock())
  if (!res.ok) return { ok: false, error: res.error, code: res.code }
  const stored = await recordGrade(d, id, res.output, res.provider, clock(), commitSummary)
  return stored ? { ok: true, output: res.output } : { ok: false, error: ARTIFACT_MISSING }
}

export async function recordGrade(
  d: DojoDB, id: string, out: GradeOutput, provider: ProviderName, at: number, commitSummary = '',
): Promise<boolean> {
  return d.transaction('rw', [d.artifacts, d.grades, d.events], async () => {
    const a = (await d.artifacts.get(id)) as ArtifactRecord | undefined
    if (!a) return false
    const next: ArtifactRecord = {
      ...a, grade: out.score, gradedAt: at, gradeFeedback: [...out.feedback], gradeMissing: [...out.missing],
    }
    if (out.commitFound === undefined) delete next.commitFound
    else next.commitFound = out.commitFound
    if (commitSummary.trim()) next.commitSummary = commitSummary.trim()
    await d.artifacts.put(next)
    await d.grades.add({
      id: newId('grade', at), targetKind: 'artifact', targetId: id, at, score: out.score, max: GRADE_MAX,
      passed: gradePassed(out.score), feedback: [...out.feedback], missing: [...out.missing],
      commitFound: out.commitFound, provider,
    })
    await d.events.add({ t: 'grade', id, at, score: out.score, max: GRADE_MAX })
    return true
  })
}
