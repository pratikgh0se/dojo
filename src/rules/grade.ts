import type { JobRequest } from '../ai/types'
import { CAPSTONE_STAGES } from '../content/capstoneStages'
import { fmtDayMonYear } from '../lib/fmtDate'
import { GRADE_MAX, gradePassed, isHttpUrl, isValidCommit, type ArtifactRecord } from './artifacts'

export const GRADE_DISABLED_REASON = 'Add a repo URL and a commit to grade.'
export const GRADE_UNAVAILABLE = 'Grader unavailable — nothing was saved.'
export const COMMIT_TEXT = { checked: 'Commit checked', notFound: 'Commit not found', unchecked: 'Commit not checked yet' } as const

/** AI.md guardrail rubric (C-PROJECTS §2.6): exists+runs, core mechanism hand-written, a measurement/test, note explains one thing learned. */
export const GRADE_RUBRIC =
  'exists and runs (1) · core mechanism hand-written (2) · a measurement or test (1) · note explains one thing learned (1)'

/** G6: shown where the grader could read a local repo but none is set (DOJO_PROJECT_REPO / profile.json projectRepo). */
export const PROJECT_REPO_UNSET =
  'Set your project repo to let the grader read your commits: DOJO_PROJECT_REPO, or "projectRepo" in profile.json in the data folder, then restart Dojo. Until then grading uses the repo URL and the commit summary.'

const lastSegment = (p: string) => p.replace(/\.git$/i, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? ''

/**
 * C-PROJECTS §2.6, G6: the helper reads a repo read-only only when the artifact's repo URL names the learner's local
 * project repo (same last path segment, any host and owner), and only when one is set. Unset by default.
 */
export function projectRepoPath(repo: string | undefined, projectRepo: string | null | undefined): string | undefined {
  if (!repo || !projectRepo || !isHttpUrl(repo)) return undefined
  const name = lastSegment(projectRepo)
  let path = ''
  try { path = new URL(repo).pathname } catch { return undefined }
  return name !== '' && lastSegment(path) === name ? projectRepo : undefined
}

/** UAT cu-5 P2-3 + G6: the Repo folder rule, said with the learner's own project repo. */
export const gradeFolderRule = (projectRepo: string) => `The Repo folder must be ${projectRepo} or a folder inside it.`
export const GRADE_REMOTE_NOTE =
  'Grading needs the repo\'s http(s) URL as well as the commit, so a repo with no remote yet cannot be graded. Add one (git remote add origin <url>) and put its URL in Repo URL above.'

/**
 * Why `folder` cannot be the Repo folder, or null. Empty is allowed: the grade then rests on the commit summary alone.
 * With no project repo set (G6) nothing local may be read, so any non-empty folder is refused. The server enforces the same by real path.
 */
export function repoFolderProblem(folder: string, projectRepo: string | null | undefined): string | null {
  const f = folder.trim()
  if (f === '') return null
  if (!projectRepo) return PROJECT_REPO_UNSET
  const rule = gradeFolderRule(projectRepo)
  if (f.split(/[\\/]/).includes('..')) return rule
  const root = projectRepo.replace(/[\\/]+$/, '')
  return f === root || f.startsWith(`${root}/`) ? null : rule
}

/**
 * What to fix, in a sentence, for a grade that failed: the helper's code says which part of the request it refused. The raw
 * error stays under it (C-PROJECTS §2.6).
 */
export function gradeFix(code: string | undefined, raw: string, projectRepo?: string | null): string {
  if (code === 'path_not_allowed' || /repoPath must be|no project repo is set/i.test(raw)) {
    return `${projectRepo ? gradeFolderRule(projectRepo) : PROJECT_REPO_UNSET} Fix the Repo folder above, then Retry.`
  }
  if (/is not a folder on this Mac/i.test(raw)) return 'That Repo folder does not exist on this Mac. Fix the Repo folder above (clear it to grade from the commit summary alone), then Retry.'
  if (/is not a git repository/i.test(raw)) return 'The Repo folder is not a git repository. Fix the Repo folder above (clear it to grade from the commit summary alone), then Retry.'
  switch (code) {
    case 'claude_signed_out': return 'Claude Code is signed out. Sign in, then Retry.'
    case 'claude_missing': return 'Claude Code is not installed or not on the PATH. Install it, then Retry.'
    case 'helper_unreachable': return 'Dojo cannot reach its AI helper. Restart Dojo, then Retry.'
    case 'timeout': return 'The grader took too long. Retry; a shorter commit summary helps.'
    case 'busy': return 'The grader is busy with another request. Wait a moment, then Retry.'
    default: return 'Nothing was saved. Retry; if it fails again, the line below says why.'
  }
}

export function canGrade(a: ArtifactRecord): boolean {
  return isHttpUrl(a.repo) && isValidCommit(a.commit)
}

/** C-PROJECTS §2.6 input: artifact id, title, stage number and title, proof note, repo URL, commit, commit summary, rubric. */
/** `repoFolder`: the learner's Repo folder when the dialog gave one (empty: no local read); else the project repo when the URL names it. */
export function gradeRequest(a: ArtifactRecord, commitSummary = '', projectRepo: string | null = null, repoFolder?: string): JobRequest<'grade'> {
  const stage = a.stage ?? 0
  const summary = commitSummary.trim() || a.commitSummary?.trim() || undefined
  const repoPath = repoFolder === undefined ? projectRepoPath(a.repo, projectRepo) : repoFolder.trim() || undefined
  return {
    ticket: { id: a.id, title: a.title, track: 'ai', text: a.note },
    context: {
      proofNote: a.note ?? '',
      repoUrl: a.repo,
      repoPath,
      commit: a.commit,
      commitSummary: summary,
      stage,
      stageTitle: CAPSTONE_STAGES[stage]?.title,
      rubric: GRADE_RUBRIC,
    },
  }
}

export interface GradeView {
  score: string
  passed: boolean
  verdict: 'Passed' | 'Not yet'
  feedback: string[]
  missing: string[]
  at: string | null
}

export function gradeView(a: ArtifactRecord): GradeView | null {
  if (typeof a.grade !== 'number') return null
  const passed = gradePassed(a.grade)
  return {
    score: `${a.grade}/${GRADE_MAX}`,
    passed,
    verdict: passed ? 'Passed' : 'Not yet',
    feedback: a.gradeFeedback ?? [],
    missing: a.gradeMissing ?? [],
    at: typeof a.gradedAt === 'number' ? fmtDayMonYear(a.gradedAt) : null,
  }
}

/** Text under a valid commit: the grader's commitFound, or "not checked yet" before any grade. */
export function commitCheckText(a: ArtifactRecord): string | null {
  if (!isValidCommit(a.commit)) return null
  if (a.commitFound === true) return COMMIT_TEXT.checked
  if (a.commitFound === false) return COMMIT_TEXT.notFound
  return COMMIT_TEXT.unchecked
}
