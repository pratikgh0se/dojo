import { describe, expect, it } from 'vitest'
import { canHint, COACH_TURNS, coachTurn, HINT_MAX, hintsUsed, messageTopics, PHASE_LABEL, turnTopic } from '../../src/ai/coachPlan'
import { interviewStage } from '../../src/rules/designSession'

type M = { from: 'interviewer' | 'you'; text: string; hint?: true }
const ai = (text = 'q?', hint?: true): M => ({ from: 'interviewer', text, ...(hint ? { hint } : {}) })
const you = (text = 'a'): M => ({ from: 'you', text })
const conversation = (answers: number): M[] => {
  const out: M[] = [ai()]
  for (let i = 0; i < answers; i++) out.push(you(), ai())
  return out
}

describe('coachTurn', () => {
  const ORDER = ['requirements', 'estimates', 'design', 'tradeoffs']
  it('opens with requirements and asks a question on every turn', () => {
    expect(coachTurn(0)).toMatchObject({ phase: 'requirements', kind: 'open' })
    for (let t = 0; t < 40; t++) expect(coachTurn(t).focus.length).toBeGreaterThan(10)
  })
  it('never goes back a phase over 40 turns (challenges excluded) and visits all four within 12 answers', () => {
    const topics = Array.from({ length: 40 }, (_, t) => turnTopic(coachTurn(t))).filter(x => x !== 'challenge')
    const idx = topics.map(t => ORDER.indexOf(t))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    const first13 = new Set(Array.from({ length: 13 }, (_, t) => turnTopic(coachTurn(t))))
    for (const p of ORDER) expect(first13.has(p as never)).toBe(true)
  })
  it('puts a challenge at turns 5, 8, 12 and then every fourth', () => {
    const ch = Array.from({ length: 30 }, (_, t) => t).filter(t => coachTurn(t).kind === 'challenge')
    expect(ch).toEqual([5, 8, 12, 16, 20, 24, 28])
  })
  it('steers four deep dives, each once, in order', () => {
    expect(COACH_TURNS.filter(t => t.dive).map(t => t.dive)).toEqual([1, 2, 3, 4])
  })
  it('labels the phases', () => {
    expect(PHASE_LABEL).toEqual({ requirements: 'Requirements', estimates: 'Estimates', design: 'Design', tradeoffs: 'Trade-offs' })
  })
  it('keeps every learner-visible string free of the banned word', () => {
    const strings = [...Array.from({ length: 40 }, (_, t) => coachTurn(t).focus), ...Object.values(PHASE_LABEL)]
    for (const s of strings) expect(s).not.toMatch(/interview/i)
  })
})

describe('messageTopics', () => {
  it('gives each AI message the topic of its turn and a hint the topic of the AI message before it', () => {
    const msgs: M[] = [ai(), you(), ai(), you(), ai(), you(), ai(), you(), ai(), you(), ai(), ai('sharper?', true)]
    const topics = messageTopics(msgs)
    expect(topics[0]).toBe('requirements')
    expect(topics[1]).toBeNull()
    expect(topics[10]).toBe('challenge') // 5 answers given: turn 5
    expect(topics[11]).toBe('challenge') // the hint repeats it
  })
})

describe('hints', () => {
  it('counts hint replies and allows a hint only after an AI message, below the limit, while open', () => {
    expect(hintsUsed([ai(), ai('h?', true)])).toBe(1)
    expect(canHint([], false)).toBe(false)
    expect(canHint([ai()], false)).toBe(true)
    expect(canHint([ai(), you()], false)).toBe(false)
    expect(canHint([ai()], true)).toBe(false)
    const used = Array.from({ length: HINT_MAX }, () => ai('h?', true))
    expect(canHint([ai(), ...used], false)).toBe(false)
  })
  it('does not use a hint up until its reply is stored', () => {
    expect(hintsUsed([ai()])).toBe(0)
    const twoUsed = [ai(), ai('h?', true), ai('h?', true)]
    expect(canHint(twoUsed, false)).toBe(true)
  })
})

describe('interviewStage', () => {
  it('reports the phase of the open turn, never completes, and tracks the active deep dive', () => {
    expect(interviewStage(conversation(0))).toMatchObject({ answers: 0, phase: 'requirements', topic: 'requirements', activeDive: 0, status: 'Requirements' })
    expect(interviewStage(conversation(3)).status).toBe('Estimates')
    expect(interviewStage(conversation(5))).toMatchObject({ topic: 'challenge', status: 'Estimates · discussion' })
    expect(interviewStage(conversation(6)).activeDive).toBe(1)
    expect(interviewStage(conversation(9)).activeDive).toBe(3)
    expect(interviewStage(conversation(30))).toMatchObject({ phase: 'tradeoffs', activeDive: 4 })
    expect(interviewStage(conversation(30))).not.toHaveProperty('complete')
  })
})
