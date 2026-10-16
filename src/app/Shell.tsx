import { titleExternalLinks } from '../lib/linkTitles'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { useSettings } from '../data/hooks'
import { clearGaveUp, loadGaveUp } from '../lib/cycle'
import { restoreScroll } from '../lib/restoreScroll'
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import { currentDestination, titleFor } from '../rules/nav'
import { DraftIndicator } from '../ui/DraftIndicator'
import { TipHost } from '../ui/Tip'
import { SessionStrip } from '../study/SessionPill'
import { StudyHost } from '../study/StudyHost'
import { useNativeNavigation } from './nativeMenu'
import { noteScreen } from './origin'
import { AppRoutes } from './routes'
import { Header } from './shell/Header'
import { Palette } from './shell/Palette'
import { PlanChanged } from './shell/PlanChanged'
import { Rail } from './shell/Rail'
import { Shortcuts } from './shell/Shortcuts'
import { TabBar } from './shell/TabBar'
import { useDueReviews } from './useDueReviews'
import { useGlobalKeys } from './useGlobalKeys'
import { useRailLabels } from './useRailLabels'
import { RailStateContext, ShellActionsContext } from './shellActions'
import './shell/shell.css'


/** A ticket and a design session are worked in the shell too; they dock their own timer and draw their own heading. */
const isWorkPath = (p: string) => p.startsWith('/do/') || p.startsWith('/designs/session/')

export function Shell() {
  const loc = useLocation()
  const phone = useMediaQuery(NARROW_QUERY)
  const rail = useRailLabels()
  const settingsKnown = useSettings() !== undefined // the rail's width depends on the stored label setting: draw it once that is read, not 56 px first and 200 after
  const reviews = useDueReviews()
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const openPalette = useCallback(() => { setShortcuts(false); setPalette(p => !p) }, [])
  const openShortcuts = useCallback(() => setShortcuts(true), [])
  useGlobalKeys({ overlayOpen: palette || shortcuts, onPalette: openPalette, onShortcuts: openShortcuts })
  useNativeNavigation()

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
    if (!isWorkPath(loc.pathname)) noteScreen(`${loc.pathname}${loc.search}${loc.hash}`)
  }, [loc.pathname, loc.search, loc.hash, loc.key])

  // C-LADDER §2.3: the given-up view survives reload but ends when the learner leaves that Do screen.
  useEffect(() => {
    const g = loadGaveUp()
    if (g && loc.pathname !== `/do/${g.ticketId}`) clearGaveUp()
  }, [loc.pathname])

  const work = isWorkPath(loc.pathname)
  const current = currentDestination(loc.pathname)
  const badge = reviews?.length ?? 0
  const actions = useMemo(() => ({ openShortcuts }), [openShortcuts])
  return (
    <RailStateContext.Provider value={rail}>
    <ShellActionsContext.Provider value={actions}>
    <div className="sh-app" data-phone={phone ? 'true' : 'false'}>
      {!phone && settingsKnown && <Rail expanded={rail.expanded} current={current} badge={badge} onToggle={rail.toggle} />}
      <div className="sh-col">
        <Header title={titleFor(loc.pathname)} own={work} phone={phone} onSearch={openPalette} onShortcuts={openShortcuts} />
        {/* ruling 24 S1: a running study session is visible on every screen with a header; Do and the design session dock it themselves */}
        {!work && <SessionStrip />}
        <PlanChanged />
        <main className="page sh-main" data-work={work ? 'true' : 'false'}><AppRoutes /></main>
      </div>
      {phone && <TabBar current={current} badge={badge} />}
      <StudyHost />
      <DraftIndicator />
      <TipHost />
      {palette && <Palette onClose={() => setPalette(false)} />}
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} onPalette={openPalette} />}
    </div>
    </ShellActionsContext.Provider>
    </RailStateContext.Provider>
  )
}
