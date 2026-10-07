import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { isPlainClick, useNavigateAfterWrites } from '../data/useNavigateAfterWrites'
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import { isPhoneMoreTab, MORE_TABS, TABS, tabForPath } from './tabs'

export function MoreMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const loc = useLocation()
  const go = useNavigateAfterWrites()
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const closeRef = useRef(onOpenChange)
  closeRef.current = onOpenChange

  const phone = useMediaQuery(NARROW_QUERY)
  // ui-shell S2: on phone, Designs and AI lead the menu (they leave the nav row there).
  const menuTabs = phone ? [...TABS.filter(isPhoneMoreTab), ...MORE_TABS] : MORE_TABS
  const here = tabForPath(loc.pathname)
  const current = here && (here.group === 'more' || (phone && isPhoneMoreTab(here))) ? here : undefined
  // P3-14 (ui-shell S1): the button reads "More · <Tab> ▾" wherever that fits its row, and "More ▾" (accent colour, the
  // full name in aria-label) where it does not. The row is measured, not guessed: the longest tab name, the width of
  // the window and the font all decide. The DOM attribute is set directly, so a resize never goes through a render.
  useLayoutEffect(() => {
    const btn = btnRef.current
    const nav = btn?.closest('nav') ?? null
    const bar = nav?.parentElement ?? null
    if (!btn || !nav || !bar) return
    const fit = () => {
      nav.removeAttribute('data-more-short')
      const cs = getComputedStyle(bar)
      const right = bar.getBoundingClientRect().right - parseFloat(cs.paddingRight || '0')
      if (btn.getBoundingClientRect().right > right + 0.5) nav.setAttribute('data-more-short', '')
    }
    fit()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    ro?.observe(bar)
    const fonts = document.fonts
    void fonts?.ready.then(fit)
    fonts?.addEventListener?.('loadingdone', fit)
    return () => { ro?.disconnect(); fonts?.removeEventListener?.('loadingdone', fit); nav.removeAttribute('data-more-short') }
  }, [current?.to, phone])

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (open) setActive(0)
  }, [open])

  useEffect(() => {
    if (open) items()[active]?.focus()
  }, [open, active])

  // Any navigation (menu row, number key, Back) closes the menu.
  useEffect(() => {
    closeRef.current(false)
  }, [loc.pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeRef.current(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (restoreFocus: boolean) => {
    onOpenChange(false)
    if (restoreFocus) btnRef.current?.focus()
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const n = items().length
    if (n === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => (a + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => (a - 1 + n) % n)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(n - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') {
      close(false)
    } else if (e.key === 'Enter') {
      const to = items()[active]?.dataset.to
      if (to) {
        e.preventDefault()
        go(to)
        close(false)
      }
    }
  }

  return (
    <div className="more" ref={rootRef}>
      {/* UAT J2: on the one-row desktop header the button's box holds its widest label ("More · Overview ▾"),
          so "More ▾" -> "More · Settings ▾" never moves the tabs to its left (labels drawn by CSS, not DOM text). */}
      {MORE_TABS.map(t => <span key={t.to} className="more-sizer" aria-hidden="true"><span className="more-sizer-label" data-label={`· ${t.label}`} /></span>)}
      <div className="more-anchor">
      <button
        ref={btnRef}
        type="button"
        className={`tab more-btn${current ? ' tab-on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="more-menu"
        data-testid="more-button"
        aria-label={`More${current ? ` · ${current.label}` : ''} ▾`}
        onClick={() => (open ? close(true) : onOpenChange(true))}
      >
        More{current && <span className="more-current"> · {current.label}</span>} ▾
      </button>
      {open && (
        <div id="more-menu" role="menu" aria-label="More" className="more-menu" ref={menuRef} onKeyDown={onMenuKey}>
          {menuTabs.map((t, i) => (
            <Link
              key={t.to}
              to={t.to}
              role="menuitem"
              aria-label={t.label}
              aria-keyshortcuts={t.key ?? undefined}
              data-to={t.to}
              tabIndex={i === active ? 0 : -1}
              className={`more-item${current?.to === t.to ? ' on' : ''}`}
              onFocus={() => setActive(i)}
              onClick={e => { if (isPlainClick(e)) { e.preventDefault(); go(t.to) } close(false) }}
            >
              <span className="more-label">{t.label}</span>
              <span className="more-key" aria-hidden="true">{t.key ?? ''}</span>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
