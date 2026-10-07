// The player's step machine (labs contract §4.2–4.4, D-7, D-19): stepping, play, and predict pauses.
// Pure, so every control and key maps to one action and the rules are testable without a browser.
import type { PredictQuestion } from './predict'

/** Auto-advance interval at 1× (§4.2); divided by the speed. */
export const STEP_MS = 600
/** …and under prefers-reduced-motion: reduce (§4.2, §9). */
export const STEP_MS_REDUCED = 900
export const SPEEDS = [0.5, 1, 2, 4] as const

export interface PlayerState {
  k: number
  n: number
  playing: boolean
  predict: boolean
  /** step → the choice he picked (a step answered once is never asked again in the run) */
  answered: Record<number, string>
  /** the step whose question is open, or null */
  open: number | null
  /** the question just answered, shown with his choice pressed until the next move */
  last: { step: number; chose: string } | null
  /** true when k was reached by Last step (does not count as seen, D-7) */
  jumped: boolean
}

export type PlayerAction =
  | { type: 'first' } | { type: 'back' } | { type: 'forward' } | { type: 'last' } | { type: 'seek'; k: number }
  | { type: 'play' } | { type: 'pause' } | { type: 'toggle' }
  | { type: 'answer'; choice: string } | { type: 'predict'; on: boolean } | { type: 'load'; n: number }

export function initialPlayer(n: number, predict = false): PlayerState {
  return { k: 0, n, playing: false, predict, answered: {}, open: null, last: null, jumped: false }
}

type Qs = ReadonlyMap<number, PredictQuestion>
const pausesAt = (s: PlayerState, qs: Qs, k: number) => s.predict && k < s.n && qs.has(k) && !(k in s.answered)

function forward(s: PlayerState, qs: Qs): PlayerState {
  if (s.open !== null) return s
  if (s.k >= s.n) return { ...s, playing: false }
  if (pausesAt(s, qs, s.k)) return { ...s, open: s.k, playing: false, last: null }
  const k = s.k + 1
  const open = pausesAt(s, qs, k) ? k : null
  return { ...s, k, open, playing: s.playing && k < s.n && open === null, last: null, jumped: false }
}

export function playerReducer(s: PlayerState, a: PlayerAction, qs: Qs): PlayerState {
  switch (a.type) {
    case 'load':
      return initialPlayer(a.n, s.predict)
    case 'first':
      return { ...s, k: 0, open: null, last: null, jumped: false }
    case 'back':
      return { ...s, k: Math.max(0, s.k - 1), open: null, last: null, jumped: false }
    case 'forward':
      return forward(s, qs)
    case 'last':
      return s.predict ? s : { ...s, k: s.n, playing: false, open: null, last: null, jumped: true }
    case 'seek': {
      // The block scrubber (prototype `.scrub`). A predict run asks its questions in order, so it can't be skipped through.
      if (s.predict) return s
      const k = Math.max(0, Math.min(s.n, Math.round(a.k)))
      if (k === s.k && s.open === null) return s
      // a jump of more than one step to the end is the same as Last step: it doesn't count as seen (D-7)
      return { ...s, k, open: null, last: null, playing: s.playing && k < s.n, jumped: k === s.n && k - s.k > 1 }
    }
    case 'play': {
      if (s.open !== null) return s
      const from = s.k >= s.n ? { ...s, k: 0, jumped: false, last: null } : { ...s, last: null }
      if (pausesAt(from, qs, from.k)) return { ...from, open: from.k, playing: false }
      return { ...from, playing: from.n > 0 }
    }
    case 'pause':
      return { ...s, playing: false }
    case 'toggle':
      return playerReducer(s, { type: s.playing ? 'pause' : 'play' }, qs)
    case 'answer': {
      if (s.open === null) return s
      return { ...s, answered: { ...s.answered, [s.open]: a.choice }, k: s.open + 1, open: null, last: { step: s.open, chose: a.choice }, playing: false, jumped: false }
    }
    case 'predict':
      return a.on
        ? { ...initialPlayer(s.n, true) }
        : { ...s, predict: false, open: null, last: null }
  }
}

/** The step a click or drag at `frac` (0..1) of the scrubber lands on: block i of `bins` is step round((i + 1) / bins * n). */
export function scrubStep(frac: number, n: number): number {
  const bins = Math.min(n, 60)
  if (bins <= 0 || frac < 0) return 0 // dragged past the left end: back to the start
  const i = Math.min(bins - 1, Math.max(0, Math.floor(frac * bins)))
  return Math.round(((i + 1) / bins) * n)
}

/** The play button's name (§4.2): Pause while playing, Replay when paused at the end, else Play. */
export function playLabel(s: Pick<PlayerState, 'playing' | 'k' | 'n'>): 'Play' | 'Pause' | 'Replay' {
  return s.playing ? 'Pause' : s.n > 0 && s.k >= s.n ? 'Replay' : 'Play'
}

/** Running score (§4.4): c right of a answered. */
export function predictScore(s: PlayerState, qs: Qs): { correct: number; answered: number } {
  const steps = Object.keys(s.answered).map(Number)
  return { answered: steps.length, correct: steps.filter(st => qs.get(st)?.correct === s.answered[st]).length }
}

/** Auto-advance interval in ms (§4.2). */
export function stepInterval(speed: number, reducedMotion: boolean): number {
  return (reducedMotion ? STEP_MS_REDUCED : STEP_MS) / speed
}
