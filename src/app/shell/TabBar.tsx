import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { DESTINATIONS, MORE_IDS, TAB_IDS, type DestinationId } from '../../rules/nav'
import { Glyph } from '../../ui/Glyph'
import { NavItem } from './Rail'

/**
 * Under 768 px: a bottom bar of Today, Path, Board, Review and More, labels always shown (SHELL-12, NAV-09). More opens the
 * sheet of the other nine destinations directly above the bar (NAV-10 to NAV-14).
 */
export function TabBar({ current, badge }: { current: DestinationId | null; badge: number }) {
  const key = useLocation().key
  const [open, setOpen] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => { setOpen(false) }, [key]) // a destination was chosen
  useEffect(() => {
    if (!open) return
    sheet.current?.querySelector<HTMLElement>('a')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); more.current?.focus() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  const inMore = current !== null && MORE_IDS.includes(current)
  const item = (id: DestinationId) => <NavItem key={id} id={id} current={current} badge={badge} variant="sheet" />
  const group = (ids: DestinationId[]) => ids.map(item)
  const ofGroup = (g: string) => DESTINATIONS.filter(d => d.group === g).map(d => d.id)
  return (
    <>
      {open && (
        <>
          {/* a tap anywhere above the bar, outside the sheet, closes it (NAV-12); the bar itself stays reachable */}
          <div className="sh-more-back" data-testid="shell-more-backdrop" onMouseDown={() => setOpen(false)} onTouchStart={() => setOpen(false)} />
          <div ref={sheet} id="sh-more" className="sh-more sr-panel" role="dialog" aria-label="More destinations" data-testid="shell-more-sheet">
            <div className="sh-more-group">{group(['journal', 'skills'])}</div>
            <div className="sh-more-group">
              <h2 className="sh-more-title" data-testid="shell-more-group-title-topics">Topics</h2>
              {group(ofGroup('topics'))}
            </div>
            <div className="sh-more-group">
              <h2 className="sh-more-title" data-testid="shell-more-group-title-practice">Practice</h2>
              {group(ofGroup('practice'))}
            </div>
            <div className="sh-more-group">{group(ofGroup('foot'))}</div>
          </div>
        </>
      )}
      <nav className="sh-tabbar" data-testid="shell-tabbar" aria-label="Destinations">
        {TAB_IDS.map(id => <NavItem key={id} id={id} current={current} badge={badge} variant="tab" />)}
        <button
          ref={more} type="button" className={`sh-tb${inMore ? ' on' : ''}`} data-testid="shell-tab-more"
          aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? 'sh-more' : undefined} aria-current={inMore ? 'page' : undefined}
          onClick={() => setOpen(o => !o)}
        >
          <Glyph name="more" size={3} />
          <span className="sh-rl">More</span>
        </button>
      </nav>
    </>
  )
}
