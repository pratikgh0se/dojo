import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Dsa } from '../screens/Dsa'
import { Today } from '../screens/Today'
import { Screen } from './Screen'
import { Loading } from '../ui/Loading'

// Lazy: after the labs and design merges the entry chunk was over the 480 KB budget (integration
// spec §7, scripts/bundle-check.mjs). Do, the design session screen, Atlas, Designs and Banks are
// genuinely heavy (help ladder/AI job wiring for Do; the drawing canvas, interviewer and score form
// for the design session; the labs AlgoPlayer engine wiring for Atlas; the deep-dive wall, lens
// charts and diagram shelf for Designs; the five bank datasets for Banks) and none is needed until a
// learner opens that tab. Ai, Board, Map and Settings are not especially heavy on their own but moved
// the entry chunk the rest of the way under budget. Progress pulls in the DSA/design/AI evidence
// rules and every chart, which later grew past "small" too (a further round of parity fixes pushed
// the entry back over budget) - it's lazy now as well. Week, Overview, Mentors and Ritual went lazy in
// the UX part 2 bundle pass (about 25 KB); only Today and DSA stay eager (Today is always the first screen).
const Mentors = lazy(() => import('../screens/Mentors').then(m => ({ default: m.Mentors })))
const Overview = lazy(() => import('../screens/Overview').then(m => ({ default: m.Overview })))
const Ritual = lazy(() => import('../screens/Ritual').then(m => ({ default: m.Ritual })))
const Week = lazy(() => import('../screens/Week').then(m => ({ default: m.Week })))
const Do = lazy(() => import('../screens/Do').then(m => ({ default: m.Do })))
const Progress = lazy(() => import('../screens/Progress').then(m => ({ default: m.Progress })))
const DesignSessionScreen = lazy(() =>
  import('../screens/designSession/DesignSessionScreen').then(m => ({ default: m.DesignSessionScreen })))
const Atlas = lazy(() => import('../screens/Atlas').then(m => ({ default: m.Atlas })))
const Designs = lazy(() => import('../screens/Designs').then(m => ({ default: m.Designs })))
const Banks = lazy(() => import('../screens/Banks').then(m => ({ default: m.Banks })))
const Ai = lazy(() => import('../screens/Ai').then(m => ({ default: m.Ai })))
const Board = lazy(() => import('../screens/Board').then(m => ({ default: m.Board })))
const MapView = lazy(() => import('../screens/Map').then(m => ({ default: m.MapView })))
const Settings = lazy(() => import('../screens/Settings').then(m => ({ default: m.Settings })))

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Screen name="today"><Today /></Screen>} />
      <Route path="/board" element={<Screen name="board"><Suspense fallback={<Loading />}><Board /></Suspense></Screen>} />
      <Route path="/dsa" element={<Screen name="dsa"><Dsa /></Screen>} />
      <Route path="/designs" element={<Screen name="designs"><Suspense fallback={<Loading />}><Designs /></Suspense></Screen>} />
      <Route path="/designs/session/:designId" element={<Screen name="design-session"><Suspense fallback={<Loading />}><DesignSessionScreen /></Suspense></Screen>} />
      <Route path="/atlas" element={<Screen name="atlas"><Suspense fallback={<Loading />}><Atlas /></Suspense></Screen>} />
      <Route path="/banks" element={<Screen name="banks"><Suspense fallback={<Loading />}><Banks /></Suspense></Screen>} />
      <Route path="/ai" element={<Screen name="ai"><Suspense fallback={<Loading />}><Ai /></Suspense></Screen>} />
      <Route path="/map" element={<Screen name="map"><Suspense fallback={<Loading />}><MapView /></Suspense></Screen>} />
      <Route path="/progress" element={<Screen name="progress"><Suspense fallback={<Loading />}><Progress /></Suspense></Screen>} />
      <Route path="/week" element={<Screen name="week"><Suspense fallback={<Loading />}><Week /></Suspense></Screen>} />
      <Route path="/overview" element={<Screen name="overview"><Suspense fallback={<Loading />}><Overview /></Suspense></Screen>} />
      <Route path="/mentors" element={<Screen name="mentors"><Suspense fallback={<Loading />}><Mentors /></Suspense></Screen>} />
      <Route path="/ritual" element={<Screen name="ritual"><Suspense fallback={<Loading />}><Ritual /></Suspense></Screen>} />
      <Route path="/do/:ticketId" element={<Screen name="do"><Suspense fallback={<Loading />}><Do /></Suspense></Screen>} />
      <Route path="/settings" element={<Screen name="settings"><Suspense fallback={<Loading />}><Settings /></Suspense></Screen>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
