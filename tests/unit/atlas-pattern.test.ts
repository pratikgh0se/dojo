import { describe, expect, it } from 'vitest'
import { APPROACHES } from '../../src/content/approaches'
import { ATLAS_LENS } from '../../src/content/atlasTags'
import { PATTERNS, patternBySlug } from '../../src/content/atlas'
import { patternForProblem, patternSlugsOfProblem } from '../../src/rules/atlasPattern'
import { problemsByPattern } from '../../src/rules/atlasRows'
import { realPlan } from '../helpers/plan'

const plan = realPlan()
const ids = plan.dsa_bank.flatMap(w => w.problems.map(p => `p${p.num}`))

describe('patternForProblem (ATLAS-08)', () => {
  it('returns the pattern of the starred best way first, as {slug, label}', () => {
    expect(patternForProblem('p743', plan)).toEqual({ slug: 'shortest-path', label: 'Shortest path' })
    expect(patternForProblem('p207', plan)).toEqual({ slug: 'topo-sort', label: 'Topo sort' })
    // the brute way is listed first on p560 (backtracking) but the chip names the best way
    expect(patternForProblem('p560', plan)?.slug).toBe('prefix-sum')
  })

  it('returns null for an id the plan does not list, and for ids that are not DSA problems', () => {
    expect(patternForProblem('p99999', plan)).toBeNull()
    expect(patternForProblem('d-kv-store', plan)).toBeNull()
    expect(patternForProblem('', plan)).toBeNull()
  })

  it('gives every one of the plan problems a pattern whose row lists that problem (ATLAS-09)', () => {
    expect(ids.length).toBeGreaterThanOrEqual(170)
    const tagged = problemsByPattern(plan, [], APPROACHES)
    for (const id of ids) {
      const hit = patternForProblem(id, plan)
      expect(hit, id).not.toBeNull()
      expect(patternBySlug(hit!.slug)?.label, id).toBe(hit!.label)
      expect(tagged[hit!.slug].map(t => t.id), id).toContain(id)
    }
  })

  it('orders tags best way, other ways, then lens tags, without repeats', () => {
    expect(patternSlugsOfProblem('p743')).toEqual(['shortest-path', 'all-pairs-paths'])
    expect(patternSlugsOfProblem('p1039')).toEqual(['dp-tabulation', 'backtracking', 'geometry'])
    expect(new Set(patternSlugsOfProblem('p84')).size).toBe(patternSlugsOfProblem('p84').length)
    expect(patternSlugsOfProblem('p99999')).toEqual([])
  })
})

describe('lens tags (ATLAS-06)', () => {
  it('only name real plan problems and real rows', () => {
    for (const [slug, list] of Object.entries(ATLAS_LENS)) {
      expect(patternBySlug(slug), slug).toBeDefined()
      for (const id of list) expect(ids, `${slug} ${id}`).toContain(id)
    }
  })

  it('leave no row without a plan problem', () => {
    const tagged = problemsByPattern(plan, [], APPROACHES)
    expect(PATTERNS.filter(p => tagged[p.slug].length === 0).map(p => p.slug)).toEqual([])
  })

  it('cover the three rows that had none (the sieve row now has p204 of its own)', () => {
    expect(Object.keys(ATLAS_LENS).sort()).toEqual(['all-pairs-paths', 'flow-matching', 'geometry'])
  })
})
