// @vitest-environment node
// C-VISUAL §1–§2 and §5 on the Go side: the family events on the wire, the 15 new packs, the new types and
// the misuse messages, through the real runner when Go is present.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callText, goLiteral, harnessMain, loadPacks, PACK_IDS, parseEvents, publicPack, resolveGo, runGo, TK_DIR, type Pack } from '../../server/runner/runner.mjs'
import { familyStep } from '../../shared/stepShape.mjs'
import { buildFamilyModel, captionAt, heapView, type HeapInst } from '../../src/runner/families/model'
import type { Step } from '../../src/runner/types'
import { diffText, errorText, statusText } from '../../src/runner/status'
import { runPy } from '../helpers/pyRun'
import { GO_VF, PY_VF } from '../helpers/visualSolutions'

const packs = loadPacks()
const N = null

/** C-VISUAL §5's table: Go signature and cases (input → expected), exactly. */
export const VISUAL_PACKS: Record<string, [string, [unknown[], unknown][]]> = {
  p743: ['func networkDelayTime(times [][]int, n int, k int) int', [
    [[[[2, 1, 1], [2, 3, 1], [3, 4, 1]], 4, 2], 2], [[[[1, 2, 1]], 2, 1], 1], [[[[1, 2, 1]], 2, 2], -1],
    [[[[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 1]], 4, 1], 4], [[[[1, 2, 1], [2, 3, 2], [1, 3, 4], [3, 4, 1], [4, 5, 3], [2, 5, 7], [5, 1, 1]], 5, 1], 7]]],
  p207: ['func canFinish(numCourses int, prerequisites [][]int) bool', [
    [[2, [[1, 0]]], true], [[2, [[1, 0], [0, 1]]], false], [[4, [[1, 0], [2, 0], [3, 1], [3, 2]]], true], [[3, [[0, 1], [1, 2], [2, 0]]], false], [[5, [[1, 0], [2, 1], [4, 3]]], true]]],
  p802: ['func eventualSafeNodes(graph [][]int) []int', [
    [[[[1, 2], [2, 3], [5], [0], [5], [], []]], [2, 4, 5, 6]], [[[[1, 2, 3, 4], [1, 2], [3, 4], [0, 4], []]], [4]], [[[[]]], [0]], [[[[0]]], []], [[[[1], [2], [0, 3], []]], [3]]]],
  p684: ['func findRedundantConnection(edges [][]int) []int', [
    [[[[1, 2], [1, 3], [2, 3]]], [2, 3]], [[[[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]]], [1, 4]], [[[[3, 4], [1, 2], [2, 4], [3, 5], [2, 5]]], [2, 5]],
    [[[[1, 4], [3, 4], [1, 3], [1, 2], [4, 5]]], [1, 3]], [[[[2, 3], [5, 2], [1, 5], [4, 2], [4, 1]]], [4, 1]]]],
  p1584: ['func minCostConnectPoints(points [][]int) int', [
    [[[[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]]], 20], [[[[3, 12], [-2, 5], [-4, 1]]], 18], [[[[0, 0]]], 0], [[[[0, 0], [1, 1], [1, 0], [-1, 1]]], 4], [[[[-1000000, -1000000], [1000000, 1000000]]], 4000000]]],
  p877: ['func stoneGame(piles []int) bool', [[[[5, 3, 4, 5]], true], [[[3, 7, 2, 3]], true], [[[2, 1]], true], [[[7, 8, 8, 10, 1, 3]], true], [[[6, 1, 2, 5, 3, 4]], true]]],
  p55: ['func canJump(nums []int) bool', [[[[2, 3, 1, 1, 4]], true], [[[3, 2, 1, 0, 4]], false], [[[0]], true], [[[1, 0, 1, 0]], false], [[[2, 5, 0, 0]], true]]],
  p875: ['func minEatingSpeed(piles []int, h int) int', [
    [[[3, 6, 7, 11], 8], 4], [[[30, 11, 23, 4, 20], 5], 30], [[[30, 11, 23, 4, 20], 6], 23], [[[1000000000], 2], 500000000], [[[312884470], 312884469], 2]]],
  p153: ['func findMin(nums []int) int', [[[[3, 4, 5, 1, 2]], 1], [[[4, 5, 6, 7, 0, 1, 2]], 0], [[[11, 13, 15, 17]], 11], [[[2, 1]], 1], [[[7, 8, 9, 10, 2, 3, 4, 5, 6]], 2]]],
  p3: ['func lengthOfLongestSubstring(s string) int', [[['abcabcbb'], 3], [['bbbbb'], 1], [['pwwkew'], 3], [[''], 0], [['abba'], 2]]],
  p11: ['func maxArea(height []int) int', [[[[1, 8, 6, 2, 5, 4, 8, 3, 7]], 49], [[[1, 1]], 1], [[[4, 3, 2, 1, 4]], 16], [[[1, 2, 1]], 2], [[[2, 3, 4, 5, 18, 17, 6]], 17]]],
  p206: ['func reverseList(head *ListNode) *ListNode', [[[[1, 2, 3, 4, 5]], [5, 4, 3, 2, 1]], [[[1, 2]], [2, 1]], [[[]], []], [[[7]], [7]], [[[1, 1, 2, 3]], [3, 2, 1, 1]]]],
  p56: ['func merge(intervals [][]int) [][]int', [
    [[[[1, 3], [2, 6], [8, 10], [15, 18]]], [[1, 6], [8, 10], [15, 18]]], [[[[1, 4], [4, 5]]], [[1, 5]]], [[[[1, 4], [0, 4]]], [[0, 4]]], [[[[1, 4], [2, 3]]], [[1, 4]]],
    [[[[2, 3], [4, 5], [6, 7], [8, 9], [1, 10]]], [[1, 10]]]]],
  p215: ['func findKthLargest(nums []int, k int) int', [[[[3, 2, 1, 5, 6, 4], 2], 5], [[[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], 4], [[[1], 1], 1], [[[-1, -1], 2], -1], [[[7, 6, 5, 4, 3, 2, 1], 5], 3]]],
  p543: ['func diameterOfBinaryTree(root *TreeNode) int', [[[[1, 2, 3, 4, 5]], 3], [[[1, 2]], 1], [[[1]], 0], [[[1, 2, N, 3, N, 4]], 3],
    [[[4, -7, -3, N, N, -9, -3, 9, -7, -4, N, 6, N, -6, -6, N, N, 0, 6, 5, N, 9, N, N, -1, -4, N, N, N, -2]], 8]]],
}

describe('packs (C-VISUAL §5)', () => {
  it('the pack list grows by exactly the 15 visual tickets', () => {
    expect([...PACK_IDS].sort()).toEqual(['p91', 'p198', 'p322', 'p62', 'p1143', ...Object.keys(VISUAL_PACKS)].sort())
    expect([...packs.keys()].sort()).toEqual([...PACK_IDS].sort())
  })

  it('each has the pinned signature and cases, a starter with the signature and a marked reference', () => {
    for (const [id, [sig, cases]] of Object.entries(VISUAL_PACKS)) {
      const p = packs.get(id) as Pack
      expect(p.signature, id).toBe(sig)
      expect(p.cases.map(c => [c.args, c.expected]), id).toEqual(cases)
      expect(p.starter, id).toContain(sig)
      expect(p.ref.startsWith('// dojo-ref\n'), id).toBe(true)
      expect(JSON.stringify(publicPack(p)), id).not.toContain('dojo-ref')
    }
  })

  it('the starters pin the output orders (§5)', () => {
    expect((packs.get('p56') as Pack).starter).toMatch(/sorted by start/)
    expect((packs.get('p802') as Pack).starter).toMatch(/ascending order/)
    expect((packs.get('p684') as Pack).starter).toMatch(/comes last in the input/)
  })

  it('shows list and tree inputs as JSON arrays with null', () => {
    expect(callText(packs.get('p206') as Pack, [[1, 2]])).toBe('reverseList([1,2])')
    expect(publicPack(packs.get('p543') as Pack).cases[3].call).toBe('diameterOfBinaryTree([1,2,null,3,null,4])')
    expect(publicPack(packs.get('p743') as Pack).cases[0].call).toBe('networkDelayTime([[2,1,1],[2,3,1],[3,4,1]], 4, 2)')
  })
})

describe('new types in the Go harness (§5)', () => {
  it('builds lists and level-order trees', () => {
    expect(goLiteral('*ListNode', [1, 2])).toBe('dojo_list([]int{1, 2})')
    expect(goLiteral('*ListNode', [])).toBe('dojo_list([]int{})')
    expect(goLiteral('*TreeNode', [1, null, 3])).toBe('dojo_tree([]int{1, 0, 3}, []bool{true, false, true})')
  })

  it('declares ListNode and TreeNode in every harness', () => {
    const src = harnessMain(packs.get('p91') as Pack, (packs.get('p91') as Pack).cases)
    expect(src).toContain('type ListNode struct {\n\tVal  int\n\tNext *ListNode\n}')
    expect(src).toContain('type TreeNode struct {\n\tVal   int\n\tLeft  *TreeNode\n\tRight *TreeNode\n}')
    const p206 = harnessMain(packs.get('p206') as Pack, (packs.get('p206') as Pack).cases.slice(0, 1))
    expect(p206).toContain('return dojo_listout(reverseList(dojo_list([]int{1, 2, 3, 4, 5})))')
  })
})

describe('family events on the wire (§2)', () => {
  it('reads V lines as steps, with the case marker', () => {
    const r = parseEvents([
      'C 1', 'V {"op":"graph","sid":0,"act":"new","name":"g","directed":true}', 'V {"op":"graph","sid":0,"act":"edge","u":1,"v":2,"w":4}',
      'T 0 1 2 "dp"', 'V {"op":"heap","sid":1,"act":"push","key":2,"prio":3}', 'C 2', 'V {"op":"game","sid":2,"act":"set","state":"0-1","outcome":"win"}',
    ].join('\n'))
    expect(r.steps).toEqual([
      { op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 1 },
      { op: 'graph', sid: 0, act: 'edge', u: 1, v: 2, w: 4 },
      { op: 'table', t: 0, rows: 1, cols: 2, name: 'dp' },
      { op: 'heap', sid: 1, act: 'push', key: 2, prio: 3 },
      { op: 'game', sid: 2, act: 'set', state: '0-1', outcome: 'win', case: 2 },
    ])
  })

  it('Addendum 3: a family line of the wrong shape is a step "not shown", never dropped; known fields only', () => {
    const r = parseEvents([
      'C 1', 'V {"op":"graph","sid":0,"act":"fly","u":1}', 'V {"op":"heap","sid":0,"act":"push","key":"2","prio":3}', 'V {"op":"nope","sid":0,"act":"new"}',
      'V {"op":"queue","sid":0,"act":"push","v":1,"extra":9}', 'V {not json', 'V {"op":"dsu","sid":-1,"act":"find","x":1}', 'V {"op":"dsu","sid":4294967296,"act":"find","x":1}',
    ].join('\n'))
    expect(r.steps).toEqual([
      { op: 'unshown', kind: 'graph', case: 1 }, { op: 'unshown', kind: 'heap' }, { op: 'unshown' }, { op: 'queue', sid: 0, act: 'push', v: 1 },
      { op: 'unshown' }, { op: 'unshown', kind: 'dsu' }, { op: 'unshown', kind: 'dsu' },
    ])
  })

  it('one cap for DP and family steps', () => {
    const wire = [...Array.from({ length: 15 }, (_, i) => `X ${i}`), ...Array.from({ length: 15 }, () => 'V {"op":"graph","sid":0,"act":"visit","u":1}')].join('\n')
    const r = parseEvents(wire, 20)
    expect(r.steps).toHaveLength(20)
    expect(r.steps[19]).toMatchObject({ op: 'graph', act: 'visit' })
    expect(r.truncated).toBe(true)
  })

  it('Addendum 4: only safe integers pass the step check', () => {
    expect(familyStep({ op: 'queue', sid: 0, act: 'push', v: 2 ** 53 - 1 })).not.toBeNull()
    expect(familyStep({ op: 'queue', sid: 0, act: 'push', v: 2 ** 53 })).toBeNull()
    expect(familyStep({ op: 'array', sid: 0, act: 'new', name: 'a', values: [1, -(2 ** 60)], chars: false })).toBeNull()
  })

  it('familyStep checks every family\'s fields', () => {
    expect(familyStep({ op: 'array', sid: 0, act: 'new', name: 's', values: [97], chars: true })).toEqual({ op: 'array', sid: 0, act: 'new', name: 's', values: [97], chars: true })
    expect(familyStep({ op: 'array', sid: 0, act: 'new', name: 's', values: [1.5], chars: true })).toBeNull()
    expect(familyStep({ op: 'intervals', sid: 0, act: 'new', name: 'in', items: [[1, 3], [2, 6]] })).not.toBeNull()
    expect(familyStep({ op: 'tree', sid: 0, act: 'node', id: 1, val: 2, parent: 0 })).toBeNull()
    expect(familyStep({ op: 'game', sid: 0, act: 'set', state: 'a', outcome: 'win', value: null })).toEqual({ op: 'game', sid: 0, act: 'set', state: 'a', outcome: 'win' })
    expect(familyStep({ op: 'search', sid: 0, act: 'mid', m: 3, pred: 1 })).toBeNull()
    expect(familyStep({ op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 'x' })).toBeNull()
  })
})

// ---------------------------------------------------------------- with the Go toolchain
const goBin = resolveGo(process.env)
// G4 M1: these runs are the Go side of the contract; without Go they fail loudly instead of skipping
if (!goBin) {
  describe('visual runs', () => {
    it('need the Go toolchain (go on PATH, or DOJO_GO_BIN)', () => { throw new Error('Go is not installed: the visual runner tests cannot run') })
  })
}
const withGo = goBin ? describe : describe.skip

withGo('visual runs (Go toolchain present)', () => {
  let home: string
  beforeAll(() => { home = mkdtempSync(join(tmpdir(), 'dojo-visual-home-')) })
  afterAll(() => { rmSync(home, { recursive: true, force: true }) })
  const run = (id: string, code: string, mode: 'run' | 'submit' = 'run') => runGo({ pack: packs.get(id) as Pack, code, mode }, { home })
  const T = 60_000

  it('the toolkit\'s own semantics (go test ./tk/)', () => {
    const d = mkdtempSync(join(tmpdir(), 'dojo-tk-test-'))
    try {
      cpSync(TK_DIR, join(d, 'tk'), { recursive: true })
      writeFileSync(join(d, 'go.mod'), 'module dojo\n\ngo 1.22\n')
      const out = execFileSync(goBin as string, ['test', '-count=1', '-tags', 'dojo_wiretest', './tk/'], {
        cwd: d, encoding: 'utf8', env: { ...process.env, GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'local', GOWORK: 'off', CGO_ENABLED: '0', GOTELEMETRY: 'off' },
      })
      expect(out).toMatch(/^ok\s+dojo\/tk/m)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }, T)

  it('every new reference passes Submit 5/5', async () => {
    for (const id of Object.keys(VISUAL_PACKS)) {
      const p = packs.get(id) as Pack
      const r = await run(id, p.ref, 'submit')
      expect(r.status, `${id} ${JSON.stringify(r.errors)}`).toBe('ok')
      expect(r.cases.map(c => c.pass), `${id} ${JSON.stringify(r.cases)}`).toEqual([true, true, true, true, true])
    }
  }, 300_000)

  it('VF-13: unchanged p206 and p56 starters fail with the pinned diffs', async () => {
    const l = await run('p206', (packs.get('p206') as Pack).starter)
    expect(statusText(l)).toBe('Failed 0/2')
    expect(diffText(l.cases[0])).toBe('reverseList([1,2,3,4,5]): expected [5,4,3,2,1], got [1,2,3,4,5]')
    const m = await run('p56', (packs.get('p56') as Pack).starter)
    expect(diffText(m.cases[0])).toBe('merge([[1,3],[2,6],[8,10],[15,18]]): expected [[1,6],[8,10],[15,18]], got [[1,3],[2,6],[8,10],[15,18]]')
  }, T)

  it('Addendum 4: a Go result beyond ±2^53 is shown as exact text, and a toolkit int beyond it is a misuse', async () => {
    const r = await run('p91', 'package main\n\nfunc numDecodings(s string) int { return 1<<60 + 1 }\n')
    expect(r.status).toBe('ok')
    expect(r.cases[0]).toMatchObject({ got: '1152921504606846977', pass: false })
    const a = await run('p802', 'package main\n\nfunc eventualSafeNodes(graph [][]int) []int { return []int{-(1 << 60), 3} }\n')
    expect(a.cases[0].got).toEqual(['-1152921504606846976', 3])
    const m = await run('p215', 'package main\n\nimport "dojo/tk"\n\nfunc findKthLargest(nums []int, k int) int {\n\ttk.Heap("h").Push(1, 1<<53)\n\treturn 0\n}\n')
    expect(m.errors.map(errorText)).toEqual(['line 6: tk: 9007199254740992 is too large to draw (beyond ±2^53)'])
  }, T)

  it('VF-13: redeclaring ListNode is a compile error', async () => {
    const r = await run('p206', 'package main\n\ntype ListNode struct {\n\tVal  int\n\tNext *ListNode\n}\n\nfunc reverseList(head *ListNode) *ListNode { return head }\n')
    expect(statusText(r)).toBe('Compile error')
    expect(r.errors[0].message).toMatch(/ListNode/)
  }, T)

  it('a returned list with a cycle fails with got "cycle"; a nil slice is []', async () => {
    const r = await run('p206', 'package main\n\nfunc reverseList(head *ListNode) *ListNode {\n\tn := head\n\tfor n.Next != nil { n = n.Next }\n\tn.Next = head\n\treturn head\n}\n')
    expect(r.status).toBe('ok')
    expect(r.cases.map(c => [c.got, c.pass])).toEqual([['cycle', false], ['cycle', false]])
    const s = await run('p802', 'package main\n\nfunc eventualSafeNodes(graph [][]int) []int { return nil }\n', 'submit')
    expect(s.cases[3]).toMatchObject({ got: [], pass: true })
  }, T)

  it('VF-14 (Go): the pinned misuse message at the learner\'s line, with the steps up to it', async () => {
    const code = 'package main\n\nimport "dojo/tk"\n\nfunc lengthOfLongestSubstring(s string) int {\n\ta := tk.Chars("s", s)\n\ta.Pointer("lo", 0)\n\ta.Pointer("lo", 99)\n\treturn 0\n}\n'
    const r = await run('p3', code)
    expect(statusText(r)).toBe('Runtime error')
    // each case runs: the first case's error comes first, then the second's ("bbbbb" has 5 characters)
    expect(r.errors.map(errorText)).toEqual(['line 8: tk: pointer lo → 99 is outside s (-1..8)', 'line 8: tk: pointer lo → 99 is outside s (-1..5)'])
    expect(r.steps.map(s => `${s.op} ${(s as { act?: string }).act}`)).toEqual(['array new', 'array pointer', 'array new', 'array pointer'])
  }, T)

  it('VF-11 at the source: Go and Python write identical steps for every VF solution', async () => {
    for (const id of Object.keys(GO_VF)) {
      const [pack, code] = GO_VF[id]
      const mode = id === 'vf01' || id === 'vf02' ? 'submit' : 'run'
      const g = await run(pack, code, mode)
      expect(statusText(g), `${id} ${JSON.stringify(g.errors)}`).toMatch(/^Passed/)
      const p = await runPy(PY_VF[id][1], pack, mode === 'submit' ? 5 : 2)
      expect(statusText(p), id).toBe(statusText(g))
      expect(p.steps, id).toEqual(g.steps)
    }
  }, 300_000)

  it('heap ties: the page replays a Go run into the same slots as Go\'s own heap', async () => {
    const code = `package main

import (
	"fmt"
	"dojo/tk"
)

func findKthLargest(nums []int, k int) int {
	h := tk.Heap("h")
	for _, kp := range [][2]int{{5, 3}, {3, 3}, {4, 3}, {2, 3}, {7, 1}, {1, 3}, {6, 3}} {
		h.Push(kp[0], kp[1])
	}
	h.Pop()
	for h.Len() > 0 {
		key, prio := h.Pop()
		fmt.Printf("%d(%d) ", key, prio)
	}
	fmt.Println()
	return 0
}
`
    const r = await run('p215', code)
    expect(r.status).toBe('ok')
    const steps = r.steps.slice(0, r.steps.findIndex(x => x.case === 2)) as unknown as Step[] // case 1 only
    const m = buildFamilyModel(steps)
    const h = m.insts[0] as HeapInst
    // after the 7 pushes and the first pop, the page's slots popped in order must equal what Go popped
    const kAfterFirstPop = steps.findIndex(s => (s as { act?: string }).act === 'pop') + 1
    const order: string[] = []
    for (let k = kAfterFirstPop + 1; k <= steps.length; k++) order.push(captionAt(m, 'heap', k).replace(/^pop (\d+) \((\d+)\)$/, '$1($2)'))
    expect(order.join(' ')).toBe(r.stdout.split('\n')[0].trim())
    // what Go popped next is the page's slot 0 just before: equal priorities break by key in both
    for (let k = kAfterFirstPop + 1; k <= steps.length; k++) {
      const top = heapView(h, k - 1, new Set()).slots[0].text.replace(' ', '')
      expect(order[k - kAfterFirstPop - 1]).toBe(top)
    }
    expect(captionAt(m, 'heap', 5)).toBe('push 2 (3) → slot 0')
  }, T)

  it('family events stream on fd 3 in program order, every case', async () => {
    const code = `package main

import "dojo/tk"

func findKthLargest(nums []int, k int) int {
	h := tk.Heap("h")
	for _, x := range nums {
		h.Push(x, x)
		if h.Len() > k {
			h.Pop()
		}
	}
	key, _ := h.Peek()
	return key
}
`
    const r = await run('p215', code)
    expect(statusText(r)).toBe('Passed 2/2')
    expect(r.steps[0]).toEqual({ op: 'heap', sid: 0, act: 'new', name: 'h', case: 1 })
    expect(r.steps[1]).toEqual({ op: 'heap', sid: 0, act: 'push', key: 3, prio: 3 })
    expect(r.steps.filter(s => s.case === 2)).toHaveLength(1)
  }, T)
})
