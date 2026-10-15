import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { isPaletteKey } from '../../rules/keyScope'
import { DESTINATIONS } from '../../rules/nav'
import { useLegendKeys } from '../legend'

const GLOBAL: [string, string][] = [
  ...DESTINATIONS.filter(d => d.key).map((d): [string, string] => [d.key!, d.label]),
  ['Ctrl/Cmd+K', 'Jump to anything'], ['?', 'This list'], ['Enter', 'Start the next ticket (Today)'], ['Esc', 'Close a menu or a dialog'],
]
const CANVAS: [string, string][] = [['N', 'Add a note'], ['C', 'Add a custom box'], ['T', 'Add a table'], ['G', 'Group into a frame']]

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The `?` overlay (SHELL-19): a dialog that exists only while open. Tab stays inside it, Ctrl or Cmd K hands over to the
 * palette, Esc closes it and focus goes back where it was (the gear, when it was opened from there).
 */
export function Shortcuts({ onClose, onPalette }: { onClose: () => void; onPalette: () => void }) {
  const screenKeys = useLegendKeys()
  const ref = useRef<HTMLDivElement>(null)
  const before = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { ref.current?.focus() }, [])
  const close = () => { onClose(); queueMicrotask(() => before.current?.focus()) }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })
  return createPortal(
    <div className="pal-back" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={ref} tabIndex={-1} className="pal sr-panel sh-sc" role="dialog" aria-modal="true" aria-label="Shortcuts" data-testid="shell-shortcuts"
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') { e.preventDefault(); close() }
          else if (isPaletteKey(e)) { e.preventDefault(); before.current?.focus(); onPalette() } // the palette replaces this overlay and returns focus to where this one found it
          else if (e.key === 'Tab') {
            const f = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
            const first = f[0]
            const last = f[f.length - 1]
            const at = document.activeElement
            if (!first) e.preventDefault()
            else if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
          }
        }}
      >
        <h2 className="sh-sch">Shortcuts</h2>
        <dl className="sh-dl">{GLOBAL.map(([k, v]) => <div key={k}><dt><kbd className="sh-kbd">{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        {screenKeys.length > 0 && <><h3 className="sh-cap">On this screen</h3><ul className="sh-sl">{screenKeys.map(k => <li key={k}>{k}</li>)}</ul></>}
        <h3 className="sh-cap">Design canvas</h3>
        <dl className="sh-dl">{CANVAS.map(([k, v]) => <div key={k}><dt><kbd className="sh-kbd">{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <Link to="/guide" className="sh-sc-guide" data-testid="shell-shortcuts-guide" onClick={onClose}>How Dojo works</Link>
        <button type="button" className="sr-btn sr-btn-quiet" onClick={close}>Close</button>
        <div className="pal-foot">Esc to close · Ctrl/Cmd+K to jump to anything</div>
      </div>
    </div>,
    document.body,
  )
}
