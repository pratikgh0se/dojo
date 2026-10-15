/** A minutes or ticket meter with the contract's `aria-value*` and `data-done` / `data-total`, drawn as at most `segments` blocks. */
export function SkMeter({ done, total, label, testId, segments = 10, tone = 'accent', hidden = false }: {
  done: number; total: number; label: string; testId: string; segments?: number; tone?: 'accent' | 'ok'
  /** kept for assistive tech and the data hooks but not drawn (a locked tile shows its "Needs" text, not an empty pip row) */
  hidden?: boolean
}) {
  const n = segments
  const on = total > 0 ? Math.min(n, Math.max(done > 0 ? 1 : 0, Math.round((done / total) * n))) : 0
  return (
    <span className={`sk-meter sk-${tone}${hidden ? ' vh' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} data-done={done} data-total={total} data-testid={testId}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
    </span>
  )
}

/** The state glyph hook (SKILLS-09/19): the span carries `data-glyph`; the drawing inside keeps its own name. */
export function StateGlyph({ id, attr, children }: { id: string; attr: string; children: React.ReactNode }) {
  return <span className="sk-gl" data-testid={`skills-node-glyph-${id}`} data-glyph={attr}>{children}</span>
}
