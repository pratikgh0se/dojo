import { lazy, Suspense, type ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Today } from '../screens/Today'
import { Loading } from '../ui/Loading'
import { Screen, type ScreenName } from './Screen'

// Only Today (the first screen) stays in the entry chunk (budget 480 KB, scripts/bundle-check.mjs, ruling R17). Every
// other screen loads when it is opened: the ticket view, the design session, Path, Skills, Review, Settings, Guide and
// the DSA, Designs, Atlas and Banks screens (all on the rail). Board, Journal and AI topics add their own lazy route lines.
const Do = lazy(() => import('../screens/Do').then(m => ({ default: m.Do })))
const Path = lazy(() => import('../screens/Path').then(m => ({ default: m.Path })))
const Review = lazy(() => import('../screens/Review').then(m => ({ default: m.Review })))
const Journal = lazy(() => import('../screens/Journal').then(m => ({ default: m.Journal })))
const Skills = lazy(() => import('../screens/Skills').then(m => ({ default: m.Skills })))
const Guide = lazy(() => import('../screens/Guide').then(m => ({ default: m.Guide })))
const Settings = lazy(() => import('../screens/Settings').then(m => ({ default: m.Settings })))
const DesignSessionScreen = lazy(() =>
  import('../screens/designSession/DesignSessionScreen').then(m => ({ default: m.DesignSessionScreen })))
const Dsa = lazy(() => import('../screens/Dsa').then(m => ({ default: m.Dsa })))
const Atlas = lazy(() => import('../screens/Atlas').then(m => ({ default: m.Atlas })))
const Designs = lazy(() => import('../screens/Designs').then(m => ({ default: m.Designs })))
const Banks = lazy(() => import('../screens/Banks').then(m => ({ default: m.Banks })))
const Board = lazy(() => import('../screens/Board').then(m => ({ default: m.Board })))
const AiTopics = lazy(() => import('../screens/AiTopics').then(m => ({ default: m.AiTopics })))

/** While a screen's chunk loads: a calm block as tall as a short screen (no jump), the line itself only after 300 ms. */
function RouteFallback() {
  return <div className="sh-fallback"><Loading /></div>
}

const lazyScreen = (name: ScreenName, el: ReactElement) => (
  <Screen name={name}><Suspense fallback={<RouteFallback />}>{el}</Suspense></Screen>
)

/** SHELL-20: Week, Overview, Mentors, Ritual, Map, Progress, AI (`/ai`; the topics page is `/ai-topics`) and any unknown path end at Today (`*`). `/board` is a real route (board.md). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Screen name="today"><Today /></Screen>} />
      <Route path="/path" element={lazyScreen('path', <Path />)} />
      <Route path="/board" element={lazyScreen('board', <Board />)} />
      <Route path="/skills/*" element={lazyScreen('skills', <Skills />)} />
      <Route path="/journal" element={lazyScreen('journal', <Journal />)} />
      <Route path="/review" element={lazyScreen('review', <Review />)} />
      <Route path="/do/:ticketId" element={lazyScreen('do', <Do />)} />
      <Route path="/designs/session/:designId" element={lazyScreen('design-session', <DesignSessionScreen />)} />
      <Route path="/settings" element={lazyScreen('settings', <Settings />)} />
      <Route path="/guide" element={lazyScreen('guide', <Guide />)} />
      <Route path="/dsa" element={lazyScreen('dsa', <Dsa />)} />
      <Route path="/designs" element={lazyScreen('designs', <Designs />)} />
      <Route path="/atlas" element={lazyScreen('atlas', <Atlas />)} />
      <Route path="/banks" element={lazyScreen('banks', <Banks />)} />
      <Route path="/ai-topics" element={lazyScreen('ai-topics', <AiTopics />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
