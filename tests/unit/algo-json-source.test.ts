import { describe, expect, it } from 'vitest'
import { PICTURE_LIMITS as AI_LIMITS, SRALGO2_OPS, SRALGO2_TYPES, SRALGO_OPS, SRALGO_TYPES } from '../../src/ai/validate'
import { PICTURE_LIMITS, SRALGO2_OPS as ALGO2_OPS, SRALGO2_TYPES as ALGO2_TYPES, SRALGO_OPS as ALGO_OPS, SRALGO_TYPES as ALGO_TYPES } from '../../src/rules/algoJson'

// The labs fix wave (baseline commit d325851, "dedupe algoJson.ts's contract constants against
// ai/validate") already resolved this leftover by having rules/algoJson.ts re-export ai/validate.ts's
// constants directly, rather than keeping a second, differently-named copy. This test pins that there
// is still exactly one source of truth: importing "from algoJson" or "from ai/validate" must be the
// same object, so the two can never drift again.
describe('one picture contract (labs algoJson re-exports ai/validate, not a second copy)', () => {
  it('re-exports the same op lists, type lists and limits object', () => {
    expect(ALGO_OPS).toBe(SRALGO_OPS)
    expect(ALGO2_OPS).toBe(SRALGO2_OPS)
    expect(ALGO_TYPES).toBe(SRALGO_TYPES)
    expect(ALGO2_TYPES).toBe(SRALGO2_TYPES)
    expect(PICTURE_LIMITS).toBe(AI_LIMITS)
  })
})
