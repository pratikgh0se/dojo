import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTickets } from '../../data/hooks'
import { itemGlyph, rank, SECTION_LABEL, skillItems, STATIC_ITEMS, ticketItems } from '../../rules/palette'
import { Glyph } from '../../ui/Glyph'
import { usePlanV2 } from '../providers'

/**
 * Jump to a ticket, a skill, a destination, Settings, Guide or a legacy screen (SHELL-15 to 18). It is a dialog that exists
 * only while open. The first result is highlighted as soon as the list renders; Enter opens the highlighted one.
 */
export function Palette({ onClose }: { onClose: () => void }) {
  const go = useNavigate()
  const tickets = useTickets()
  const plan = usePlanV2()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const before = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const all = useMemo(() => [...STATIC_ITEMS, ...skillItems(plan), ...ticketItems(tickets ?? [])], [plan, tickets])
  const items = useMemo(() => rank(all, q), [all, q])
  const sel = Math.min(at, Math.max(0, items.length - 1))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { document.getElementById(`pal-opt-${sel}`)?.scrollIntoView?.({ block: 'nearest' }) }, [sel])
  const close = () => { onClose(); queueMicrotask(() => before.current?.focus()) }
  // Esc also closes it when focus has strayed outside the dialog (a click on its backdrop edge)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })
  const open = (k: number) => { const it = items[k]; if (!it) return; close(); go(it.target) }
  return createPortal(
    <div className="pal-back" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div
        className="pal sr-panel" role="dialog" aria-modal="true" aria-label="Jump to" data-testid="shell-palette"
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') { e.preventDefault(); close() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(items.length - 1, sel + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, sel - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); open(sel) }
          else if (e.key === 'Tab') e.preventDefault()
        }}
      >
        <div className="pal-row">
          <Glyph name="search" size={3} />
          <input
            ref={input} className="pal-input" data-testid="shell-palette-input" role="combobox" aria-expanded={items.length > 0} aria-controls={items.length > 0 ? 'pal-list' : undefined} aria-autocomplete="list"
            aria-activedescendant={items[sel] ? `pal-opt-${sel}` : undefined}
            aria-label="Jump to a ticket, skill or setting" placeholder="Jump to a ticket, skill or setting" value={q} onChange={e => { setQ(e.target.value); setAt(0) }}
          />
          <kbd className="sh-kbd">Esc</kbd>
        </div>
        {items.length === 0 ? (
          <p className="pal-empty" data-testid="shell-palette-empty" data-empty="true">Nothing matches.</p>
        ) : (
          <ul id="pal-list" ref={list} className="pal-list" role="listbox" aria-label="Results">
            {items.map((it, k) => (
              <Fragment key={it.id}>
              {(k === 0 || SECTION_LABEL[items[k - 1].kind] !== SECTION_LABEL[it.kind]) && (
                <li role="presentation" aria-hidden="true" className="pal-sect" data-testid="shell-palette-section">{SECTION_LABEL[it.kind]}</li>
              )}
              <li id={`pal-opt-${k}`} role="option" aria-selected={k === sel} className="pal-item" data-testid="shell-palette-item" data-target={it.target} data-kind={it.kind}
                onMouseEnter={() => setAt(k)} onMouseDown={e => { e.preventDefault(); open(k) }}
              >
                <Glyph name={itemGlyph(it)} size={2} className="pal-ico" />
                <span className="pal-label" {...(it.kind === 'destination' || it.kind === 'page' ? {} : { 'data-content': 'plan' })}>{it.label}</span>
                <span className="pal-hint">{it.hint}</span>
                {it.key && <kbd className="sh-kbd">{it.key}</kbd>}
              </li>
              </Fragment>
            ))}
          </ul>
        )}
        <div className="pal-foot" data-testid="shell-palette-hint">
          <span><kbd className="sh-kbd">Enter</kbd> open</span><span><kbd className="sh-kbd">Esc</kbd> close</span>
          <span className="pal-foot-end">Type to search tickets and skills</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
