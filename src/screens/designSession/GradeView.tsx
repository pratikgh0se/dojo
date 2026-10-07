import type { InterviewFinal } from '../../ai/types'

export function GradeView({ final }: { final: InterviewFinal }) {
  return (
    <div className="ds-grade" data-testid="session-grade">
      <ol className="ds-grade-items">
        {final.perItem.map((p, i) => (
          <li key={i}><span>{p.item}</span> <b>{p.points}</b> <span className="ds-note">{p.note}</span></li>
        ))}
      </ol>
      <p className="ds-study">One thing to study: {final.oneThingToStudy}</p>
    </div>
  )
}
