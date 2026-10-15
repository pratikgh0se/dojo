import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { PATTERNS, WALKTHROUGHS, patternsOfWalk, walkDef } from '../../src/content/atlas'
import { NEW_PIECES } from '../../src/content/atlasPieces'
import { SRALGO_OPS, SRALGO_TYPES, engineFor, type AlgoJson } from '../../src/rules/algoJson'
import { playerView } from '../../src/rules/narration'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { SrAlgo, type AlgoElement } from '../../src/ui/engines/SrAlgo'
import { installAlgoEngines } from '../helpers/engines'

type FullEl = AlgoElement & { k: number; go(k: number): void }
const g = () => window as unknown as AlgoGlobals
const KEYS = ['prefixSum', 'bitmaskTsp', 'trie', 'segTree', 'kmp', 'bridges', 'matching', 'pascal', 'life']
const ROWS: Record<string, string> = {
  'prefix-sum': 'prefixSum', 'dp-bitmask': 'bitmaskTsp', trie: 'trie', 'segment-fenwick': 'segTree', 'string-match': 'kmp',
  'scc-bridges': 'bridges', 'flow-matching': 'matching', combinatorics: 'pascal', simulation: 'life',
}

/** Applies the value-changing ops the way the engine does, so the final picture can be checked against the algorithm. */
function replay(json: AlgoJson) {
  const s: Record<string, { values?: unknown[]; rows?: unknown[][] }> = JSON.parse(JSON.stringify(json.structures))
  for (const st of json.steps) {
    const t = s[String(st.s ?? st.g)]
    if (!t) continue
    if (st.op === 'set') t.values![st.i as number] = st.v
    if (st.op === 'cell') t.rows![st.r as number][st.c as number] = st.v
    if (st.op === 'push') t.values!.push(st.v)
    if (st.op === 'pop') t.values!.pop()
    if (st.op === 'shift') t.values!.shift()
  }
  return s
}

describe('the nine W7 walkthroughs (ATLAS-05)', () => {
  beforeAll(installAlgoEngines)

  it('are registered as 54 walkthroughs, nine of them new fixed examples', () => {
    expect(WALKTHROUGHS).toHaveLength(54)
    expect(Object.keys(NEW_PIECES).sort()).toEqual([...KEYS].sort())
    for (const k of KEYS) expect(walkDef(k), k).toMatchObject({ source: 'piece' })
    for (const k of KEYS) expect(walkDef(k)!.input, k).toBeUndefined()
  })

  it('give every one of the 36 rows at least one walkthrough, and the nine rows their own', () => {
    expect(PATTERNS.filter(p => p.walkthroughs.length === 0).map(p => p.slug)).toEqual([])
    for (const [slug, key] of Object.entries(ROWS)) {
      expect(PATTERNS.find(p => p.slug === slug)!.walkthroughs, slug).toEqual([key])
      expect(patternsOfWalk(key), key).toEqual([slug])
    }
  })

  it.each(KEYS)('%s resolves without the Atlas page string and shows exactly the title and complexity the list promises', key => {
    const r = resolveWalk(key, undefined, {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([r.json.title, r.json.complexity]).toEqual([walkDef(key)!.title, walkDef(key)!.complexity])
    expect(JSON.parse(JSON.stringify(r.json))).toEqual(r.json)
  })

  it.each(KEYS)('%s is a well-formed <sr-algo> picture of the same size as the existing pieces', key => {
    const json = NEW_PIECES[key]()
    expect(engineFor(json)).toBe('algo')
    expect(json.steps.length).toBeGreaterThanOrEqual(12)
    expect(json.steps.length).toBeLessThanOrEqual(80)
    expect(playerView(json).json.steps.length).toBeGreaterThanOrEqual(10)
    expect(json.code!.length).toBeGreaterThan(0)
    expect(json.code!.length).toBeLessThanOrEqual(10)
    for (const line of json.code!) expect(line.length, `${key}: ${line}`).toBeLessThanOrEqual(34)
    for (const t of Object.values(json.structures)) expect(String(t.caption ?? '').length, `${key} caption`).toBeLessThanOrEqual(38)
    expect(Object.keys(json.structures).length).toBeLessThanOrEqual(3)
    const allowed = new Set<string>([...SRALGO_OPS, 'cellHl'])
    for (const t of Object.values(json.structures)) expect(SRALGO_TYPES as readonly string[]).toContain(t.type)
    for (const [i, st] of json.steps.entries()) {
      expect(allowed.has(st.op), `${key} step ${i} op ${st.op}`).toBe(true)
      const ref = st.s ?? st.g
      if (ref !== undefined) expect(json.structures[String(ref)], `${key} step ${i} structure`).toBeDefined()
      if (st.line !== undefined) expect(st.line as number, `${key} step ${i} line`).toBeLessThan(json.code!.length)
      if (st.say !== undefined) expect(String(st.say).length, `${key} step ${i} say`).toBeGreaterThan(0)
    }
    // narrated: most steps explain themselves
    expect(json.steps.filter(s => typeof s.say === 'string').length).toBeGreaterThanOrEqual(8)
  })

  it.each(KEYS)('%s plays through the real engine to the last step without error', key => {
    const json = NEW_PIECES[key]()
    const { container } = render(<SrAlgo engine="algo" json={json} label={key} />)
    const el = container.querySelector('sr-algo') as FullEl
    for (let k = 0; k <= json.steps.length; k++) el.go(k)
    expect(el.k).toBe(json.steps.length)
  })

  it('compute their answers, not just draw them', () => {
    const pre = replay(NEW_PIECES.prefixSum()).pre.values
    expect(pre).toEqual([0, 3, 4, 8, 9, 14, 23, 25, 31])
    expect(JSON.stringify(NEW_PIECES.prefixSum().steps)).toContain('pre[6] − pre[2] = 23 − 4 = 19')

    const tsp = NEW_PIECES.bitmaskTsp()
    const dp = replay(tsp).dp.rows!
    expect(dp[7][0]).toBe('inf')
    expect(Math.min(...(dp[7].slice(1) as number[]))).toBe(14)
    const masks = [1, 3, 5, 7, 9, 11, 13, 15]
    masks.forEach((m, r) => dp[r].forEach((v, k) => expect(v === 'inf', `mask ${m} city ${k}`).toBe(!((m >> k) & 1) || (m === 1 ? k !== 0 : k === 0))))
    expect(JSON.stringify(tsp.steps.at(-1))).toContain('ends at city 2')

    const seg = JSON.stringify(NEW_PIECES.segTree().steps)
    expect(seg).toContain('20 = 7 + 2 + 6 + 4 + 1')

    const kmp = NEW_PIECES.kmp()
    expect(replay(kmp).lps.values).toEqual([0, 1, 0, 1, 2])
    expect(JSON.stringify(kmp.steps.at(-1))).toContain('Occurrences at 0 and 3')

    expect(JSON.stringify(NEW_PIECES.bridges().steps.at(-1))).toContain('Bridges: C–D and A–G')

    expect(replay(NEW_PIECES.matching()).match.values).toEqual(['L2', 'L1', 'L3'])

    const pascal = replay(NEW_PIECES.pascal()).t.rows!
    pascal.forEach((row, n) => expect((row.filter(v => v !== null) as number[]).reduce((a, b) => a + b, 0)).toBe(2 ** n))
    expect(pascal[5][2]).toBe(10)

    const life = replay(NEW_PIECES.life()).g.rows!
    expect(life.map(r => r.map(v => (v === 1 ? 1 : 0)))).toEqual([[0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0]])
    expect(replay(NEW_PIECES.life()).q.values).toEqual([])
  })
})
