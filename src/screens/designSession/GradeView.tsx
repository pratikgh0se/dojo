import type { ReactNode } from 'react'
import { INTERVIEW_RUBRIC } from '../../ai/prompts'
import type { InterviewFinal } from '../../ai/types'
import type { DesignSession } from '../../data/types'
import { normalizePartnerScores, partnerComplete, partnerNotesText, partnerTotal, PARTNER_ROWS, ROW_MAX } from '../../rules/partnerScores'
import { finalTotal, itemPoints } from '../../rules/designSession'
import { evidenceChips } from '../../rules/gradeEvidence'
import { learnerWords } from './designAi'

/** Mockup 7d (frame 7d, "Grade view, notes and diagram together"): the total, then the "AI partner · feedback" block (a paragraph per rubric item with the
 * places it leans on as chips), the checks, and from 1100 px "What a stronger version does" in a right column with whatever `children` the screen adds
 * there (the done view's Keep panel). A grade stored before F3 has no `feedback` or `evidence`: its one-line `note` stands in and there are no chips.
 * `labels` are the canvas labels as drawn now, so a diagram citation can tell a box that is still there from one that is gone (DESIGN-99).
 * GLOBAL-01: the model's words are shown without the stored job name (display only; the stored grade stays as written). */
export function GradeView({ final, labels = [], children }: { final: InterviewFinal; labels?: readonly string[]; children?: ReactNode }) {
  const items = final.perItem.slice(0, 5)
  const inconsistencies = (final.inconsistencies ?? []).slice(0, 5)
  const stronger = (final.stronger ?? []).slice(0, 4)
  const aside = stronger.length > 0 || !!children
  // DESIGN-100: "What a stronger version does" is a sibling of session-grade, not a child. From 1100 px the two sit side by side; below it the
  // stronger list follows, so its top is at or below the bottom of session-grade.
  return (
    <div className={`ds-grade-wrap${aside ? ' ds-grade-wide' : ''}`}>
    <div className="ds-grade" data-testid="session-grade">
      <div className="ds-grade-main">
        <div className="ds-grade-total">
          <span className="ds-grade-cap">Score</span>
          <span className="ds-grade-score" data-testid="session-grade-total">{finalTotal(final)}<span className="ds-grade-of"> of 20</span></span>
        </div>
        <div className="ds-ai">
          <span className="ds-aid" aria-hidden="true">AI</span>
          <div className="ds-ai-body">
            <div className="ds-ai-head">
              <h3 className="ds-grade-cap ds-ai-cap">AI partner · feedback</h3>
              <span className="ds-ai-meta">Read your notes and the diagram</span>
            </div>
            <ol className="ds-grade-items">
              {items.map((p, i) => {
                const max = INTERVIEW_RUBRIC[i]?.max
                const points = itemPoints(i, p.points)
                const chips = evidenceChips(p.evidence, labels)
                return (
                  <li key={i} className="ds-grade-item" data-testid={`session-grade-item-${i + 1}`} data-score={points}>
                    <div className="ds-grade-item-head">
                      <h4 className="ds-grade-name">{learnerWords(p.item)} · {points} of {max ?? '–'}</h4>
                      {max !== undefined && (
                        <span className="ds-meter" aria-hidden="true">
                          {Array.from({ length: max }, (_, k) => <i key={k} className={k < points ? 'on' : undefined} />)}
                        </span>
                      )}
                    </div>
                    <p className="ds-grade-note">{learnerWords(p.feedback?.trim() ? p.feedback : p.note)}</p>
                    {chips.length > 0 && (
                      <div className="ds-cites">
                        {chips.map((c, k) => (
                          <span key={k} className="ds-cite" data-testid={`session-grade-cite-${i + 1}-${k + 1}`}>
                            {c.kind && <><b>{c.kind}</b>{' '}</>}{learnerWords(c.title)}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
        {inconsistencies.length > 0 && (
          <section className="ds-checks" data-testid="session-grade-inconsistencies" aria-labelledby="ds-checks-h">
            <h3 id="ds-checks-h" className="ds-sub">Checks to review</h3>
            <ul>{inconsistencies.map((t, i) => <li key={i}>{learnerWords(t)}</li>)}</ul>
          </section>
        )}
        <p className="ds-study">One thing to study: {learnerWords(final.oneThingToStudy)}</p>
      </div>
    </div>
      {aside && <div className="ds-grade-aside">
        {stronger.length > 0 && (
          <section className="ds-checks ds-stronger" data-testid="session-grade-stronger" aria-labelledby="ds-stronger-h">
            <h3 id="ds-stronger-h" className="ds-sub">What a stronger version does</h3>
            <ol>{stronger.map((t, i) => <li key={i}>{learnerWords(t)}</li>)}</ol>
          </section>
        )}
        {children}
      </div>}
    </div>
  )
}

/**
 * The grade of a finished session that has no AI grade (With someone, or Solo): the total the host confirmed, and the five items
 * when the partner's sheet is complete and adds up to that total (so the items always sum to it, as in DESIGN-68). GLOBAL-10 keeps
 * `session-grade` on the done view of every mode.
 */
export function ScoredGradeView({ session }: { session: DesignSession }) {
  const rubric = session.rubric
  if (rubric === null || rubric === undefined) return null
  const sheet = session.partner?.scores ? normalizePartnerScores(session.partner.scores) : null
  const items = sheet && partnerComplete(sheet) && partnerTotal(sheet) === rubric ? sheet.perItem : null
  const by = session.partner?.name?.trim()
  const partnerNotes = partnerNotesText(session.partner?.notes)
  return (
    <div className="ds-grade" data-testid="session-grade">
      <div className="ds-grade-main">
        <div className="ds-grade-total">
          <span className="ds-grade-cap">Score</span>
          <span className="ds-grade-score" data-testid="session-grade-total">{rubric}<span className="ds-grade-of"> of 20</span></span>
        </div>
        {items && (
          <ol className="ds-grade-items">
            {PARTNER_ROWS.map((r, i) => (
              <li key={r.n} className="ds-grade-item" data-testid={`session-grade-item-${i + 1}`} data-score={items[i] ?? 0}>
                <span className="ds-grade-name">{r.item}</span>
                <b className="ds-grade-pts">{items[i] ?? 0} of {ROW_MAX}</b>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="ds-study">{session.rubricBy === 'partner' ? `Scored by your partner${by ? `, ${by}` : ''}` : 'Scored by you'}</p>
      {partnerNotes.trim() !== '' && (
        <PartnerNotes text={partnerNotes} />
      )}
    </div>
  )
}

/** DESIGN-111, DESIGN-112: the partner's notes, read-only for the host. `session-partner-notes` is the block that holds the heading; the text itself is
 * `session-partner-notes-text` (a blockquote), kept as typed. */
export function PartnerNotes({ text }: { text: string }) {
  return (
    <div className="ds-partner-notes" data-testid="session-partner-notes">
      <h3 className="ds-sub">Your partner's notes</h3>
      <blockquote className="ds-partner-notes-text" data-testid="session-partner-notes-text" data-content="learner">{text}</blockquote>
    </div>
  )
}
