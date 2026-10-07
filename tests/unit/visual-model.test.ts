// @vitest-environment node
// C-VISUAL §3–§4 and §7: the family step model. Real steps come from the Python toolkit in Pyodide (the same
// events Go writes), and the pinned VF-01..VF-10 states and captions are checked on the model's views.
import { describe, expect, it } from 'vitest'
import {
  arrayView, boxesAt, buildFamilyModel, captionAt, casePlan, currentAt, dsuView, gameView, graphView, heapView, intervalsExtent, intervalsView, listView, liveAt, PROBE_MAX, queueView, searchView, slotProbes, treeView,
  type ArrayInst, type DsuInst, type FamilyModel, type GameInst, type GraphInst, type HeapInst, type IntervalsInst, type Kind, type ListInst, type QueueInst, type SearchInst, type TreeInst,
} from '../../src/runner/families/model'
import { windowIndices, Timeline } from '../../src/runner/families/timeline'
import { buildStepModel, caseInput, caseLabels, narrate } from '../../src/runner/stepModel'
import { statusText } from '../../src/runner/status'
import type { Step } from '../../src/runner/types'
import { runPy } from '../helpers/pyRun'
import { PY_VF } from '../helpers/visualSolutions'

async function steps(id: keyof typeof PY_VF, n = 2) {
  const [pack, code] = PY_VF[id]
  const r = await runPy(code, pack, n)
  expect(statusText(r), JSON.stringify(r.errors)).toBe(`Passed ${n}/${n}`)
  return r.steps
}
/** Every step k (1-based) whose caption in `kind` is exactly `text`. */
const stepsWith = (m: FamilyModel, kind: Kind, text: string) => Array.from({ length: m.N }, (_, i) => i + 1).filter(k => captionAt(m, kind, k) === text)
const first = (m: FamilyModel, kind: Kind, text: string) => {
  const ks = stepsWith(m, kind, text)
  expect(ks.length, `no step "${text}"`).toBeGreaterThan(0)
  return ks[0]
}
const one = <T>(m: FamilyModel, kind: Kind, k: number) => {
  const xs = liveAt(m, kind, k)
  expect(xs).toHaveLength(1)
  return xs[0] as unknown as T
}

describe('timeline and windows', () => {
  it('Timeline answers the value at any step', () => {
    const t = new Timeline<number>()
    t.set(3, 1); t.set(3, 2); t.set(7, 5)
    expect([t.at(2), t.at(3), t.at(6), t.at(7), t.at(100)]).toEqual([undefined, 2, 2, 5, 5])
    expect(t.at(1, -1)).toBe(-1)
  })
  it('windowIndices keeps every current index inside the window', () => {
    expect(windowIndices(5, 40, [])).toEqual([0, 1, 2, 3, 4])
    const w = windowIndices(1000, 40, [500])
    expect(w).toHaveLength(40)
    expect(w).toContain(500)
    const two = windowIndices(20000, 200, [0, 19999])
    expect(two).toHaveLength(200)
    expect(two).toContain(0)
    expect(two).toContain(19999)
  })
})

describe('heap ties (§1: min by (prio, key); a pop sifts to the left child on a tie)', () => {
  const push = (key: number, prio: number): Step => ({ op: 'heap', sid: 0, act: 'push', key, prio })
  const texts = (m: FamilyModel, k: number) => heapView(m.insts[0] as HeapInst, k, currentAt(m, 0, k)).slots.map(s => s.text)
  it('equal priorities order by key: pushing 5, 3, 4, 2 at prio 3', () => {
    const m = buildFamilyModel([{ op: 'heap', sid: 0, act: 'new', name: 'h' }, push(5, 3), push(3, 3), push(4, 3), push(2, 3)])
    expect([2, 3, 4, 5].map(k => captionAt(m, 'heap', k))).toEqual(['push 5 (3) → slot 0', 'push 3 (3) → slot 0', 'push 4 (3) → slot 2', 'push 2 (3) → slot 0'])
    expect(texts(m, 5)).toEqual(['2 (3)', '3 (3)', '4 (3)', '5 (3)'])
  })
  it('a pop whose children tie moves the last item down the left side', () => {
    const m = buildFamilyModel([{ op: 'heap', sid: 0, act: 'new', name: 'h' }, push(0, 0), push(1, 1), push(1, 1), push(9, 9), { op: 'heap', sid: 0, act: 'pop', key: 0, prio: 0 }])
    expect(texts(m, 6)).toEqual(['1 (1)', '9 (9)', '1 (1)'])
  })
})

describe('VF-01 Dijkstra (p743)', () => {
  it('pins the graph and heap at dist[2] = 3 (via 3) and the next step', async () => {
    const m = buildFamilyModel(await steps('vf01', 5))
    expect(m.kinds).toEqual(['graph', 'heap'])
    const ks = stepsWith(m, 'graph', 'dist[2] = 3 (via 3)')
    expect(ks).toHaveLength(1)
    const k = ks[0]
    const g = one<GraphInst>(m, 'graph', k)
    const gv = graphView(g, k, currentAt(m, g.sid, k))
    const node = (id: number) => gv.nodes.find(n => n.id === id)!
    const edge = (key: string) => gv.edges.find(e => e.key === key)!
    expect([node(2).text, node(2).state]).toEqual(['2 · 3', 'current'])
    expect([node(1).text, node(1).state]).toEqual(['1 · 0', 'visited'])
    expect([node(3).text, node(3).state]).toEqual(['3 · 1', 'visited'])
    expect([node(4).text, node(4).state]).toEqual(['4', 'idle'])
    expect([edge('3-2').state, edge('1-2').state, edge('1-3').state]).toEqual(['current', 'idle', 'tree'])
    const h = one<HeapInst>(m, 'heap', k)
    expect(heapView(h, k, currentAt(m, h.sid, k)).slots.map(s => s.text)).toEqual(['2 (4)'])
    expect(captionAt(m, 'heap', k)).toBe('')
    const hv = heapView(h, k + 1, currentAt(m, h.sid, k + 1))
    expect(captionAt(m, 'heap', k + 1)).toBe('push 2 (3) → slot 0')
    expect(hv.slots.map(s => [s.text, s.current])).toEqual([['2 (3)', true], ['2 (4)', false]])
    expect(hv.tree.map(s => [s.i, s.text, s.current])).toEqual([[0, '2 (3)', true], [1, '2 (4)', false]])
    expect(graphView(g, k + 1, currentAt(m, g.sid, k + 1)).edges.find(e => e.key === '3-2')!.state).toBe('tree')
  })
})

describe('VF-02 topological sort (p207)', () => {
  it('pins mark 3: in 1', async () => {
    const m = buildFamilyModel(await steps('vf02', 5))
    const ks = stepsWith(m, 'graph', 'mark 3: in 1')
    expect(ks).toHaveLength(1)
    const k = ks[0]
    const g = one<GraphInst>(m, 'graph', k)
    const gv = graphView(g, k, currentAt(m, g.sid, k))
    const node = (id: number) => gv.nodes.find(n => n.id === id)!
    expect([node(3).text, node(3).state]).toEqual(['3 · in 1', 'current'])
    expect([node(0).text, node(0).state]).toEqual(['0 · in 0', 'visited'])
    expect([node(1).text, node(1).state]).toEqual(['1 · in 0', 'visited'])
    expect([node(2).text, node(2).state]).toEqual(['2 · in 0', 'seen'])
    const q = one<QueueInst>(m, 'queue', k)
    expect(queueView(q, k, currentAt(m, q.sid, k)).items.map(i => i.text)).toEqual(['2'])
  })
})

describe('VF-03 union-find (p684)', () => {
  it('pins union(1, 4): already joined (root 1)', async () => {
    const m = buildFamilyModel(await steps('vf03'))
    first(m, 'dsu', 'union(3, 4): 4 now under 1')
    const k = first(m, 'dsu', 'union(1, 4): already joined (root 1)')
    const d = one<DsuInst>(m, 'dsu', k)
    const v = dsuView(d, k, currentAt(m, d.sid, k))
    const x = (i: number) => v.nodes.find(n => n.x === i)!
    expect([2, 3, 4].map(i => x(i).parent)).toEqual([1, 1, 1])
    expect([x(1).root, x(5).root]).toEqual([true, true])
    expect(v.nodes.filter(n => n.current).map(n => n.x)).toEqual([1, 4])
    expect(v.count).toBe('3 sets')
  })
})

describe('VF-04 heap (p215)', () => {
  it('pins push 4 (4) → slot 0 and the pop after it', async () => {
    const m = buildFamilyModel(await steps('vf04'))
    const k = first(m, 'heap', 'push 4 (4) → slot 0')
    const h = one<HeapInst>(m, 'heap', k)
    const v = heapView(h, k, currentAt(m, h.sid, k))
    expect(v.slots.map(s => [s.text, s.current])).toEqual([['4 (4)', true], ['6 (6)', false], ['5 (5)', false]])
    expect(v.tree.map(s => s.text)).toEqual(['4 (4)', '6 (6)', '5 (5)'])
    expect(captionAt(m, 'heap', k + 1)).toBe('pop 4 (4)')
    const w = heapView(h, k + 1, currentAt(m, h.sid, k + 1))
    expect(w.slots.map(s => [s.text, s.current])).toEqual([['5 (5)', true], ['6 (6)', false]])
  })
})

describe('VF-05 window (p3)', () => {
  it('pins window [1..3] (len 3)', async () => {
    const m = buildFamilyModel(await steps('vf05'))
    const k = first(m, 'array', 'window [1..3] (len 3)')
    const a = one<ArrayInst>(m, 'array', k)
    const v = arrayView(a, k, currentAt(m, a.sid, k))
    expect(v.cells.map(c => c.state)).toEqual(['idle', 'window', 'window', 'window', 'idle', 'idle', 'idle', 'idle'])
    expect(v.cells[3].text).toBe('a')
    expect(v.pointers.map(p => [p.label, p.index])).toEqual([['lo', 1], ['hi', 3]])
    expect(captionAt(m, 'array', k - 1)).toBe('hi → 3')
  })
})

describe('VF-06 binary search (p875)', () => {
  it('pins the first Lo step', async () => {
    const m = buildFamilyModel(await steps('vf06'))
    const k = first(m, 'search', 'lo=1 mid=3 hi=6 · pred(3)=false → lo=4')
    const s = one<SearchInst>(m, 'search', k)
    const v = searchView(s, k, currentAt(m, s.sid, k))
    expect([v.lo, v.hi, v.mid]).toEqual([4, 6, 3])
    expect(v.probes.find(p => p.m === 6)!.pred).toBe(true)
    expect(v.probes.find(p => p.m === 3)!.pred).toBe(false)
    expect(captionAt(m, 'search', k - 1)).toBe('lo=1 mid=3 hi=6 · pred(3)=false')
    expect(captionAt(m, 'search', 1)).toMatch(/^search k in \[1\.\.11\]$/)
  })
  it('a move with no probe since the last one reads lo=… hi=… → lo=…', () => {
    const st: Step[] = [{ op: 'search', sid: 0, act: 'new', name: 's', lo: 0, hi: 9 }, { op: 'search', sid: 0, act: 'lo', v: 2 }, { op: 'search', sid: 0, act: 'mid', m: 5, pred: true }, { op: 'search', sid: 0, act: 'hi', v: 5 }, { op: 'search', sid: 0, act: 'hi', v: 4 }]
    const m = buildFamilyModel(st)
    expect([1, 2, 3, 4, 5].map(k => captionAt(m, 'search', k))).toEqual(['search s in [0..9]', 'lo=0 hi=9 → lo=2', 'lo=2 mid=5 hi=9 · pred(5)=true', 'lo=2 mid=5 hi=9 · pred(5)=true → hi=5', 'lo=2 hi=5 → hi=4'])
    const s = m.insts[0] as SearchInst
    expect(searchView(s, 1, new Set()).mid).toBeNull()
  })
})

describe('VF-07 linked list (p206)', () => {
  it('pins next(1) = 0', async () => {
    const m = buildFamilyModel(await steps('vf07'))
    const k = first(m, 'list', 'next(1) = 0')
    const l = one<ListInst>(m, 'list', k)
    const v = listView(l, k, currentAt(m, l.sid, k))
    const n = (id: number) => v.nodes.find(x => x.id === id)!
    expect(n(0).next).toBe('nil')
    expect([n(1).next, n(1).current, n(1).text]).toEqual(['0', true, '2'])
    expect([2, 3, 4].map(i => n(i).next)).toEqual(['3', '4', 'nil'])
    expect(v.pointers.map(p => [p.label, p.node])).toEqual([['prev', '0'], ['curr', '1']])
  })
})

describe('VF-08 intervals (p56)', () => {
  it('pins out[0] = [1,6]', async () => {
    const m = buildFamilyModel(await steps('vf08'))
    const k = first(m, 'intervals', 'out[0] = [1,6]')
    const boxes = liveAt(m, 'intervals', k) as IntervalsInst[]
    expect(boxes.map(b => b.name)).toEqual(['in', 'out'])
    const out = intervalsView(boxes[1], k, currentAt(m, boxes[1].sid, k))
    expect([out.items[0].text, out.items[0].current]).toEqual(['[1,6]', true])
    const inn = intervalsView(boxes[0], k, currentAt(m, boxes[0].sid, k))
    expect([inn.items[0].text, inn.items[0].mark]).toEqual(['[1,3]', 'new'])
    expect([inn.items[1].text, inn.items[1].mark]).toEqual(['[2,6]', ''])
    expect(captionAt(m, 'intervals', k + 1)).toBe('in[1] [2,6]: merged')
  })
})

describe('VF-09 tree (p543)', () => {
  it('pins 1 (2): h=2', async () => {
    const m = buildFamilyModel(await steps('vf09'))
    const k = first(m, 'tree', '1 (2): h=2')
    const t = one<TreeInst>(m, 'tree', k)
    const v = treeView(t, k, currentAt(m, t.sid, k))
    const n = (id: number) => v.nodes.find(x => x.id === id)
    expect([n(1)!.text, n(1)!.state, n(1)!.parent, n(1)!.side]).toEqual(['2 · h=2', 'current', 0, 'L'])
    expect([n(2)!.text, n(2)!.state]).toEqual(['4 · h=1', 'visited'])
    expect([n(3)!.text, n(3)!.state]).toEqual(['5 · h=1', 'visited'])
    expect([n(0)!.text, n(0)!.state]).toEqual(['1', 'visited'])
    expect(n(4)).toBeUndefined()
  })
})

describe('VF-10 game (p877)', () => {
  it('pins Step N: the game states and the call tree', async () => {
    const st = await steps('vf10')
    const sm = buildStepModel(st)
    const m = sm.fam!
    expect(m.kinds).toEqual(['game'])
    expect(sm.dp.hasTree).toBe(true)
    expect(sm.dp.hasTable).toBe(false)
    const k = m.N
    const g = one<GameInst>(m, 'game', k)
    const v = gameView(g, k, currentAt(m, g.sid, k))
    const s = (x: string) => v.states.find(y => y.state === x)!.text
    expect([s('0-2'), s('0-3'), s('1-3'), s('0-0')]).toEqual(['0-2 · lose (-2)', '0-3 · win (5)', '1-3 · win (6)', '0-0 · win (3)'])
    expect(sm.dp.nodes.some(n => n.hit)).toBe(true)
    const last = [...sm.dp.nodes].reverse().find(n => n.fn === 'best' && n.args.join(',') === '0,3')!
    expect(last.ret).toBe(5)
  })
})

describe('boxes and replacement', () => {
  it('a same-kind, same-name creation replaces the earlier structure; other kinds keep theirs', () => {
    const st: Step[] = [
      { op: 'heap', sid: 0, act: 'new', name: 'a' }, { op: 'queue', sid: 1, act: 'new', name: 'a' }, { op: 'heap', sid: 0, act: 'push', key: 1, prio: 1 },
      { op: 'heap', sid: 2, act: 'new', name: 'a' }, { op: 'heap', sid: 3, act: 'new', name: 'b' },
    ]
    const m = buildFamilyModel(st)
    expect(liveAt(m, 'heap', 3).map(x => x.sid)).toEqual([0])
    expect(liveAt(m, 'heap', 5).map(x => x.sid)).toEqual([2, 3])
    expect(liveAt(m, 'queue', 5).map(x => x.sid)).toEqual([1])
    expect(captionAt(m, 'queue', 3)).toBe('')
    expect(captionAt(m, 'heap', 1)).toBe('heap a')
  })

  it('graph captions: undirected edges use —, weights optional', () => {
    const m = buildFamilyModel([
      { op: 'graph', sid: 0, act: 'new', name: 'g', directed: false }, { op: 'graph', sid: 0, act: 'edge', u: 2, v: 1, w: 5 }, { op: 'graph', sid: 0, act: 'edge', u: 1, v: 3 },
      { op: 'graph', sid: 0, act: 'node', u: 7 }, { op: 'graph', sid: 0, act: 'visit', u: 7 },
    ])
    expect([1, 2, 3, 4, 5].map(k => captionAt(m, 'graph', k))).toEqual(['graph g (undirected)', 'edge 2 — 1 (w 5)', 'edge 1 — 3', 'node 7', 'visit 7'])
    const v = graphView(m.insts[0] as GraphInst, 2, currentAt(m, 0, 2))
    expect(v.edges).toEqual([{ key: '1-2', u: 1, v: 2, text: '5', state: 'current' }])
  })

  it('array, dsu, list, game captions', () => {
    const m = buildFamilyModel([
      { op: 'array', sid: 0, act: 'new', name: 'a', values: [3, 1], chars: false }, { op: 'array', sid: 0, act: 'set', i: 0, v: 9 }, { op: 'array', sid: 0, act: 'swap', i: 0, j: 1 },
      { op: 'array', sid: 0, act: 'window', lo: 2, hi: 1 }, { op: 'dsu', sid: 1, act: 'new', name: 'uf', n: 3 }, { op: 'dsu', sid: 1, act: 'find', x: 2 },
      { op: 'list', sid: 2, act: 'new', name: 'l' }, { op: 'list', sid: 2, act: 'node', id: 0, val: 4 }, { op: 'list', sid: 2, act: 'pointer', label: 'p', id: -1 },
      { op: 'game', sid: 3, act: 'new', name: 'g', states: ['a'] }, { op: 'game', sid: 3, act: 'set', state: 'b', outcome: 'draw' },
      { op: 'intervals', sid: 4, act: 'new', name: 'iv', items: [[1, 2]] }, { op: 'intervals', sid: 4, act: 'add', s: 3, e: 4 }, { op: 'tree', sid: 5, act: 'new', name: 't' },
      { op: 'tree', sid: 5, act: 'node', id: 0, val: 8, parent: -1, side: '' }, { op: 'tree', sid: 5, act: 'visit', id: 0 },
    ])
    const caps = Array.from({ length: m.N }, (_, i) => captionAt(m, m.kindAt[i]!, i + 1))
    expect(caps).toEqual(['array a (2)', 'a[0] = 9', 'swap a[0] ↔ a[1]', 'window empty', 'dsu uf (3)', 'find(2) = 2', 'list l', 'node 0 = 4', 'p = nil', 'game g', 'b: draw', 'intervals iv (1)', 'iv + [3,4]', 'tree t', 'node 0 = 8', 'visit 0 (8)'])
    expect(dsuView(m.insts[1] as DsuInst, 6, new Set()).count).toBe('3 sets')
    const gv = gameView(m.insts[3] as GameInst, 11, new Set())
    expect(gv.states.map(s => [s.text, s.outcome])).toEqual([['a · unknown', 'unknown'], ['b · draw', 'draw']])
  })
})

describe('Addendum 3: no silent drops', () => {
  it('a step the page cannot draw reads (event not shown) in its panel', () => {
    const st: Step[] = [
      { op: 'heap', sid: 0, act: 'new', name: 'h' }, { op: 'unshown', kind: 'heap' }, { op: 'heap', sid: 9, act: 'push', key: 1, prio: 1 },
      { op: 'array', sid: 1, act: 'new', name: 'a', values: [1], chars: false }, { op: 'array', sid: 1, act: 'set', i: 5, v: 1 }, { op: 'unshown', kind: 'graph' },
      { op: 'graph', sid: 2, act: 'new', name: 'g', directed: true }, { op: 'graph', sid: 2, act: 'visit', u: -3 },
    ]
    const sm = buildStepModel(st)
    const m = sm.fam!
    expect(m.kinds).toEqual(['graph', 'heap', 'array'])
    expect(captionAt(m, 'heap', 2)).toBe('(event not shown)')
    expect(captionAt(m, 'heap', 3)).toBe('(event not shown)')
    expect(captionAt(m, 'array', 5)).toBe('(event not shown)')
    expect(captionAt(m, 'graph', 6)).toBe('(event not shown)')
    expect(captionAt(m, 'graph', 8)).toBe('(event not shown)')
    expect(graphView(m.insts[2] as GraphInst, 8, currentAt(m, 2, 8)).nodes).toEqual([])
    expect(narrate(sm, 2)).toBe('(event not shown)')
    expect(narrate(buildStepModel([{ op: 'unshown' }]), 1)).toBe('(event not shown)')
  })
})

describe('Addendum 3: many structures', () => {
  const many = (n: number): Step[] => {
    const st: Step[] = []
    for (let i = 0; i < n; i++) st.push({ op: 'queue', sid: i, act: 'new', name: `q${i}` })
    return st
  }
  it('a panel draws the 50 most recent live boxes, plus a box with a current element', () => {
    const st = many(20000)
    st.push({ op: 'queue', sid: 5, act: 'push', v: 1 })
    const m = buildFamilyModel(st)
    const end = boxesAt(m, 'queue', 20000)
    expect(end.total).toBe(20000)
    expect(end.boxes.map(x => x.sid)).toEqual(Array.from({ length: 50 }, (_, i) => 19950 + i))
    const cur = boxesAt(m, 'queue', 20001)
    expect(cur.boxes.map(x => x.sid)).toEqual([5, ...Array.from({ length: 50 }, (_, i) => 19950 + i)])
    expect(boxesAt(m, 'queue', 30).boxes).toHaveLength(30)
  })
  it('Addendum 4: the current event of a replaced structure still draws its box for that step', () => {
    const st: Step[] = [
      { op: 'queue', sid: 0, act: 'new', name: 'q' }, { op: 'queue', sid: 1, act: 'new', name: 'q' }, { op: 'queue', sid: 0, act: 'push', v: 3 },
    ]
    const m = buildFamilyModel(st)
    const r = boxesAt(m, 'queue', 3)
    expect(r.boxes.map(x => x.sid)).toEqual([0, 1])
    expect(captionAt(m, 'queue', 3)).toBe('push 3')
    const v = queueView(m.insts[0] as QueueInst, 3, currentAt(m, 0, 3))
    expect(v.items.map(i => [i.text, i.current])).toEqual([['3', true]])
    expect(boxesAt(m, 'queue', 2).boxes.map(x => x.sid)).toEqual([1])
  })
  it('many dead structures are skipped without scanning each one', () => {
    const st: Step[] = []
    for (let i = 0; i < 200_000; i++) st.push({ op: 'heap', sid: i, act: 'new', name: 'h' })
    for (let i = 0; i < 40; i++) st.push({ op: 'heap', sid: 200_000 + i, act: 'new', name: `x${i}` })
    const m = buildFamilyModel(st)
    const t0 = performance.now()
    for (let k = st.length; k > st.length - 200; k--) boxesAt(m, 'heap', k)
    expect(performance.now() - t0).toBeLessThan(100)
    expect(boxesAt(m, 'heap', st.length).total).toBe(41)
    expect(boxesAt(m, 'heap', st.length).boxes[0].sid).toBe(199_999)
  })
  it('replaced structures are not counted', () => {
    const st: Step[] = []
    for (let i = 0; i < 1000; i++) st.push({ op: 'heap', sid: i, act: 'new', name: 'h' })
    const r = boxesAt(buildFamilyModel(st), 'heap', 1000)
    expect([r.total, r.boxes.map(x => x.sid)]).toEqual([1, [999]])
  })
  it('20,000 structures: 21 steps answered well inside the §6 budget', () => {
    const m = buildFamilyModel(many(20000))
    const t0 = performance.now()
    for (let k = 20000; k >= 19980; k--) boxesAt(m, 'queue', k)
    expect(performance.now() - t0).toBeLessThan(200)
  })
})

describe('Addendum 3: big structures are stored sparsely', () => {
  const mem = () => { const u = process.memoryUsage(); return u.heapUsed + u.arrayBuffers }
  it('20 DSUs of 5,000,000 build in well under a second, costing only what they touch', () => {
    const st: Step[] = []
    for (let s = 0; s < 20; s++) st.push({ op: 'dsu', sid: s, act: 'new', name: `u${s}`, n: 5_000_000 }, { op: 'dsu', sid: s, act: 'union', a: 4_999_999, b: 1 })
    const m0 = mem()
    const t0 = performance.now()
    const m = buildFamilyModel(st)
    const ms = performance.now() - t0
    const grew = mem() - m0
    expect(ms).toBeLessThan(300)
    expect(grew).toBeLessThan(20 * 1024 * 1024)
    const d = m.insts[19] as DsuInst
    expect(captionAt(m, 'dsu', 40)).toBe('union(4999999, 1): 1 now under 4999999')
    const v = dsuView(d, 40, currentAt(m, d.sid, 40))
    expect(v.count).toBe('4999999 sets')
    expect(v.nodes.find(x => x.x === 1)!.parent).toBe(4_999_999)
    expect(v.nodes.find(x => x.x === 4_999_999)!.root).toBe(true)
  })
  it('no silent clamp: a DSU of 6,000,000 keeps every element the toolkit accepts', () => {
    const m = buildFamilyModel([{ op: 'dsu', sid: 0, act: 'new', name: 'uf', n: 6_000_000 }, { op: 'dsu', sid: 0, act: 'union', a: 5_999_999, b: 1 }])
    expect(captionAt(m, 'dsu', 1)).toBe('dsu uf (6000000)')
    expect(captionAt(m, 'dsu', 2)).toBe('union(5999999, 1): 1 now under 5999999')
  })
  it('a 2,000,000-cell array and a 1,000,000-item interval list keep their values without a timeline per cell', () => {
    const values = Array.from({ length: 2_000_000 }, (_, i) => i)
    const items = Array.from({ length: 1_000_000 }, (_, i) => [i, i + 1])
    const st: Step[] = [
      { op: 'array', sid: 0, act: 'new', name: 'a', values, chars: false }, { op: 'array', sid: 0, act: 'swap', i: 0, j: 1_999_999 },
      { op: 'intervals', sid: 1, act: 'new', name: 'iv', items }, { op: 'intervals', sid: 1, act: 'set', i: 999_999, s: 7, e: 8 },
    ]
    const m0 = mem()
    const t0 = performance.now()
    const m = buildFamilyModel(st)
    const ms = performance.now() - t0
    const grew = mem() - m0
    expect(ms).toBeLessThan(500)
    expect(grew).toBeLessThan(60 * 1024 * 1024) // a typed copy of the initial values (16 + 16 MB), not 3M timelines
    const a = arrayView(m.insts[0] as ArrayInst, 2, currentAt(m, 0, 2))
    expect(a.cells.find(c => c.i === 0)!.text).toBe('1999999')
    expect(a.cells.find(c => c.i === 1_999_999)!.text).toBe('0')
    expect(arrayView(m.insts[0] as ArrayInst, 1, new Set()).cells[0].text).toBe('0')
    const iv = intervalsView(m.insts[1] as IntervalsInst, 4, currentAt(m, 1, 4))
    expect(iv.items.find(x => x.i === 999_999)!.text).toBe('[7,8]')
    expect(intervalsView(m.insts[1] as IntervalsInst, 3, new Set()).items[0].text).toBe('[0,1]')
  })
})

describe('§6: 20,000 steps', () => {
  it('builds once and answers any step quickly, for every family', () => {
    const mk = (kind: Kind): Step[] => {
      const st: Step[] = []
      for (let i = 0; i < 20000; i++) {
        const k = i
        switch (kind) {
          case 'graph': st.push(k === 0 ? { op: 'graph', sid: 0, act: 'new', name: 'g', directed: true } : { op: 'graph', sid: 0, act: 'edge', u: k % 5000, v: (k * 7) % 5000, w: k }); break
          case 'heap': st.push(k === 0 ? { op: 'heap', sid: 0, act: 'new', name: 'h' } : { op: 'heap', sid: 0, act: 'push', key: k, prio: (k * 7919) % 10007 }); break
          case 'queue': st.push(k === 0 ? { op: 'queue', sid: 0, act: 'new', name: 'q' } : { op: 'queue', sid: 0, act: 'push', v: k }); break
          case 'dsu': st.push(k === 0 ? { op: 'dsu', sid: 0, act: 'new', name: 'u', n: 20000 } : { op: 'dsu', sid: 0, act: 'union', a: k, b: (k * 31) % 20000 }); break
          case 'array': st.push(k === 0 ? { op: 'array', sid: 0, act: 'new', name: 'a', values: Array.from({ length: 5000 }, (_, i) => i), chars: false } : { op: 'array', sid: 0, act: 'swap', i: k % 5000, j: (k * 13) % 5000 }); break
          case 'search': st.push(k === 0 ? { op: 'search', sid: 0, act: 'new', name: 's', lo: 0, hi: 1e9 } : { op: 'search', sid: 0, act: 'mid', m: k, pred: k % 2 === 0 }); break
          case 'list': st.push(k === 0 ? { op: 'list', sid: 0, act: 'new', name: 'l' } : { op: 'list', sid: 0, act: 'node', id: k, val: k }); break
          case 'intervals': st.push(k === 0 ? { op: 'intervals', sid: 0, act: 'new', name: 'i', items: [] } : { op: 'intervals', sid: 0, act: 'add', s: k, e: k + 1 }); break
          case 'tree': st.push(k === 0 ? { op: 'tree', sid: 0, act: 'new', name: 't' } : { op: 'tree', sid: 0, act: 'node', id: k, val: k, parent: k === 1 ? -1 : Math.floor(k / 2), side: k === 1 ? '' : k % 2 ? 'R' : 'L' }); break
          case 'game': st.push(k === 0 ? { op: 'game', sid: 0, act: 'new', name: 'g', states: [] } : { op: 'game', sid: 0, act: 'set', state: `s${k}`, outcome: 'win', value: k }); break
          default: break
        }
      }
      return st
    }
    const views: Record<string, (x: never, k: number, c: Set<string>) => unknown> = {
      graph: graphView, heap: heapView, queue: queueView, dsu: dsuView, array: arrayView, search: searchView, list: listView, intervals: intervalsView, tree: treeView, game: gameView,
    }
    for (const kind of ['graph', 'heap', 'queue', 'dsu', 'array', 'search', 'list', 'intervals', 'tree', 'game'] as Kind[]) {
      const t0 = performance.now()
      const m = buildFamilyModel(mk(kind))
      const built = performance.now() - t0
      const t1 = performance.now()
      for (let k = 20000; k > 19980; k--) views[kind](m.insts[0] as never, k, currentAt(m, 0, k))
      views[kind](m.insts[0] as never, 1, currentAt(m, 0, 1))
      const per = (performance.now() - t1) / 21
      expect(built, `${kind} build`).toBeLessThan(1500)
      expect(per, `${kind} per step`).toBeLessThan(40)
    }
  })
})

describe('UAT J4: caseLabels', () => {
  it('names the case each step is in, from the case marker on its first event', () => {
    const steps = [
      { op: 'table', t: 1, name: 'dp', rows: 1, cols: 3, case: 1 },
      { op: 'set', t: 1, r: 0, c: 0, v: 1 },
      { op: 'set', t: 1, r: 0, c: 1, v: 1, case: 2 },
      { op: 'set', t: 1, r: 0, c: 2, v: 2 },
    ] as unknown as Parameters<typeof caseLabels>[0]
    expect(caseLabels(steps, [1, 2])).toEqual([null, 'Case 1 of 2', 'Case 1 of 2', 'Case 2 of 2', 'Case 2 of 2'])
    expect(caseLabels(steps, [])).toEqual([null, null, null, null, null])
  })
  it('UAT r3 J4: names the input from the case call, as the mockup does', () => {
    const steps = [
      { op: 'table', t: 1, name: 'dp', rows: 1, cols: 3, case: 1 },
      { op: 'set', t: 1, r: 0, c: 1, v: 1, case: 2 },
    ] as unknown as Parameters<typeof caseLabels>[0]
    expect(caseLabels(steps, [1, 2], { 1: 'numDecodings("12")', 2: 'numDecodings("226")' })).toEqual([null, 'Case 1 of 2 ("12")', 'Case 2 of 2 ("226")'])
    expect(caseInput('coinChange([1, 2, 5], 11)')).toBe('([1, 2, 5], 11)')
    expect(caseInput('f()')).toBe('')
    expect(caseInput(`f(${'9'.repeat(60)})`)).toBe(`(${'9'.repeat(37)}…)`)
  })
})

// ---------------------------------------------------------------- UAT cu-5 P2-1: what a pane holds room for in a case

describe('casePlan, slotProbes and intervalsExtent (one size per case)', () => {
  const build = (st: Step[]) => buildFamilyModel(st)

  it('a case holds every structure alive at any of its steps, in the order they first show, and the longest captions', () => {
    const m = build([
      { op: 'heap', sid: 0, act: 'new', name: 'pq', case: 1 },
      { op: 'heap', sid: 0, act: 'push', key: 1, prio: 1 },
      { op: 'heap', sid: 1, act: 'new', name: 'other' },
      { op: 'heap', sid: 2, act: 'new', name: 'pq', case: 2 },
      { op: 'heap', sid: 2, act: 'push', key: 12345, prio: 99999 },
    ])
    const c1 = casePlan(m, 'heap', 1)
    expect([c1.cs, c1.ce]).toEqual([1, 3])
    expect(c1.slots.map(s => [s.name, s.first])).toEqual([['pq', 1], ['other', 3]])
    expect(c1.captions[0]).toBe('push 1 (1) → slot 0')
    // the next case: the first pq ended at its replacement (step 4), so only the second one and "other" (still alive) are in it
    const c2 = casePlan(m, 'heap', 4)
    expect([c2.cs, c2.ce]).toEqual([4, 5])
    expect(c2.slots.map(s => [s.name, s.insts.map(x => x.sid)])).toEqual([['other', [1]], ['pq', [2]]])
    expect(casePlan(m, 'heap', 5)).toBe(c2) // cached per case
  })

  it('a run with more structures than a pane can hold room for keeps its panes unreserved', () => {
    const st: Step[] = []
    for (let i = 0; i < 20; i++) st.push({ op: 'queue', sid: i, act: 'new', name: `q${i}` })
    expect(casePlan(build(st), 'queue', 1).slots).toEqual([])
  })

  it('probes the ends of a structure in the case and each step its own events change it', () => {
    const m = build([
      { op: 'queue', sid: 0, act: 'new', name: 'q', case: 1 },
      { op: 'heap', sid: 1, act: 'new', name: 'h' },
      { op: 'queue', sid: 0, act: 'push', v: 1 },
      { op: 'heap', sid: 1, act: 'push', key: 1, prio: 1 },
      { op: 'queue', sid: 0, act: 'push', v: 2 },
      { op: 'queue', sid: 0, act: 'pop', v: 1 },
    ])
    const plan = casePlan(m, 'queue', 1)
    const at = slotProbes(m, plan, plan.slots[0]).map(p => p.at)
    expect([...at].sort((a, b) => a - b)).toEqual([1, 3, 5, 6])
  })

  it('a long case is sampled to at most PROBE_MAX steps, keeping its tallest and both ends', () => {
    const st: Step[] = [{ op: 'queue', sid: 0, act: 'new', name: 'q', case: 1 }]
    for (let i = 0; i < 300; i++) st.push({ op: 'queue', sid: 0, act: 'push', v: i })
    for (let i = 0; i < 200; i++) st.push({ op: 'queue', sid: 0, act: 'pop', v: i })
    const m = build(st)
    const plan = casePlan(m, 'queue', 1)
    const at = slotProbes(m, plan, plan.slots[0]).map(p => p.at)
    expect(at.length).toBeLessThanOrEqual(PROBE_MAX)
    expect(at).toContain(1)
    expect(at).toContain(501)
    expect(at).toContain(301) // the longest the queue gets: after the 300th push
  })

  it('an intervals axis covers every value the structure ever holds', () => {
    const m = build([
      { op: 'intervals', sid: 0, act: 'new', name: 'out', items: [] },
      { op: 'intervals', sid: 0, act: 'add', s: 1, e: 3 },
      { op: 'intervals', sid: 0, act: 'set', i: 0, s: 1, e: 18 },
      { op: 'intervals', sid: 0, act: 'add', s: -2, e: 0 },
    ])
    expect(intervalsExtent(liveAt(m, 'intervals', 4)[0] as unknown as IntervalsInst)).toEqual([-2, 18])
  })
})
