import type { ReactNode } from 'react'
import { tipProps } from './Tip'

export type DrawerTone = 'accent' | 'danger' | 'rival' | 'design'

/** README-dashboard "Today" §4: panel whose header row is a button (title, sub, cubes, d/n, +/−). */
export function Drawer({
  id, title, sub, cubes, done, total, tone, open, onToggle, children, testId, toggleTestId,
}: {
  id: string; title: string; sub: string; cubes: boolean[]; done: number; total: number
  tone: DrawerTone; open: boolean; onToggle: () => void; children: ReactNode
  testId?: string; toggleTestId?: string
}) {
  return (
    <section className="sr-panel drawer" data-testid={testId ?? `drawer-${id}`}>
      <button
        type="button" className="drawer-head" aria-expanded={open}
        aria-controls={open ? `drawer-body-${id}` : undefined} onClick={onToggle}
        {...(toggleTestId ? { 'data-testid': toggleTestId } : {})}
      >
        <span className="drawer-titles">
          {/* shell-today-board M14 (F6.5): titles are accent; rival for DSA, arcane-label for design (carry keeps danger cubes) */}
          <span className={`drawer-title dt-${tone === 'danger' ? 'accent' : tone}`}>{title}</span>
          <span className="drawer-sub">{sub}</span>
        </span>
        <span className="drawer-cubes" aria-hidden="true">
          {cubes.map((on, i) => <i key={i} className={`drawer-cube${on ? ' on' : ''}${tone === 'danger' ? ' danger' : ''}`} />)}
        </span>
        <span className="drawer-count" {...tipProps(`${done} of ${total} done: ${title}`)}>{done}/{total}</span>
        <span className="drawer-caret" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="drawer-body" id={`drawer-body-${id}`}>{children}</div>}
    </section>
  )
}
