import { describe, expect, it } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import { DESIGN_MODES, modeLabel, needsModeRewrite, readDesignMode, rewriteLegacyMode } from '../../src/rules/designMode'

describe('readDesignMode', () => {
  it('reads the three modes as stored', () => {
    expect(DESIGN_MODES).toEqual(['solo', 'ai-partner', 'human-partner'])
    for (const m of DESIGN_MODES) expect(readDesignMode(m)).toBe(m)
  })
  it('reads the legacy interviewer as ai-partner (Review Focus 1)', () => {
    expect(readDesignMode('interviewer')).toBe('ai-partner')
    expect(readDesignMode(legacy.mode)).toBe('ai-partner')
  })
  it('reads anything unknown or missing as solo', () => {
    for (const v of [undefined, null, '', 'both', 3]) expect(readDesignMode(v)).toBe('solo')
  })
})

describe('rewriteLegacyMode (S2 migration step 4 calls this)', () => {
  it('changes only the mode and returns a new object', () => {
    const out = rewriteLegacyMode(legacy)
    expect(out).toEqual({ ...legacy, mode: 'ai-partner' })
    expect(out).not.toBe(legacy)
    expect(legacy.mode).toBe('interviewer')
  })
  it('is idempotent: a rewritten row and every other mode return null', () => {
    const once = rewriteLegacyMode(legacy)!
    expect(rewriteLegacyMode(once)).toBeNull()
    for (const m of DESIGN_MODES) expect(rewriteLegacyMode({ mode: m })).toBeNull()
    expect(needsModeRewrite('interviewer')).toBe(true)
    expect(needsModeRewrite('ai-partner')).toBe(false)
  })
})

describe('modeLabel', () => {
  it('names the modes for the learner and never says interview', () => {
    expect(modeLabel('solo')).toBe('Solo')
    expect(modeLabel('ai-partner')).toBe('Solo · AI partner')
    expect(modeLabel('human-partner')).toBe('With someone')
    expect(modeLabel('interviewer')).toBe('Solo · AI partner')
  })
})
