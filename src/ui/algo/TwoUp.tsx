import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { WALKTHROUGHS, walkDef, type InputKind } from '../../content/atlas'
import { INPUT_DEFAULTS } from '../../content/libraryInputs'
import { isTypingTarget } from '../../lib/keys'
import { loadOwnRaw, saveOwnRaw, clearOwnRaw } from '../../lib/ownInputStore'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { initialPlayer, playerReducer, playLabel, SPEEDS, stepInterval, type PlayerAction, type PlayerState } from '../../rules/player'
import type { PredictQuestion } from '../../rules/predict'
import { Button } from '../primitives'
import { AlgoPlayer, REDUCED_MOTION } from './AlgoPlayer'
import { OwnInputForm } from './OwnInputForm'

const NO_QUESTIONS = new Map<number, PredictQuestion>()
/** Input kinds that take the same input (§4.5: every graph kind accepts the weighted graph). */
const family = (k: InputKind | undefined) => (k === 'graphStart' || k === 'graph' ? 'graph' : k)

/**
 * Two-up (VISUALIZER "Two-up"; labs contract §4.5, D-9): two players and one shared control bar. One press
 * moves both; the shorter one holds its final frame. Same input kind → both run on the left player's input
 * and the header's Own input applies to both; otherwise each keeps its default and a note says so.
 */
export function TwoUp({ left, right, onRight, onClose }: { left: string; right: string; onRight: (key: string) => void; onClose: () => void }) {
  const same = !!walkDef(left)?.input && !!walkDef(right)?.input && family(walkDef(left)?.input) === family(walkDef(right)?.input)
  const [raw, setRaw] = useState<Record<string, string>>(() => loadOwnRaw(left) ?? { ...(INPUT_DEFAULTS[left] ?? {}) })
  const [showForm, setShowForm] = useState(false)
  const [sizes, setSizes] = useState<{ l: number; r: number }>({ l: 0, r: 0 })
  const [speed, setSpeed] = useState(1)
  const reduced = useMediaQuery(REDUCED_MOTION)
  const max = Math.max(sizes.l, sizes.r)
  const [s, dispatch] = useReducer((st: PlayerState, a: PlayerAction) => playerReducer(st, a, NO_QUESTIONS), undefined, () => initialPlayer(0))
  const maxRef = useRef(max)
  useEffect(() => {
    if (maxRef.current !== max) dispatch({ type: 'load', n: max })
    maxRef.current = max
  }, [max])
  useEffect(() => {
    if (!s.playing) return
    const id = window.setInterval(() => dispatch({ type: 'forward' }), stepInterval(speed, reduced))
    return () => window.clearInterval(id)
  }, [s.playing, speed, reduced])
  const onLeft = useCallback((n: number) => setSizes(z => ({ ...z, l: n })), [])
  const onRightN = useCallback((n: number) => setSizes(z => ({ ...z, r: n })), [])

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (isTypingTarget(e.target)) return
    const onPlay = (e.target as HTMLElement).dataset?.lab === 'play'
    const act: PlayerAction | null = e.key === 'ArrowRight' ? { type: 'forward' } : e.key === 'ArrowLeft' ? { type: 'back' } : e.key === ' ' && !onPlay ? { type: 'toggle' } : null
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    dispatch(act)
  }

  const follow = { k: s.k, jumped: s.jumped }
  return (
    <section className="lab-two-up" aria-label="Two-up" data-testid="lab-two-up" tabIndex={-1} onKeyDownCapture={onKeyDown}>
      <div className="lab-two-up-head">
        <label className="lab-compare">
          Compare with
          <select value={right} onChange={e => onRight(e.target.value)}>
            {WALKTHROUGHS.map(w => <option key={w.key} value={w.key}>{w.title}</option>)}
          </select>
        </label>
        <Button aria-expanded={same ? showForm : undefined} disabled={!same} onClick={() => setShowForm(v => !v)}>Own input</Button>
        <Button variant="quiet" onClick={onClose}>Close two-up</Button>
      </div>
      {!same && <p className="lab-two-up-note" data-testid="lab-two-up-note">Different inputs: these walkthroughs take different input shapes.</p>}
      {same && showForm && (
        <OwnInputForm
          walkKey={left}
          title={walkDef(left)!.title}
          initial={raw}
          onTrace={r => {
            saveOwnRaw(left, r)
            setRaw({ ...r })
          }}
          onReset={() => {
            clearOwnRaw(left)
            setRaw({ ...INPUT_DEFAULTS[left] })
          }}
        />
      )}
      <div className="lab-bar lab-two-up-bar">
        <Button onClick={() => dispatch({ type: 'first' })}>First step</Button>
        <Button disabled={s.k === 0} onClick={() => dispatch({ type: 'back' })}>Step back</Button>
        <Button variant="accent" data-lab="play" onClick={() => dispatch({ type: 'toggle' })}>{playLabel(s)}</Button>
        <Button disabled={s.k >= max} onClick={() => dispatch({ type: 'forward' })}>Step forward</Button>
        <Button disabled={s.k >= max} onClick={() => dispatch({ type: 'last' })}>Last step</Button>
        <select className="lab-speed" aria-label="Speed" value={String(speed)} onChange={e => setSpeed(Number(e.target.value))}>
          {SPEEDS.map(x => <option key={x} value={String(x)}>{`${x}×`}</option>)}
        </select>
        <span className="lab-counter" data-testid="lab-two-up-counter">{`STEP ${s.k} / ${max}`}</span>
        <Button disabled>Predict</Button>
      </div>
      <div className="lab-two-up-players">
        <AlgoPlayer key={`l-${left}`} walkKey={left} follow={follow} sharedRaw={same ? raw : null} onLoaded={onLeft} />
        <AlgoPlayer key={`r-${right}`} walkKey={right} follow={follow} sharedRaw={same ? raw : null} onLoaded={onRightN} />
      </div>
    </section>
  )
}
