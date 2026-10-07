// The one picture player (VISUALIZER "four places, one engine"; labs contract §4): Atlas, DSA warm-ups,
// the Approaches strip, and (milestone 3) the Do screen's Picture rung. The engine (<sr-algo>/<sr-algo2>,
// frozen) draws only the frame; everything the tester touches is light DOM here: header, code with the
// active line, caption, controls, counter, predict, own input, snapshot (§0 "Shadow DOM").
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useDb } from '../../app/providers'
import { walkDef } from '../../content/atlas'
import { INPUT_DEFAULTS } from '../../content/libraryInputs'
import { recordPredict, recordSeen } from '../../data/atlasActions'
import { safeWrite } from '../../data/safeWrite'
import { now } from '../../lib/clock'
import { isTypingTarget } from '../../lib/keys'
import { clearOwnRaw, loadOwnRaw, saveOwnRaw } from '../../lib/ownInputStore'
import { downloadBlob, framePng, snapshotFileName } from '../../lib/snapshot'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { engineFor, type AlgoJson } from '../../rules/algoJson'
import { parseOwnInput } from '../../rules/ownInput'
import { playerView, viewQuestions } from '../../rules/narration'
import { initialPlayer, playerReducer, playLabel, predictScore, scrubStep, SPEEDS, stepInterval, type PlayerAction, type PlayerState } from '../../rules/player'
import { predictQuestions, predictResult, type PredictQuestion } from '../../rules/predict'
import { resolveWalk, type AlgoGlobals } from '../../rules/walkthrough'
import { SrAlgo, type AlgoElement } from '../engines/SrAlgo'
import { Button, useToast } from '../primitives'
import { OwnInputForm } from './OwnInputForm'
import { useAlgoEngines } from './useAlgoEngines'
import './algo.css'

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const FIXED_NOTE = 'Fixed example: no own input.'
/** Hides the engine's own header, caption and control bar: the wrapper shows them in the light DOM.
 * `.say` is only hidden inside a normal render (one that also has a `.bar`): the engine's own error
 * render (`load()`/`build()`, bad or missing `structures`) is a lone `.wrap > .say` with no `.bar`
 * sibling, and that text ("NO ALGORITHM · …") must still show — there is no light-DOM caption for it. */
const ENGINE_STYLE = '.head,.bar{display:none!important}.wrap:has(.bar) .say{display:none!important}.wrap{border:0!important}'

/** Foundation's `AlgoElement` type is narrower than what algo.js/algo2.js really expose at runtime. */
type FullAlgoElement = AlgoElement & { k: number; playing?: boolean; go(k: number): void; play(): void; pause(): void }

export interface AlgoPlayerProps {
  /** walkthrough key (content/atlas.ts WALKTHROUGHS) */
  walkKey?: string
  /** explicit step JSON: the seam for a generated picture (AI `picture` job, later milestone); records nothing */
  json?: AlgoJson
  /** false stops this player writing seen / predict runs */
  record?: boolean
  /** start playing once loaded (Atlas "Play") */
  autoplay?: boolean
  /** open in predict mode (Atlas "Predict") */
  startPredict?: boolean
  /** open with the own-input form showing (Atlas "Own input", "Trace my own input") */
  openInput?: boolean
  /** shows "Close player" (players opened on demand) */
  onClose?: () => void
  /** Two-up: the shared bar owns the step; this player shows min(k, n) and keeps only Snapshot */
  follow?: { k: number; jumped: boolean }
  /** Two-up: the shared own-input text (same input kind); parsed with this player's own key */
  sharedRaw?: Record<string, string> | null
  /** reports the step count whenever the walkthrough (or its input) loads */
  onLoaded?: (n: number) => void
}

/**
 * Engine JSON without code and vars: the wrapper draws those, so the engine gives the frame the full width.
 * UAT r2 J6: `vars` must be null, not undefined. algo.js computes `hasSide = code.length > 0 || … || d.vars`, which
 * is then `undefined`, and `wrap.classList.toggle('wide', undefined)` *toggles*: the frame flipped between one column
 * and the 3fr/2fr two-column layout on every step (the pane 605 → 375 px, with a scrollbar). null gives `false`.
 * SEC-D-01: no title, complexity or error either. The engine's `.head` is hidden (the wrapper shows the header in
 * React), so the picture's free text never reaches the engine's HTML at all (defence in depth).
 */
export function frameOnly(json: AlgoJson): AlgoJson {
  const { title: _t, complexity: _c, error: _e, ...rest } = json as AlgoJson & { error?: unknown }
  return { ...rest, code: [], vars: null, steps: json.steps.map(({ vars: _v, ...s }) => s) } as unknown as AlgoJson
}

/** UAT r2 J6: the variables shown at step k are the latest ones set at or before k (a line-only step keeps them). */
export function liveVars(json: AlgoJson, k: number): Record<string, unknown> {
  for (let i = Math.min(k, json.steps.length); i >= 1; i--) {
    const v = json.steps[i - 1]?.vars
    if (v && Object.keys(v).length > 0) return v
  }
  return (json as { vars?: Record<string, unknown> }).vars ?? {}
}

function caption(json: AlgoJson, k: number): string {
  const n = json.steps.length
  if (k === n && n > 0 && json.outro) return json.outro
  if (k === 0) return json.intro ?? 'Press PLAY or step with the arrow keys.'
  return json.steps[k - 1]?.say ?? ''
}

const show = (v: unknown) => (v === Infinity || v === 'inf' ? '∞' : v == null ? '·' : String(v))

/**
 * Prototype parity (Algorithm Lab §01 "THE PLAYER"): a block scrubber next to the step counter, one block
 * per step (capped and binned like the prototype's `.scrub` for long walkthroughs), filled up to the current
 * step. A click or drag on it goes to that block's step (UAT cu-6 P3-2). Pointer only (aria-hidden): the step
 * buttons and the arrow keys are its keyboard form, and the counter (`lab-step-counter`) is what the tester reads.
 */
function Scrubber({ k, n, enabled, onSeek }: { k: number; n: number; enabled: boolean; onSeek: (k: number) => void }) {
  if (n <= 0) return <span className="lab-scrub" aria-hidden="true" />
  const bins = Math.min(n, 60)
  const cur = Math.min(bins - 1, Math.max(0, Math.ceil((k / n) * bins) - 1))
  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(scrubStep(r.width > 0 ? (e.clientX - r.left) / r.width : 0, n))
  }
  return (
    <span
      className="lab-scrub"
      data-testid="lab-scrub"
      data-enabled={enabled ? 'true' : 'false'}
      aria-hidden="true"
      onPointerDown={e => {
        if (!enabled || e.button !== 0) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        at(e)
      }}
      onPointerMove={e => { if (enabled && e.currentTarget.hasPointerCapture?.(e.pointerId)) at(e) }}
    >
      {Array.from({ length: bins }, (_, i) => {
        const f = ((i + 1) / bins) * n
        const on = f <= k
        return <i key={i} className={on ? (i === cur ? 'cur' : 'on') : undefined} />
      })}
    </span>
  )
}

export function AlgoPlayer(props: AlgoPlayerProps) {
  const { walkKey, json: explicit, record = true, follow, sharedRaw } = props
  const d = useDb()
  const toast = useToast()
  const engines = useAlgoEngines()
  const reduced = useMediaQuery(REDUCED_MOTION)
  const def = walkKey ? walkDef(walkKey) : undefined
  const runnable = !!def?.input && !explicit
  const [ownRaw, setOwnRaw] = useState<Record<string, string> | null>(() => (walkKey && runnable ? loadOwnRaw(walkKey) : null))
  const [showForm, setShowForm] = useState(!!props.openInput && runnable && !follow)
  const [speed, setSpeed] = useState(1)
  const elRef = useRef<FullAlgoElement | null>(null)
  const fixedId = useId()

  // The input: the two-up's shared text, else his remembered own input, else the engine default.
  const input = useMemo(() => {
    if (!walkKey || !runnable) return undefined
    const raw = sharedRaw ? { ...INPUT_DEFAULTS[walkKey], ...sharedRaw } : ownRaw
    if (!raw) return undefined
    const r = parseOwnInput(walkKey, raw)
    return r.ok ? r.value : undefined
  }, [walkKey, runnable, sharedRaw, ownRaw])

  const resolved = useMemo(() => {
    if (engines.state !== 'ready') return null
    if (explicit) return { ok: true as const, json: explicit }
    if (!walkKey) return { ok: false as const, error: 'Nothing to play' }
    return resolveWalk(walkKey, input, window as unknown as AlgoGlobals)
  }, [explicit, walkKey, input, engines.state])
  // UAT r3 J6: the engine gets every op (`raw`); the player steps through `json`, the narrated groups of them
  // (rules/narration.ts), and shows engine step view.at[k] at its step k.
  const raw = resolved?.ok ? resolved.json : null
  const view = useMemo(() => (raw ? playerView(raw) : null), [raw])
  const json = view?.json ?? null
  const n = json?.steps.length ?? 0
  const frame = useMemo(() => (raw ? frameOnly(raw) : null), [raw])
  const questions = useMemo(
    () => new Map<number, PredictQuestion>((raw && view ? viewQuestions(predictQuestions(raw), view) : []).map(q => [q.step, q])),
    [raw, view],
  )
  const qRef = useRef(questions)
  qRef.current = questions
  const [state, dispatch] = useReducer((s: PlayerState, a: PlayerAction) => playerReducer(s, a, qRef.current), undefined, () =>
    initialPlayer(0, !!props.startPredict),
  )

  // A new walkthrough or input starts over at k = 0 (§4.6 "Trace … reloads the player at k = 0").
  const autoplay = useRef(!!props.autoplay)
  const onLoaded = useRef(props.onLoaded)
  onLoaded.current = props.onLoaded
  useEffect(() => {
    if (!json) return
    dispatch({ type: 'load', n: json.steps.length })
    onLoaded.current?.(json.steps.length)
    if (autoplay.current) {
      autoplay.current = false
      dispatch({ type: 'play' })
    }
  }, [json])

  const k = follow ? Math.min(follow.k, n) : Math.min(state.k, n)
  const jumped = follow ? follow.jumped : state.jumped

  // Auto-advance: 600 ms per step at 1× (900 ms under reduced motion), divided by the speed (§4.2).
  useEffect(() => {
    if (follow || !state.playing) return
    const id = window.setInterval(() => dispatch({ type: 'forward' }), stepInterval(speed, reduced))
    return () => window.clearInterval(id)
  }, [follow, state.playing, speed, reduced])

  // UAT J6: the controls never move while stepping. The frame keeps one box for the whole trace (fitEngineDrawings);
  // here the caption and the variables keep the height of their tallest step, measured once per trace and width
  // with a hidden copy of each, so the bar below them stays put.
  const playerRef = useRef<HTMLElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)
  const varsRef = useRef<HTMLDListElement>(null)
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = playerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(es => setBoxW(Math.round(es[0]?.contentRect.width ?? 0)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [json])
  useLayoutEffect(() => {
    if (!json) return
    const measure = (el: HTMLElement | null, fill: (probe: HTMLElement, i: number) => void) => {
      if (!el?.parentElement) return
      el.style.minHeight = ''
      const probe = el.cloneNode(false) as HTMLElement
      probe.removeAttribute('data-testid')
      probe.setAttribute('aria-hidden', 'true')
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', width: `${el.getBoundingClientRect().width}px`, minHeight: '' })
      el.parentElement.appendChild(probe)
      let max = 0
      for (let i = 0; i <= Math.min(n, 600); i++) { fill(probe, i); max = Math.max(max, probe.getBoundingClientRect().height) }
      probe.remove()
      if (max > 0) el.style.minHeight = `${Math.ceil(max)}px`
    }
    measure(captionRef.current, (p, i) => { p.textContent = caption(json, i) })
    measure(varsRef.current, (p, i) => {
      const vv = liveVars(json, i)
      p.replaceChildren(...Object.entries(vv).map(([name, v]) => {
        const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd')
        dt.textContent = name
        dd.textContent = show(v)
        row.append(dt, dd)
        return row
      }))
    })
  }, [json, n, boxW])

  // Draw the frame: the engine only ever shows step k; its own chrome stays hidden.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el?.shadowRoot || !frame) return
    // The engine's own connectedCallback sets `this.tabIndex = 0` (it's keyboard-playable standalone);
    // this wrapper already owns keyboard control (onKeyDown/onKeyUp on the <section>), so that would add
    // a second, redundant Tab stop for the same player. Undo it once the element has upgraded.
    if (el.tabIndex !== -1) el.tabIndex = -1
    if (!el.shadowRoot.querySelector('style[data-dojo]')) {
      const s = document.createElement('style')
      s.dataset.dojo = ''
      s.textContent = ENGINE_STYLE
      el.shadowRoot.appendChild(s)
    }
    const at = view?.at[k] ?? k
    if (typeof el.go === 'function' && el.k !== at) el.go(at)
  })

  // Seen (§4.3, D-7): reaching the last step by any means but Last step, in any mode.
  const seenFor = useRef<AlgoJson | null>(null)
  useEffect(() => {
    if (!json || n === 0 || k !== n || jumped || seenFor.current === json) return
    seenFor.current = json
    if (record && walkKey && !explicit) void safeWrite(() => recordSeen(d, walkKey, now()), m => toast(m, 'danger'))
  }, [json, n, k, jumped, record, walkKey, explicit, d, toast])

  // A finished predict run (every question answered) is recorded once (§4.4, D-17).
  const score = predictScore(state, questions)
  const Q = questions.size
  const done = state.predict && Q > 0 && score.answered === Q && state.k === n
  const doneFor = useRef(false)
  useEffect(() => {
    if (!state.predict || state.k === 0) doneFor.current = false
  }, [state.predict, state.k])
  useEffect(() => {
    if (!done || doneFor.current) return
    doneFor.current = true
    if (record && walkKey && !explicit) void safeWrite(() => recordPredict(d, walkKey, Q, score.correct, now()), m => toast(m, 'danger'))
  }, [done, Q, score.correct, record, walkKey, explicit, d, toast])

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (follow || isTypingTarget(e.target)) return
    const onPlayButton = (e.target as HTMLElement).dataset?.lab === 'play'
    const act: PlayerAction | null = e.key === 'ArrowRight' ? { type: 'forward' } : e.key === 'ArrowLeft' ? { type: 'back' } : e.key === ' ' && !onPlayButton ? { type: 'toggle' } : null
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    dispatch(act)
  }
  function onKeyUp(e: KeyboardEvent<HTMLElement>) {
    // Space was handled on keydown; stop it activating whichever other button has focus.
    if (!follow && e.key === ' ' && !isTypingTarget(e.target) && (e.target as HTMLElement).dataset?.lab !== 'play') e.preventDefault()
  }

  async function snapshot() {
    const el = elRef.current
    if (!el || !json) return
    try {
      const blob = await framePng(el, { title: json.title ?? '', caption: caption(json, k), counter: `STEP ${k} / ${n}` })
      downloadBlob(blob, snapshotFileName(walkKey ?? 'picture', k, n))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Snapshot failed', 'danger')
    }
  }

  if (engines.state === 'error') {
    return (
      <div className="lab-player lab-error" role="alert">
        <span>The algorithm engine did not load.</span>
        <Button onClick={engines.retry}>Retry</Button>
      </div>
    )
  }
  if (!resolved) return <p className="loading">Loading the player…</p>
  if (!resolved.ok || !json || !frame) return <div className="lab-player lab-error" role="alert">{resolved.ok ? 'Nothing to play' : resolved.error}</div>

  const title = json.title ?? def?.title ?? 'Algorithm'
  const step = k > 0 ? json.steps[k - 1] : null
  const vars = liveVars(json, k)
  const hasVars = !!(json as { vars?: unknown }).vars || json.steps.some(s => s.vars && Object.keys(s.vars).length > 0)
  const code = json.code ?? []
  const open = state.open !== null ? questions.get(state.open) ?? null : null
  const shown = open ?? (state.last ? questions.get(state.last.step) ?? null : null)
  const label = playLabel({ playing: state.playing, k, n })
  const result = done ? predictResult(score.correct, Q) : null

  return (
    <section
      ref={playerRef}
      className="lab-player"
      aria-label={`Player: ${title}`}
      data-testid="lab-player"
      data-walkthrough={walkKey ?? 'picture'}
      data-step={k}
      data-steps={n}
      tabIndex={-1}
      onKeyDownCapture={onKeyDown}
      onKeyUpCapture={onKeyUp}
    >
      <div className="lab-head">
        <span className="lab-title">{title}</span>
        <span className="lab-badge" data-testid="lab-complexity">{json.complexity ?? ''}</span>
      </div>
      <div className="lab-body">
        <div className="lab-visual">
          <SrAlgo ref={elRef} engine={engineFor(json)} json={frame} label={`${title} frame`} />
        </div>
        {(code.length > 0 || hasVars) && (
          <div className="lab-side">
            {code.length > 0 && (
              <ol className="lab-code sc" data-testid="lab-code" aria-label="Code">
                {code.map((line, i) => (
                  <li key={i} aria-current={step?.line === i ? 'step' : undefined}>{line}</li>
                ))}
              </ol>
            )}
            {hasVars && (
              <dl className="lab-vars" ref={varsRef}>
                {Object.entries(vars).map(([name, v]) => (
                  <div key={name}><dt>{name}</dt><dd>{show(v)}</dd></div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
      <p className="lab-caption" data-testid="lab-caption" ref={captionRef}>{caption(json, k)}</p>
      <div className="lab-bar">
        {!follow && (
          <>
            <Button className="lab-btn-icon" aria-label="First step" onClick={() => dispatch({ type: 'first' })}>|◀</Button>
            <Button className="lab-btn-icon" aria-label="Step back" disabled={k === 0} onClick={() => dispatch({ type: 'back' })}>◀</Button>
            <Button variant="accent" data-lab="play" disabled={state.open !== null} onClick={() => dispatch({ type: 'toggle' })}>
              {/* UAT J6: the button is as wide as its widest label, so Play → Replay never moves the controls */}
              <span className="lab-play-stack"><span>{label}</span><span className="lab-play-sizer" aria-hidden="true">Replay</span><span className="lab-play-sizer" aria-hidden="true">Pause</span></span>
            </Button>
            <Button className="lab-btn-icon" aria-label="Step forward" disabled={k >= n || state.open !== null} onClick={() => dispatch({ type: 'forward' })}>▶</Button>
            <Button className="lab-btn-icon" aria-label="Last step" disabled={state.predict || k >= n} onClick={() => dispatch({ type: 'last' })}>▶|</Button>
          </>
        )}
        <span className="lab-counter" data-testid="lab-step-counter">{`STEP ${k} / ${n}`}</span>
        {!follow && <Scrubber k={k} n={n} enabled={!state.predict && state.open === null} onSeek={at => dispatch({ type: 'seek', k: at })} />}
        {!follow && (
          <select className="lab-speed" aria-label="Speed" value={String(speed)} onChange={e => setSpeed(Number(e.target.value))}>
            {SPEEDS.map(s => <option key={s} value={String(s)}>{`${s}×`}</option>)}
          </select>
        )}
        {follow && <Button variant="quiet" onClick={() => void snapshot()}>Snapshot</Button>}
      </div>
      {!follow && (
        <div className="lab-bar lab-bar-secondary">
          <Button aria-pressed={state.predict} onClick={() => dispatch({ type: 'predict', on: !state.predict })}>Predict</Button>
          {walkKey && !explicit && (
            <>
              <Button
                aria-expanded={runnable ? showForm : undefined}
                aria-describedby={runnable ? undefined : fixedId}
                disabled={!runnable}
                onClick={() => setShowForm(v => !v)}
              >
                Own input
              </Button>
              {!runnable && <span id={fixedId} hidden>{FIXED_NOTE}</span>}
            </>
          )}
          <Button variant="quiet" onClick={() => void snapshot()}>Snapshot</Button>
          {props.onClose && <Button variant="quiet" className="lab-close" onClick={props.onClose}>Close player</Button>}
        </div>
      )}
      {showForm && walkKey && runnable && (
        <OwnInputForm
          walkKey={walkKey}
          title={def?.title ?? title}
          initial={ownRaw ?? { ...INPUT_DEFAULTS[walkKey] }}
          onTrace={raw => {
            saveOwnRaw(walkKey, raw)
            setOwnRaw({ ...raw })
          }}
          onReset={() => {
            clearOwnRaw(walkKey)
            setOwnRaw(null)
          }}
        />
      )}
      {state.predict && !follow && (
        <section className="lab-predict" aria-label="Predict" data-testid="lab-predict">
          {Q === 0 ? (
            <p>No predictions in this walkthrough</p>
          ) : (
            <>
              {shown && (
                <>
                  <h4 className="lab-predict-title">What happens next?</h4>
                  <p className="lab-predict-detail">{shown.detail}</p>
                  <div className="lab-predict-choices">
                    {shown.choices.map(c => (
                      <Button
                        key={c}
                        aria-pressed={state.last?.step === shown.step ? state.last.chose === c : undefined}
                        disabled={!open}
                        data-answer={import.meta.env.DEV && c === shown.correct ? 'correct' : undefined}
                        onClick={() => dispatch({ type: 'answer', choice: c })}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {state.last && (
                <p role="status" className="lab-predict-feedback" data-testid="lab-predict-feedback">
                  {questions.get(state.last.step)?.correct === state.last.chose ? 'Right.' : `Wrong — ${questions.get(state.last.step)?.correct}.`}
                </p>
              )}
              <p className="lab-predict-score" data-testid="lab-predict-score">{`${score.correct} / ${score.answered} of ${Q}`}</p>
              {result && (
                <p className="lab-predict-result" data-testid="lab-predict-result" data-passed={result.passed ? 'true' : 'false'}>
                  <span>{`${score.correct} / ${Q} · ${result.percent}%`}</span> <span>{result.passed ? 'Predicted' : 'Need 80% — try again'}</span>
                </p>
              )}
            </>
          )}
        </section>
      )}
    </section>
  )
}
