// The study session (ux spec section 3): a pure state machine driven by the wall clock. Nothing here
// touches storage, XP or the DOM; the Do screen persists the state and records `focus` events.

export type Phase = 'focus' | 'break' | 'long'
export const PHASE_LABEL: Record<Phase, 'Focus' | 'Break' | 'Long break'> = { focus: 'Focus', break: 'Break', long: 'Long break' }

/** A long break follows every 4th focus block. */
export const LONG_EVERY = 4
/** The long break is this many short breaks (25/5 -> 15). */
export const LONG_FACTOR = 3
/** More than this past a phase's end (sleep, a closed lid) and the session is parked as "away". */
export const AWAY_MS = 2 * 60_000
export const STUCK_BREAK_MIN = 5
const MIN = 60_000

export interface Study {
  id: string
  ticketId: string
  goal: string
  cardIds: string[]
  focusMin: number
  breakMin: number
  longBreakMin: number
  startedAt: number
  phase: Phase
  phaseStart: number
  phaseMin: number
  /** finished focus blocks */
  blocks: number
  /** a progress action (rung opened, note typed, tick) happened in the current focus block */
  progress: boolean
  /** the "Stuck?" prompt is pending for the block that just ended */
  stuck: boolean
  chime: boolean
  /** set when the clock jumped past a phase end by more than AWAY_MS: the session waits for Resume or End */
  away?: number | null
  /** UAT J3 (D3.5): set while paused: the ms left in the phase. Nothing advances until Resume. */
  paused?: number | null
}

export interface FinishedBlock { index: number; start: number; end: number; minutes: number }
export interface Advanced { study: Study; finished: FinishedBlock[]; switched: boolean; away: boolean }

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function isStudy(v: unknown): v is Study {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return typeof s.id === 'string' && typeof s.ticketId === 'string' && typeof s.goal === 'string' && Array.isArray(s.cardIds) &&
    num(s.focusMin) && num(s.breakMin) && num(s.longBreakMin) && num(s.startedAt) && num(s.phaseStart) && num(s.phaseMin) && num(s.blocks) &&
    (s.phase === 'focus' || s.phase === 'break' || s.phase === 'long') &&
    typeof s.progress === 'boolean' && typeof s.stuck === 'boolean' && typeof s.chime === 'boolean'
}

export function startStudy(i: {
  id: string; ticketId: string; goal: string; cardIds: string[]; focusMin: number; breakMin: number; chime: boolean; now: number
}): Study {
  return {
    id: i.id, ticketId: i.ticketId, goal: i.goal, cardIds: i.cardIds,
    focusMin: i.focusMin, breakMin: i.breakMin, longBreakMin: i.breakMin * LONG_FACTOR,
    startedAt: i.now, phase: 'focus', phaseStart: i.now, phaseMin: i.focusMin,
    blocks: 0, progress: false, stuck: false, chime: i.chime,
  }
}

export const phaseEnd = (s: Study): number => s.phaseStart + s.phaseMin * MIN
export const phaseLabel = (s: Study) => PHASE_LABEL[s.phase]
// UAT J3: a lagging screen clock never reads more than the phase's own length (25:00, not 25:01)
export const remainingMs = (s: Study, now: number): number => (s.paused != null ? s.paused : Math.min(s.phaseMin * MIN, Math.max(0, phaseEnd(s) - now)))
export const isStudyPaused = (s: Study): boolean => s.paused != null

/** Pause: the phase stops where it is (the ms left are kept). */
export function pauseStudy(s: Study, now: number): Study {
  if (s.paused != null || s.away) return s
  return { ...s, paused: Math.max(0, phaseEnd(s) - now) }
}

/** Resume from a pause: the phase runs on from now with what was left (its start moves by the pause). */
export function resumePausedStudy(s: Study, now: number): Study {
  if (s.paused == null) return s
  return { ...s, paused: null, phaseStart: now - (s.phaseMin * MIN - s.paused) }
}

/** Move the session forward to `now`, one phase boundary at a time. A gap past AWAY_MS parks it as away. */
export function advance(s: Study, now: number): Advanced {
  if (s.away || s.paused != null) return { study: s, finished: [], switched: false, away: false }
  if (now > phaseEnd(s) + AWAY_MS) {
    // sleep or wake: credit at most the block that was running, then wait for the user
    if (s.phase !== 'focus') return { study: { ...s, away: now }, finished: [], switched: true, away: true }
    const end = phaseEnd(s)
    const blocks = s.blocks + 1
    const long = blocks % LONG_EVERY === 0
    const parked: Study = {
      ...s, blocks, phase: long ? 'long' : 'break', phaseStart: end, phaseMin: long ? s.longBreakMin : s.breakMin,
      stuck: false, progress: false, away: now,
    }
    return { study: parked, finished: [{ index: blocks, start: s.phaseStart, end, minutes: s.phaseMin }], switched: true, away: true }
  }
  let cur = s
  const finished: FinishedBlock[] = []
  let switched = false
  while (now >= phaseEnd(cur)) {
    const end = phaseEnd(cur)
    switched = true
    if (cur.phase === 'focus') {
      const blocks = cur.blocks + 1
      finished.push({ index: blocks, start: cur.phaseStart, end, minutes: cur.phaseMin })
      const long = blocks % LONG_EVERY === 0
      cur = {
        ...cur, blocks, phase: long ? 'long' : 'break', phaseStart: end, phaseMin: long ? cur.longBreakMin : cur.breakMin,
        stuck: !cur.progress, progress: false,
      }
    } else {
      cur = { ...cur, phase: 'focus', phaseStart: end, phaseMin: cur.focusMin, progress: false, stuck: false }
    }
  }
  return { study: cur, finished, switched, away: false }
}

/** "Resume" after a gap: the current phase restarts from `now` (contract UX addendum 4, Q12). */
export function resumeStudy(s: Study, now: number): Study {
  return { ...s, away: null, phaseStart: now, progress: false, stuck: false }
}

/** A rung opened, a note typed or a tick, during a focus block. */
export function markProgress(s: Study): Study {
  return s.phase === 'focus' && !s.progress ? { ...s, progress: true } : s
}

export function dismissStuck(s: Study): Study {
  return s.stuck ? { ...s, stuck: false } : s
}

/** "Take a 5-minute break": the running break becomes exactly `min` minutes from `now`. */
export function takeBreak(s: Study, now: number, min: number = STUCK_BREAK_MIN): Study {
  return { ...s, phase: 'break', phaseStart: now, phaseMin: min, stuck: false, progress: false }
}

export function setChime(s: Study, chime: boolean): Study {
  return s.chime === chime ? s : { ...s, chime }
}
