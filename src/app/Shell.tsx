import { titleExternalLinks } from '../lib/linkTitles'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigationType } from 'react-router-dom'
import { useRollover } from '../data/useRollover'
import { useAutoReview } from '../data/useAutoReview'
import { isPlainClick, useNavigateAfterWrites } from '../data/useNavigateAfterWrites'
import { clearGaveUp, loadGaveUp } from '../lib/cycle'
import { DraftIndicator } from '../ui/DraftIndicator'
import { SaveStatus } from '../ui/SaveStatus'
import { TipHost } from '../ui/Tip'
import { SessionStrip } from '../study/SessionPill'
import { StudyHost } from '../study/StudyHost'
import { MoreMenu } from './MoreMenu'
import { useNativeNavigation } from './nativeMenu'
import { restoreScroll } from '../lib/restoreScroll'
import { noteScreen } from './origin'
import { AppRoutes } from './routes'
import { legendText, useLegendKeys } from './legend'
import { useShortcuts } from './shortcuts'
import { isFullScreenPath, isPhoneMoreTab, PRIMARY_TABS, TABS } from './tabs'

export { TABS }

const CheckGate = lazy(() => import('../screens/brief/CheckGate').then(m => ({ default: m.CheckGate })))

export function Shell() {
  const loc = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const openMore = useCallback(() => setMoreOpen(true), [])
  const fullScreen = isFullScreenPath(loc.pathname)
  const onDo = loc.pathname.startsWith('/do/')
  const go = useNavigateAfterWrites()
  useShortcuts(openMore)
  useNativeNavigation()
  const legendKeys = useLegendKeys()
  useRollover()
  useAutoReview()

  // UAT P2 (one place, the router): a new screen opens at the top (or at its #anchor); only Back / Forward
  // (a POP) returns to where that screen was. A change of query or hash on the same screen (a picked topic, an
  // Atlas row) keeps the scroll.
  const navType = useNavigationType()
  const scrollAt = useRef(new Map<string, number>())
  const lastPath = useRef<string | null>(null)
  useLayoutEffect(() => {
    const prev = lastPath.current
    lastPath.current = loc.pathname
    if (prev === loc.pathname) return
    if (navType === 'POP') {
      const y = scrollAt.current.get(loc.key)
      if (y !== undefined) return restoreScroll(y) // asks again each frame until the page (a bank that fills in late) is long enough (cu-5 P3-5)
    }
    const anchor = loc.hash ? document.getElementById(decodeURIComponent(loc.hash.slice(1))) : null
    if (anchor) anchor.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [loc.pathname, loc.key, loc.hash, navType])
  useEffect(() => {
    const key = loc.key
    const save = () => { scrollAt.current.set(key, window.scrollY) }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [loc.key])

  // UAT cu-r3b P3-3: external links show where they go
  useEffect(() => titleExternalLinks(), [])

  // UAT J7: where Do's Back returns to
  useEffect(() => {
    if (!isFullScreenPath(loc.pathname)) noteScreen(`${loc.pathname}${loc.search}${loc.hash}`)
  }, [loc.pathname, loc.search, loc.hash, loc.key])

  // C-LADDER §2.3: the given-up view survives reload but ends when the learner leaves that Do screen.
  useEffect(() => {
    const g = loadGaveUp()
    if (g && loc.pathname !== `/do/${g.ticketId}`) clearGaveUp()
  }, [loc.pathname])

  return (
    <div className="shell">
      <Suspense fallback={null}><CheckGate /></Suspense>
      {!fullScreen && (
        <header className="topbar">
          <span className="logo-cube" data-testid="logo-cube" aria-hidden="true" />
          <span className="wordmark">DOJO</span>
          <nav className="tabs" aria-label="Main">
            {PRIMARY_TABS.map(t => (
              <NavLink
                key={t.to} to={t.to} end={t.to === '/'} aria-keyshortcuts={t.key ?? undefined} className={({ isActive }) => `tab${isPhoneMoreTab(t) ? ' tab-wide' : ''}${isActive ? ' tab-on' : ''}`}
                onClick={e => { if (isPlainClick(e)) { e.preventDefault(); go(t.to) } }}
              >
                {t.label}
              </NavLink>
            ))}
            <MoreMenu open={moreOpen} onOpenChange={setMoreOpen} />
          </nav>
          <SaveStatus />
        </header>
      )}
      {/* ruling 24 S1: a running study session is visible on every screen with a header; Do and the design session dock it themselves */}
      {!fullScreen && <SessionStrip />}
      {onDo ? (
        <div className="do-main"><AppRoutes /></div>
      ) : (
        <main className={fullScreen ? 'do-main' : 'page'}><AppRoutes /></main>
      )}
      <StudyHost />
      <DraftIndicator />
      <TipHost />
      {!fullScreen && <footer className="keys-legend"><p className="keys-legend-text" data-testid="keys-legend">{legendText(legendKeys)}</p></footer>}
    </div>
  )
}
