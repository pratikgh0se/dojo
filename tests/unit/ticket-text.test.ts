import { describe, expect, it } from 'vitest'
import { shownText } from '../../src/rules/ticketText'

// UAT J3: the plan text ends with the forge brief's repo path; the learner never sees it.
describe('shownText', () => {
  it('drops "The brief is <path>.md" and keeps the rest', () => {
    expect(shownText('Stage 00 Setup + math by picture, watch 1 of 1. Monday: watch the reference below. The brief is forge/stages/00-setup/brief.md'))
      .toBe('Stage 00 Setup + math by picture, watch 1 of 1. Monday: watch the reference below.')
    expect(shownText('Rebuild it. The brief is forge/stages/01-micrograd/brief.md. Then commit.')).toBe('Rebuild it. Then commit.')
  })
  it('leaves other text alone, and an empty text empty', () => {
    expect(shownText('Two timed problems, 25 min each.')).toBe('Two timed problems, 25 min each.')
    expect(shownText(undefined)).toBe('')
  })
})
