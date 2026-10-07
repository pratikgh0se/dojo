import { useEffect, useId, useState } from 'react'
import { useDb } from '../../app/providers'
import { useDataHome } from '../../data/dataHome'
import { requestGrade, type GradeRun } from '../../data/gradeActions'
import { now } from '../../lib/clock'
import { readRepoFolder, writeRepoFolder } from '../../lib/gradePrefs'
import { isHttpUrl, type ArtifactRecord } from '../../rules/artifacts'
import { canGrade, GRADE_DISABLED_REASON, GRADE_REMOTE_NOTE, GRADE_UNAVAILABLE, gradeFix, gradeView, PROJECT_REPO_UNSET, repoFolderProblem } from '../../rules/grade'
import { Button } from '../../ui/primitives'
import { isGradeRunning, setGradeRunning, useGradeRunning } from './gradeRunning'
import { StepLoader } from './StepLoader'

/**
 * C-PROJECTS §2.6. The stored result renders from the artifact row, so reopening costs no call.
 * A failure writes nothing and shows the raw error with Retry; the stored result stays visible.
 */
export function GradeSection({ artifact }: { artifact: ArtifactRecord }) {
  const d = useDb()
  const uid = useId()
  const running = useGradeRunning(artifact.id)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  // UAT cu-5 P2-3: where the grader reads the commit; remembered on this Mac, the project repo (G6) until changed
  const [picked, setPicked] = useState<string | null>(readRepoFolder)
  const folderId = `${uid}-folder`
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summary, setSummary] = useState(artifact.commitSummary ?? '')
  const ready = canGrade(artifact)
  // G6: the learner's local project repo (DOJO_PROJECT_REPO / profile.json), from the disk server; null when unset
  const projectRepo = useDataHome(import.meta.env.VITE_DOJO_DISK !== 'off')?.projectRepo ?? null
  const folder = picked ?? projectRepo ?? ''
  const folderProblem = projectRepo ? repoFolderProblem(folder, projectRepo) : null
  const view = gradeView(artifact)
  const summaryId = `${uid}-summary`

  useEffect(() => {
    if (summaryOpen) document.getElementById(summaryId)?.focus()
  }, [summaryOpen, summaryId])

  function editFolder(v: string) {
    setPicked(v)
    if (repoFolderProblem(v, projectRepo) === null) writeRepoFolder(v)
  }

  async function run() {
    if (isGradeRunning(artifact.id) || !ready) return
    // a folder the grader would refuse is said so here, before a call is spent
    if (folderProblem) {
      setError(null)
      document.getElementById(folderId)?.focus()
      return
    }
    setGradeRunning(artifact.id, true)
    setError(null)
    let res: GradeRun
    try {
      res = await requestGrade(d, artifact.id, summary, now, projectRepo, projectRepo ? folder : '')
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      setGradeRunning(artifact.id, false)
    }
    if (!res.ok) setError({ code: res.code, message: res.error })
  }

  return (
    <div className="p-subsection p-grade">
      <h3 className="p-subtitle">Grade</h3>
      {projectRepo && <div className="p-field">
        <label htmlFor={folderId}>Repo folder</label>
        <input
          id={folderId} data-testid="grade-repo-folder" value={folder} placeholder={projectRepo ?? ''} spellCheck={false} autoComplete="off"
          aria-invalid={folderProblem ? true : undefined} aria-describedby={`${folderId}-help`} onChange={e => editFolder(e.target.value)}
        />
        {folderProblem
          ? <p className="p-err" id={`${folderId}-help`} role="alert" data-testid="grade-repo-folder-error">{folderProblem}</p>
          : <p className="p-note" id={`${folderId}-help`} data-testid="grade-repo-folder-help">Where the grader reads the commit on this Mac, read-only. Clear it to grade from the commit summary alone.</p>}
      </div>}
      {summaryOpen ? (
        <div className="p-field">
          <label htmlFor={summaryId}>Commit summary</label>
          <textarea id={summaryId} rows={4} value={summary} placeholder="Paste git show --stat" onChange={e => setSummary(e.target.value)} />
        </div>
      ) : (
        <div className="p-actions">
          <Button variant="quiet" aria-expanded={false} onClick={() => setSummaryOpen(true)}>Add commit summary</Button>
        </div>
      )}
      {/* above the button, so Request grade stays the last thing in the section and never scrolls in under the dialog footer */}
      {ready && !projectRepo && <p className="p-note" data-testid="grade-project-repo-unset">{PROJECT_REPO_UNSET}</p>}
      <div className="p-actions">
        <Button
          variant="accent"
          data-testid="grade-request"
          disabled={!ready || running}
          onClick={() => void run()}
        >
          {view ? 'Re-grade' : 'Request grade'}
        </Button>
        {running && <StepLoader label="Grading…" testId="grade-loading" />}
      </div>
      {!ready && <p className="p-note" data-testid="grade-disabled-reason">{GRADE_DISABLED_REASON}</p>}
      {/* the spec asks for the repo's http(s) URL as well as the commit: a repo with no remote cannot be graded yet, and the learner is told so */}
      {!ready && !isHttpUrl(artifact.repo) && <p className="p-note" data-testid="grade-remote-note">{GRADE_REMOTE_NOTE}</p>}
      {error !== null && (
        <div className="p-grade-error" role="alert" data-testid="grade-error">
          <p className="p-err">{GRADE_UNAVAILABLE}</p>
          <p className="p-fix" data-testid="grade-error-fix">{gradeFix(error.code, error.message, projectRepo)}</p>
          <code className="p-raw">{error.message}</code>
          <Button data-testid="grade-retry" onClick={() => void run()}>Retry</Button>
        </div>
      )}
      {view && (
        <div className="p-grade-result" data-testid="grade-result">
          <p className="p-grade-line">
            <b className="p-grade-score" data-testid="grade-score">{view.score}</b>
            <span className={`p-grade-verdict${view.passed ? ' passed' : ''}`} data-testid="grade-verdict">{view.verdict}</span>
          </p>
          <ul className="p-grade-list" data-testid="grade-feedback">
            {view.feedback.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {view.missing.length > 0 && (
            <div data-testid="grade-missing">
              <h4 className="p-subtitle">Missing</h4>
              <ul className="p-grade-list">
                {view.missing.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {view.at && <p className="p-note" data-testid="grade-at">Graded {view.at}</p>}
        </div>
      )}
    </div>
  )
}
