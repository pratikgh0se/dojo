import { useRef, type KeyboardEvent } from 'react'
import type { BankTabDef, BankTabId } from '../../content/banks/meta'

export interface TabCount { def: BankTabDef; done: number; total: number }

/** WAI-ARIA tabs, selection follows focus (C-BANKS S-07). */
export function BankSwitcher({ tabs, selected, onSelect }: { tabs: TabCount[]; selected: BankTabId; onSelect: (id: BankTabId) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const focused = refs.current.findIndex(r => r === document.activeElement)
    const cur = focused >= 0 ? focused : tabs.findIndex(t => t.def.id === selected)
    let next = -1
    if (e.key === 'ArrowRight') next = (cur + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (cur - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
    onSelect(tabs[next].def.id)
  }
  return (
    <div role="tablist" aria-label="Banks" className="banks-tabs" onKeyDown={onKey}>
      {tabs.map((t, i) => {
        const sel = t.def.id === selected
        return (
          <button
            key={t.def.id}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`banks-tab-${t.def.id}`}
            aria-selected={sel}
            aria-controls="banks-panel"
            tabIndex={sel ? 0 : -1}
            className={`banks-tab${sel ? ' sel' : ''}`}
            onClick={() => onSelect(t.def.id)}
          >
            {t.def.label} <span className="banks-tab-count" data-testid={`banks-tab-count-${t.def.id}`}>{t.done}/{t.total}</span>
          </button>
        )
      })}
    </div>
  )
}
