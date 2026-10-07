/** The design's four deep dives, verbatim; `active` (1–4) marks the one the interviewer is on. */
export function DeepDiveList({ dives, active = 0 }: { dives: string[]; active?: number }) {
  return (
    <ol className="ds-dives">
      {dives.map((q, i) => (
        <li key={i} className="ds-dive" data-testid={`session-dive-${i + 1}`} aria-current={active === i + 1 ? 'step' : undefined}>
          {q}
        </li>
      ))}
    </ol>
  )
}
