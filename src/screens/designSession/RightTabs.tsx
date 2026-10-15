import type { KeyboardEvent, ReactNode } from 'react'

export interface TabDef { id: string; label: string }

/** A tablist with all panels mounted (so chat and notes keep their state) and the inactive ones hidden. */
export function RightTabs({ tabs, active, onChange, panels }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; panels: Record<string, ReactNode> }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex(t => t.id === active)
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length]
    onChange(next.id)
    document.getElementById(`ds-tab-${next.id}`)?.focus()
  }
  return (
    <div className="dst">
      <div role="tablist" aria-label="Session panel" className="dst-list" data-testid="session-tabs" onKeyDown={onKey}>
        {tabs.map(t => (
          <button
            key={t.id} id={`ds-tab-${t.id}`} type="button" role="tab" className="dst-tab" data-testid={`session-tab-${t.id}`}
            aria-selected={t.id === active} aria-controls={`ds-panel-${t.id}`} tabIndex={t.id === active ? 0 : -1} onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map(t => (
        <div key={t.id} id={`ds-panel-${t.id}`} role="tabpanel" aria-labelledby={`ds-tab-${t.id}`} data-testid={`session-tabpanel-${t.id}`} hidden={t.id !== active} className="dst-panel">
          {panels[t.id]}
        </div>
      ))}
    </div>
  )
}
