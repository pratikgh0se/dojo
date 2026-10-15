// The thinking coach's flow (amendment A1). Pure: no React, no Dexie. prompts.ts, the fake and the UI all read this one table.
export type CoachPhase = 'requirements' | 'estimates' | 'design' | 'tradeoffs'
export type CoachKind = 'open' | 'ask' | 'challenge'
export type CoachTopic = CoachPhase | 'challenge'
export interface CoachTurn { phase: CoachPhase; kind: CoachKind; dive?: 1 | 2 | 3 | 4; focus: string }

export const PHASE_LABEL: Record<CoachPhase, string> = { requirements: 'Requirements', estimates: 'Estimates', design: 'Design', tradeoffs: 'Trade-offs' }
export const HINT_MAX = 3

const NUMBERS_CHALLENGE = 'one number or sizing the learner gave: what changes if it is ten times larger, or simply wrong'
const DESIGN_CHALLENGE = 'one component or choice in the design so far: what happens to it when traffic doubles or it fails'
const TRADE_CHALLENGE = 'the learner\'s main trade-off: what would have to be true for the other side to win'
const TRADE_ASK = 'what the learner gives up with their main choice, and how they would notice it going wrong'
// The four deep-dive turns have no fixed focus: the model picks the next thing the design leaves open.
const DIVE_FOCUS = 'the part of the design the learner has said least about so far, taken one step deeper'

export const COACH_TURNS: readonly CoachTurn[] = [
  { phase: 'requirements', kind: 'open', focus: 'who the users are and what they do most, before anything is drawn' },
  { phase: 'requirements', kind: 'ask', focus: 'what is in scope and what is not: the two or three things the system must do' },
  { phase: 'requirements', kind: 'ask', focus: 'which non-functional goal matters most (scale, latency, availability, consistency, cost) and how they would tell it was met' },
  { phase: 'estimates', kind: 'ask', focus: 'the numbers the learner will design to (users, requests per second, data size, growth) and how they got them' },
  { phase: 'estimates', kind: 'ask', focus: 'what those numbers mean for the design: how much data in a year and where it would sit' },
  { phase: 'estimates', kind: 'challenge', focus: NUMBERS_CHALLENGE },
  { phase: 'design', kind: 'ask', dive: 1, focus: DIVE_FOCUS },
  { phase: 'design', kind: 'ask', dive: 2, focus: DIVE_FOCUS },
  { phase: 'design', kind: 'challenge', focus: DESIGN_CHALLENGE },
  { phase: 'tradeoffs', kind: 'ask', dive: 3, focus: DIVE_FOCUS },
  { phase: 'tradeoffs', kind: 'ask', dive: 4, focus: DIVE_FOCUS },
  { phase: 'tradeoffs', kind: 'ask', focus: TRADE_ASK },
  { phase: 'tradeoffs', kind: 'challenge', focus: TRADE_CHALLENGE },
]

/** The coach has no last turn: past the table it keeps asking trade-off questions, with a challenge every fourth turn. */
export function coachTurn(answers: number): CoachTurn {
  const t = Math.max(0, Math.floor(answers))
  if (t < COACH_TURNS.length) return COACH_TURNS[t]
  return (t - COACH_TURNS.length) % 4 === 3
    ? { phase: 'tradeoffs', kind: 'challenge', focus: DESIGN_CHALLENGE }
    : { phase: 'tradeoffs', kind: 'ask', focus: TRADE_ASK }
}

export const turnTopic = (t: CoachTurn): CoachTopic => (t.kind === 'challenge' ? 'challenge' : t.phase)

type Msg = { from: 'interviewer' | 'you'; hint?: boolean }

/** Per message: an AI message takes the topic of the turn it opened (answers given before it); a hint takes the previous AI message's. */
export function messageTopics(messages: readonly Msg[]): (CoachTopic | null)[] {
  let answers = 0
  let last: CoachTopic | null = null
  return messages.map(m => {
    if (m.from === 'you') { answers++; return null }
    if (m.hint) return last
    last = turnTopic(coachTurn(answers))
    return last
  })
}

export const hintsUsed = (messages: readonly Msg[]): number => messages.filter(m => m.from === 'interviewer' && m.hint).length

/** A hint needs an open AI question, a hint left, and an unlocked session. A failed hint stores no message, so it costs nothing. */
export function canHint(messages: readonly Msg[], locked: boolean): boolean {
  const last = messages[messages.length - 1]
  return !locked && !!last && last.from === 'interviewer' && hintsUsed(messages) < HINT_MAX
}
