import { useState } from 'react'
import { Glyph } from '../../ui/Glyph'

/** Level, XP and the pace line, collapsed by default. The pace line only ever says when the plan ends, printed as S2 words it. */
export function StatsDrawer({ level, xp, focusToday, budgetToday, paceLine }: { level: number; xp: number; focusToday: number; budgetToday: number; paceLine: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="qc-drawer">
      <button type="button" className="qc-dtoggle" data-testid="today-stats-toggle" aria-expanded={open} aria-controls={open ? 'today-stats' : undefined} onClick={() => setOpen(o => !o)}>
        <Glyph name={open ? 'chevronD' : 'chevronR'} /> Stats
      </button>
      {open && (
        <div id="today-stats" className="qc-dbody" data-testid="today-stats">
          <span className="mono">LV {level}</span><span className="mono">{xp} XP</span>
          <span>Focus today {focusToday} of {budgetToday} min</span>
          <span data-testid="today-stats-pace">{paceLine}</span>
        </div>
      )}
    </div>
  )
}
