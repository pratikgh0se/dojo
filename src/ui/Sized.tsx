/**
 * UAT r2 J3: a label that can change (Pause ↔ Resume, Focus ↔ Focus · paused) keeps the box of its widest form,
 * so nothing beside or below it moves. The other forms are drawn by CSS (`data-label`), never as DOM text, so the
 * element's text and accessible name stay exactly the visible label.
 */
export function Sized({ label, alts }: { label: string; alts: readonly string[] }) {
  return (
    <span className="sized">
      <span>{label}</span>
      {alts.filter(a => a !== label).map(a => <span key={a} className="sized-alt" data-label={a} aria-hidden="true" />)}
    </span>
  )
}
