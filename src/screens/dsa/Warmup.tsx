import { lazy, Suspense, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { TOPIC_WARMUPS, atlasRowOf, walkDef } from '../../content/atlas'
import { isPlainClick, useNavigateAfterWrites } from '../../data/useNavigateAfterWrites'
import { Button } from '../../ui/primitives'

/**
 * VISUALIZER "four places" #2 (labs contract §6, D-5): a DSA topic opens with its walkthrough first, free.
 * Not autoplaying; seen / predicted here count on the Atlas exactly like watching there.
 */
// Lazy: the labs player and its engines are only needed once the warm-up is on screen (entry budget).
const AlgoPlayer = lazy(() => import('../../ui/algo/AlgoPlayer').then(m => ({ default: m.AlgoPlayer })))

export function Warmup({ sprint }: { sprint: number }) {
  const keys = TOPIC_WARMUPS[sprint] ?? []
  const [key, setKey] = useState(keys[0])
  const go = useNavigateAfterWrites()
  if (!key) return null
  const slug = atlasRowOf(key)
  const to = slug ? `/atlas?pattern=${slug}` : undefined
  // The just-finished walkthrough may still have a recordSeen/recordPredict write in flight (it's async,
  // fired inline from AlgoPlayer's completion effect): await it before leaving, or the Atlas row he's
  // about to check can read as not-yet-written (labs contract S39).
  function openInAtlas(e: MouseEvent) {
    if (!to || !isPlainClick(e)) return
    e.preventDefault()
    go(to)
  }
  return (
    <section className="warmup" aria-label="Warm-up" data-testid="dsa-warmup">
      <div className="warmup-head">
        <span className="sub-title">Warm-up · free</span>
        <div className="warmup-picks" role="group" aria-label="Warm-up walkthroughs">
          {keys.map(k => (
            <Button key={k} aria-pressed={k === key} onClick={() => setKey(k)}>{walkDef(k)!.title}</Button>
          ))}
        </div>
        {to && <Link to={to} onClick={openInAtlas} className="sr-btn sr-btn-quiet">Open in Atlas</Link>}
      </div>
      <Suspense fallback={<p className="loading">Loading the player…</p>}><AlgoPlayer key={key} walkKey={key} /></Suspense>
    </section>
  )
}
