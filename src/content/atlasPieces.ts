// W7 (ATLAS-05): the nine Atlas rows that had no walkthrough get one. Same shape as the vendored pieces
// (public/engines/atlas-pieces.js): a fixed worked example, `<sr-algo>` step JSON, a few code lines, a sentence on
// the steps that matter and the variables beside them. The vendored file is generated from the design handoff and
// never edited, so these are built here, like content/pieceOverrides.ts. Every number below is computed by running
// the algorithm, so the picture cannot disagree with its code.
import type { AlgoJson, AlgoStep } from '../rules/algoJson'

type Extra = Omit<AlgoStep, 'op'>

function recorder() {
  const steps: AlgoStep[] = []
  const add = (op: string, o: Extra = {}) => { steps.push({ op, ...o }) }
  /** A step that only moves a highlight: it joins the step after it (rules/narration, `group: 'next'`). */
  const quiet = (op: string, o: Extra = {}) => { steps.push({ op, ...o, group: 'next' }) }
  return { steps, add, quiet }
}

const bin = (mask: number, width: number) => mask.toString(2).padStart(width, '0')

/** Prefix sums: build once, answer any range sum with two reads. */
export function prefixSum(): AlgoJson {
  const a = [3, 1, 4, 1, 5, 9, 2, 6]
  const pre = [0]
  const { steps, add, quiet } = recorder()
  add('say', { line: 0, say: 'pre[0] = 0, the sum of nothing. pre[i] will hold a[0] + … + a[i−1].' })
  a.forEach((x, i) => {
    pre.push(pre[i] + x)
    quiet('pointer', { name: 'i', s: 'a', i, line: 1 })
    add('set', { s: 'pre', i: i + 1, v: pre[i + 1], line: 2, say: `pre[${i + 1}] = pre[${i}] + a[${i}] = ${pre[i]} + ${x} = ${pre[i + 1]}.`, vars: { i, 'pre[i+1]': pre[i + 1] } })
  })
  add('pointer', { name: 'i', s: 'a', i: null })
  const query = (l: number, r: number) => {
    add('window', { s: 'a', lo: l, hi: r, line: 3, say: `Query: the sum of a[${l}..${r}].`, vars: { l, r } })
    add('compare', { s: 'pre', i: r + 1, j: l, line: 4, say: `pre[${r + 1}] − pre[${l}] = ${pre[r + 1]} − ${pre[l]} = ${pre[r + 1] - pre[l]}. Two reads, no loop.`, vars: { l, r, answer: pre[r + 1] - pre[l] } })
  }
  query(2, 5)
  add('window', { s: 'a', lo: null })
  query(0, 3)
  add('window', { s: 'a', lo: null })
  add('say', { say: 'One pass to build, then every range sum costs O(1). On a grid, the same table with four corners gives any rectangle sum.' })
  return {
    title: 'Prefix sums · range queries',
    complexity: 'O(n) build · O(1) per query',
    structures: {
      a: { type: 'array', values: a, caption: 'input' },
      pre: { type: 'array', values: [0, ...Array(a.length).fill(null)], caption: 'pre[i] = sum of the first i values' },
    },
    code: ['pre = [0] * (n + 1)', 'for i in range(n):', '  pre[i + 1] = pre[i] + a[i]', 'def range_sum(l, r):  # a[l..r]', '  return pre[r + 1] - pre[l]'],
    steps,
  }
}

/** Bitmask DP: the shortest path from city 0 that visits all four cities, one mask row at a time. */
export function bitmaskTsp(): AlgoJson {
  const n = 4
  const d = [[0, 2, 9, 10], [2, 0, 6, 4], [9, 6, 0, 8], [10, 4, 8, 0]]
  const masks = [1, 3, 5, 7, 9, 11, 13, 15]
  const row = (m: number) => masks.indexOf(m)
  const INF = Infinity
  const dp = masks.map(() => Array<number>(n).fill(INF))
  const show = (v: number) => (v === INF ? 'inf' : v)
  const { steps, add, quiet } = recorder()
  dp[0][0] = 0
  add('cell', { s: 'dp', r: 0, c: 0, v: 0, line: 0, say: 'dp[mask][k] = the cheapest walk that visits exactly the cities in mask and stops at k. Start: only city 0 visited, cost 0.', vars: { mask: bin(1, n), k: 0 } })
  let shown = 1
  for (const mask of masks.slice(1)) {
    // the mask bits in the bits row: index 0 is city 3
    for (let b = 0; b < n; b++) {
      if (((shown >> b) & 1) !== ((mask >> b) & 1)) quiet('set', { s: 'm', i: n - 1 - b, v: (mask >> b) & 1 })
    }
    shown = mask
    for (let k = 1; k < n; k++) {
      if (!((mask >> k) & 1)) continue
      const prev = mask ^ (1 << k)
      const options: { j: number; total: number }[] = []
      for (let j = 0; j < n; j++) if (((prev >> j) & 1) && dp[row(prev)][j] < INF) options.push({ j, total: dp[row(prev)][j] + d[j][k] })
      const best = Math.min(...options.map(o => o.total))
      dp[row(mask)][k] = best
      add('cellHl', {
        s: 'dp', cells: options.map(o => [row(prev), o.j]), state: 'compare', line: 3,
        say: `Visit ${bin(mask, n)}, stop at city ${k}: the walk before it was ${bin(prev, n)}. Look at that row.`,
        vars: { mask: bin(mask, n), k, prev: bin(prev, n) },
      })
      add('cell', {
        s: 'dp', r: row(mask), c: k, v: best, line: 4,
        say: `dp[${bin(mask, n)}][${k}] = min(${options.map(o => `${dp[row(prev)][o.j]} + ${d[o.j][k]}`).join(', ')}) = ${best}.`,
        vars: { mask: bin(mask, n), k, best },
      })
    }
  }
  const last = masks.length - 1
  const finish = [1, 2, 3].map(k => dp[last][k])
  const answer = Math.min(...finish)
  add('cellHl', { s: 'dp', cells: [1, 2, 3].map(k => [last, k]), state: 'compare', line: 6, say: `Every city is visited in row ${bin(15, n)}. The answer is the cheapest stop: min(${finish.join(', ')}) = ${answer}.`, vars: { answer } })
  add('cellMark', { s: 'dp', r: last, c: finish.indexOf(answer) + 1, state: 'done', say: `The cheapest tour ends at city ${finish.indexOf(answer) + 1}. 2^n masks times n cities, each looking at n options: O(2ⁿ · n²) instead of n! orders.` })
  return {
    title: 'Bitmask DP · shortest tour of 4 cities',
    complexity: 'O(2ⁿ · n²)',
    structures: {
      d: { type: 'grid', rows: d, rowLabels: ['0', '1', '2', '3'], colLabels: ['0', '1', '2', '3'], caption: 'distance between cities' },
      dp: { type: 'grid', rows: dp.map(r => r.map(show)), rowLabels: masks.map(m => bin(m, n)), colLabels: ['0', '1', '2', '3'], caption: 'rows = visited mask · cols = stop' },
      m: { type: 'bits', values: [0, 0, 0, 1], caption: 'mask being filled' },
    },
    code: [
      'dp[0001][0] = 0',
      'for m in masks with city 0:',
      '  for k in m, k != 0:',
      '    p = m without k',
      '    dp[m][k] = min(dp[p][j]',
      '                   + d[j][k])',
      'answer = min(dp[ALL][k])',
    ],
    steps,
  }
}

/** Trie: insert four words, then look up a word, a prefix and a miss. */
export function trie(): AlgoJson {
  const nodes: Record<string, { label: string; children: string[] }> = {
    n0: { label: '·', children: ['n1', 'n5'] },
    n1: { label: 'c', children: ['n2'] },
    n2: { label: 'a', children: ['n3', 'n4'] },
    n3: { label: 'r', children: [] },
    n4: { label: 't', children: [] },
    n5: { label: 'd', children: ['n6'] },
    n6: { label: 'o', children: ['n7'] },
    n7: { label: 'g', children: [] },
  }
  const edges = Object.entries(nodes).flatMap(([p, nd]) => nd.children.map(c => [p, c]))
  const paths: Record<string, string[]> = { car: ['n1', 'n2', 'n3'], cat: ['n1', 'n2', 'n4'], do: ['n5', 'n6'], dog: ['n5', 'n6', 'n7'] }
  const words = ['car', 'cat', 'do', 'dog']
  const made = new Set<string>(['n0'])
  const ends = new Set<string>()
  const { steps, add, quiet } = recorder()
  add('say', { line: 0, say: 'The root is an empty prefix. Each letter is one step down; grey nodes do not exist yet.' })
  words.forEach((w, wi) => {
    quiet('pointer', { name: 'w', s: 'w', i: wi, line: 0 })
    add('visit', { g: 't', n: 'n0', state: 'visited', line: 1, say: `Insert "${w}": start at the root.`, vars: { word: w } })
    let parent = 'n0'
    const fresh: string[] = []
    ;[...w].forEach((ch, ci) => {
      const id = paths[w][ci]
      const existed = made.has(id)
      made.add(id)
      if (!existed) fresh.push(id)
      add('visit', {
        g: 't', n: id, state: existed ? (ends.has(id) ? 'done' : 'visited') : 'frontier', line: 3,
        say: existed ? `"${ch}" already hangs under ${nodes[parent].label}: follow it.` : `No "${ch}" under ${nodes[parent].label} yet: create the node.`,
        vars: { word: w, letter: ch },
      })
      parent = id
    })
    ends.add(parent)
    quiet('visit', { g: 't', n: fresh, state: 'visited' })
    add('visit', { g: 't', n: parent, state: 'done', line: 4, say: `Mark "${nodes[parent].label}" as the end of "${w}".`, vars: { word: w } })
    add('mark', { s: 'w', i: wi, state: 'done' })
  })
  add('pointer', { name: 'w', s: 'w', i: null })
  const walk = (w: string, label: string, hit: string) => {
    add('say', { line: 5, say: `Look up "${w}": ${label}`, vars: { word: w } })
    let parent = 'n0'
    let ok = true
    ;[...w].forEach(ch => {
      if (!ok) return
      const real = nodes[parent].children.find(c => nodes[c].label === ch)
      if (!real) {
        ok = false
        add('visit', { g: 't', n: parent, state: 'bad', line: 6, say: `${nodes[parent].label === '·' ? 'The root' : `"${nodes[parent].label}"`} has no child "${ch}", so "${w}" is not in the trie.`, vars: { word: w, letter: ch } })
        return
      }
      add('visit', { g: 't', n: real, state: 'path', line: 6, say: `Follow "${ch}".`, vars: { word: w, letter: ch } })
      parent = real
    })
    if (ok) add('say', { line: 7, say: hit.replace('%e', ends.has(parent) ? 'yes' : 'no') })
    // put every node back to its resting colour
    quiet('visit', { g: 't', n: [...made].filter(id => !ends.has(id)), state: 'visited' })
    quiet('visit', { g: 't', n: [...ends], state: 'done' })
  }
  walk('cat', 'follow each letter.', 'The walk ends on a node marked as a word end, so "cat" is in the trie.')
  walk('ca', 'follow each letter.', 'The walk survives, but the node is not a word end: "ca" is only a prefix. That is what makes tries good at autocomplete.')
  walk('cow', 'follow each letter.', '')
  add('say', { say: 'Cost depends on the word length L, never on how many words are stored. Every word that shares a prefix shares the nodes.' })
  return {
    title: 'Trie · insert and look up',
    complexity: 'O(L) per word',
    structures: {
      t: { type: 'tree', root: 'n0', nodes, edges, height: 190, caption: 'blue exists · orange new · green end' },
      w: { type: 'array', values: words, caption: 'words to insert' },
    },
    code: ['def insert(word):', '  node = root', '  for ch in word:', '    node = node.kid[ch] or new', '  node.end = True', 'def search(word):  # same walk', '  for ch in word: node = node[ch]', '  return node.end'],
    steps,
  }
}

/** Segment tree: a range sum from nodes that sit fully inside, then a point update on one path. */
export function segTree(): AlgoJson {
  const a = [5, 3, 7, 2, 6, 4, 1, 8]
  const size = a.length
  const sum: number[] = Array(2 * size).fill(0)
  a.forEach((x, i) => { sum[size + i] = x })
  for (let k = size - 1; k >= 1; k--) sum[k] = sum[2 * k] + sum[2 * k + 1]
  const range = (k: number): [number, number] => {
    let lo = k
    let hi = k
    while (lo < size) { lo = 2 * lo; hi = 2 * hi + 1 }
    return [lo - size, hi - size]
  }
  const nodes: Record<string, { label: string; children: string[] }> = {}
  for (let k = 1; k < 2 * size; k++) nodes[`n${k}`] = { label: String(sum[k]), children: k < size ? [`n${2 * k}`, `n${2 * k + 1}`] : [] }
  const edges = Object.entries(nodes).flatMap(([p, nd]) => nd.children.map(c => [p, c]))
  const ql = 2
  const qr = 6
  const { steps, add, quiet } = recorder()
  let total = 0
  add('window', { s: 'a', lo: ql, hi: qr, line: 0, say: `Query: the sum of a[${ql}..${qr}]. Each node stores the sum of its slice of the array.`, vars: { ql, qr } })
  const query = (k: number) => {
    const [lo, hi] = range(k)
    if (qr < lo || hi < ql) {
      add('visit', { g: 't', n: `n${k}`, state: 'bad', line: 1, say: `[${lo}..${hi}] is outside the query: it adds 0.`, vars: { node: k, lo, hi, total } })
      return
    }
    if (ql <= lo && hi <= qr) {
      total += sum[k]
      quiet('mark', { s: 'a', i: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), state: 'done' })
      add('visit', { g: 't', n: `n${k}`, state: 'done', line: 2, say: `[${lo}..${hi}] sits inside the query: take its stored sum, ${sum[k]}. Total ${total}.`, vars: { node: k, lo, hi, total } })
      return
    }
    add('visit', { g: 't', n: `n${k}`, state: 'visited', line: 3, say: `[${lo}..${hi}] overlaps the query only partly: ask both children.`, vars: { node: k, lo, hi, total } })
    query(2 * k)
    query(2 * k + 1)
  }
  query(1)
  add('say', { line: 4, say: `${total} = ${a.slice(ql, qr + 1).join(' + ')}. Nine nodes were touched instead of ${qr - ql + 1} array reads, and the gap grows with n.`, vars: { total } })
  add('window', { s: 'a', lo: null })
  // point update: a[3] 2 -> 5 adds 3 to every ancestor
  const idx = 3
  const delta = 3
  add('set', { s: 'a', i: idx, v: a[idx] + delta, line: 5, say: `Update a[${idx}] from ${a[idx]} to ${a[idx] + delta}. Only the leaf and its ancestors change.`, vars: { i: idx, delta } })
  for (let k = size + idx; k >= 1; k = Math.floor(k / 2)) {
    sum[k] += delta
    add('label', { g: 't', n: `n${k}`, text: sum[k], line: 5, say: k === 1 ? `The root's sum becomes ${sum[k]}. One leaf-to-root path: log n nodes.` : `This node's sum grows by ${delta}, now ${sum[k]} (the tag under it).`, vars: { node: k } })
  }
  return {
    title: 'Segment tree · range sum',
    complexity: 'O(log n) per query',
    structures: {
      a: { type: 'array', values: a, caption: 'input' },
      t: { type: 'tree', root: 'n1', nodes, edges, height: 190, caption: 'sum of slice · tag = new sum' },
    },
    code: ['def query(node, lo, hi):', '  if outside: return 0', '  if inside: return tree[node]', '  return query(L) + query(R)', 'answer = query(1, 0, n - 1)', 'update(i, d): add d up the path'],
    steps,
  }
}

/** KMP: build the failure array for "aabaa", then search "aabaabaaa" without ever moving the text pointer back. */
export function kmp(): AlgoJson {
  const P = [...'aabaa']
  const T = [...'aabaabaaa']
  const lps: number[] = Array(P.length).fill(0)
  const { steps, add, quiet } = recorder()
  add('say', { line: 0, say: 'lps[i] = the longest proper prefix of the pattern that is also a suffix of p[0..i]. It says how far to fall back after a mismatch.' })
  let j = 0
  for (let i = 1; i < P.length; i++) {
    quiet('pointer', { name: 'i', s: 'p', i })
    while (j > 0 && P[i] !== P[j]) {
      add('pointer', { name: 'j', s: 'p', i: j, line: 2, say: `p[${i}] = ${P[i]} does not match p[${j}] = ${P[j]}: fall back to j = lps[${j - 1}] = ${lps[j - 1]}.`, vars: { i, j: lps[j - 1] } })
      j = lps[j - 1]
    }
    if (P[i] === P[j]) {
      j++
      add('pointer', { name: 'j', s: 'p', i: j - 1, line: 3, say: `p[${i}] = ${P[i]} matches p[${j - 1}]: the border grows to ${j}.`, vars: { i, j } })
    } else {
      add('pointer', { name: 'j', s: 'p', i: 0, line: 1, say: `p[${i}] = ${P[i]} matches nothing at the front: border 0.`, vars: { i, j } })
    }
    lps[i] = j
    add('set', { s: 'lps', i, v: j, line: 4, say: `lps[${i}] = ${j}.`, vars: { i, j } })
  }
  add('pointer', { name: 'i', s: 'p', i: null })
  add('pointer', { name: 'j', s: 'p', i: null })
  add('say', { line: 5, say: 'Now search. The text pointer i only moves forward; the pattern pointer j falls back along lps.' })
  j = 0
  const hits: number[] = []
  for (let i = 0; i < T.length; i++) {
    quiet('pointer', { name: 'i', s: 't', i, line: 5 })
    while (j > 0 && T[i] !== P[j]) {
      add('pointer', { name: 'j', s: 'p', i: lps[j - 1], line: 7, say: `t[${i}] = ${T[i]} does not match p[${j}] = ${P[j]}: j falls back to lps[${j - 1}] = ${lps[j - 1]}. The text pointer stays.`, vars: { i, j: lps[j - 1] } })
      j = lps[j - 1]
    }
    if (T[i] === P[j]) {
      j++
      add('pointer', { name: 'j', s: 'p', i: j - 1, line: 8, say: `t[${i}] = ${T[i]} matches p[${j - 1}].`, vars: { i, j } })
    }
    if (j === P.length) {
      const start = i - P.length + 1
      hits.push(start)
      add('window', { s: 't', lo: start, hi: i, line: 9, say: `j reached the end: the pattern occurs at ${start}. Fall back to lps[${j - 1}] = ${lps[j - 1]} and keep going; occurrences may overlap.`, vars: { i, j: lps[j - 1], found: hits.join(', ') } })
      j = lps[j - 1]
    }
  }
  add('say', { say: `Occurrences at ${hits.join(' and ')}. i never moved back, so the search is O(n + m). A rolling hash (the hash side of this row) finds the same matches by comparing numbers instead.` })
  return {
    title: 'KMP · failure array and search',
    complexity: 'O(n + m)',
    structures: {
      t: { type: 'array', values: T, caption: 'text' },
      p: { type: 'array', values: P, caption: 'pattern' },
      lps: { type: 'array', values: [0, ...Array(P.length - 1).fill(null)], caption: 'failure array' },
    },
    code: [
      'for i in 1..m-1:   # build lps',
      '  while j and p[i] != p[j]:',
      '    j = lps[j-1]',
      '  if p[i] == p[j]: j += 1',
      '  lps[i] = j',
      'for i in range(n):  # search',
      '  while j and t[i] != p[j]:',
      '    j = lps[j-1]',
      '  if t[i] == p[j]: j += 1',
      '  if j == m: report; j = lps[j-1]',
    ],
    steps,
  }
}

/** Tarjan's bridge finding: tin / low on a seven-node graph with two bridges. */
export function bridges(): AlgoJson {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const pos: Record<string, { x: number; y: number }> = {
    G: { x: 0.04, y: 0.5 }, A: { x: 0.24, y: 0.5 }, B: { x: 0.4, y: 0.12 }, C: { x: 0.42, y: 0.88 },
    D: { x: 0.66, y: 0.88 }, E: { x: 0.94, y: 0.62 }, F: { x: 0.8, y: 0.1 },
  }
  const edgeList: [string, string][] = [['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'D'], ['A', 'G']]
  const adj: Record<string, string[]> = Object.fromEntries(names.map(v => [v, [] as string[]]))
  for (const [u, v] of edgeList) { adj[u].push(v); adj[v].push(u) }
  const tin: Record<string, number> = {}
  const low: Record<string, number> = {}
  const found: string[] = []
  let timer = 0
  const { steps, add, quiet } = recorder()
  const tag = (v: string) => `${tin[v]}/${low[v]}`
  add('say', { line: 0, say: 'Every node shows tin / low under it. tin = when DFS reached the node; low = the earliest tin its subtree can reach using at most one back edge.' })
  const dfs = (u: string, parent: string | null) => {
    tin[u] = low[u] = timer++
    quiet('push', { s: 'st', v: u })
    quiet('label', { g: 'g', n: u, text: tag(u) })
    if (parent) quiet('edge', { g: 'g', u: parent, v: u, state: 'path' })
    add('visit', { g: 'g', n: u, state: 'current', line: 1, say: `Enter ${u}: tin ${tin[u]}, low ${low[u]}.`, vars: { u, tin: tin[u], low: low[u] } })
    for (const v of adj[u]) {
      if (v === parent) continue
      if (v in tin) {
        if (tin[v] < tin[u]) {
          // a back edge to an ancestor that is still open
          const before = low[u]
          low[u] = Math.min(low[u], tin[v])
          quiet('label', { g: 'g', n: u, text: tag(u) })
          add('edge', { g: 'g', u, v, state: 'compare', line: 4, say: `${u} meets ${v}, which is still open: a back edge. low[${u}] = min(${before}, tin[${v}] = ${tin[v]}) = ${low[u]}.`, vars: { u, v, low: low[u] } })
        }
        continue
      }
      dfs(v, u)
      const before = low[u]
      low[u] = Math.min(low[u], low[v])
      quiet('label', { g: 'g', n: u, text: tag(u) })
      add('visit', { g: 'g', n: u, state: 'current', line: 7, say: low[u] < before ? `${v} is finished and low[${v}] = ${low[v]} flows up: low[${u}] = ${low[u]}.` : `${v} is finished; low[${v}] = ${low[v]} does not lower low[${u}] = ${low[u]}.`, vars: { u, v, low: low[u] } })
      if (low[v] > tin[u]) {
        found.push(`${u}–${v}`)
        add('edge', { g: 'g', u, v, state: 'bad', line: 8, say: `low[${v}] = ${low[v]} is above tin[${u}] = ${tin[u]}: nothing under ${v} loops back to ${u} or higher. ${u}–${v} is a bridge.`, vars: { u, v } })
      }
    }
    quiet('pop', { s: 'st' })
    quiet('visit', { g: 'g', n: u, state: 'done' })
  }
  dfs('A', null)
  add('say', { say: `Bridges: ${found.join(' and ')}. Remove either and the graph splits; every edge in the two triangles sits on a cycle, so none of them is a bridge. Tarjan's SCC pass uses the same tin / low and the same stack, popping down to u when low[u] = tin[u].` })
  return {
    title: 'Tarjan · bridges by low-link',
    complexity: 'O(V + E)',
    structures: {
      g: {
        type: 'graph', directed: false,
        nodes: Object.fromEntries(names.map(v => [v, pos[v]])),
        edges: edgeList.map(([u, v]) => [u, v]),
        height: 200, caption: 'tag = tin / low · red = bridge',
      },
      st: { type: 'stack', values: [], min: 5, caption: 'DFS path' },
    },
    code: ['def dfs(u, parent):', '  tin[u] = low[u] = timer++', '  for v in adj[u]:', '    if v seen:        # back edge', '      low[u] = min(low[u], tin[v])', '    else:', '      dfs(v, u)', '      low[u] = min(low[u], low[v])', '      if low[v] > tin[u]: bridge'],
    steps,
  }
}

/** Bipartite matching by augmenting paths (Kuhn): the second left node pushes the first one aside. */
export function matching(): AlgoJson {
  const right = ['R1', 'R2', 'R3']
  const { steps, add, quiet } = recorder()
  const give = (r: string, l: string) => quiet('set', { s: 'match', i: right.indexOf(r), v: l })
  add('say', { line: 0, say: 'Each left node wants one right partner. Try its neighbours in order; if one is taken, ask its owner to move somewhere else.' })
  // L1: R1 is free
  add('visit', { g: 'g', n: 'L1', state: 'current', line: 1, say: 'L1 looks for a partner. First neighbour: R1.', vars: { u: 'L1' } })
  add('edge', { g: 'g', u: 'L1', v: 'R1', state: 'compare', line: 3, say: 'R1 is free.', vars: { u: 'L1', v: 'R1' } })
  give('R1', 'L1')
  quiet('visit', { g: 'g', n: ['L1', 'R1'], state: 'done' })
  add('edge', { g: 'g', u: 'L1', v: 'R1', state: 'done', line: 5, say: 'Match L1–R1.', vars: { u: 'L1', v: 'R1' } })
  // L2: R1 is taken by L1, who can move to R2
  add('visit', { g: 'g', n: 'L2', state: 'current', line: 1, say: 'L2 looks for a partner. Its only neighbour is R1.', vars: { u: 'L2' } })
  add('edge', { g: 'g', u: 'L2', v: 'R1', state: 'compare', line: 3, say: 'R1 already belongs to L1. Ask L1: is there another place for you?', vars: { u: 'L2', v: 'R1', owner: 'L1' } })
  add('edge', { g: 'g', u: 'L1', v: 'R2', state: 'path', line: 5, say: 'L1 can use R2, and R2 is free. The path L2 → R1 → L1 → R2 ends on a free node, so it augments.', vars: { u: 'L1', v: 'R2' } })
  give('R2', 'L1')
  give('R1', 'L2')
  quiet('edge', { g: 'g', u: 'L1', v: 'R1', state: null })
  quiet('edge', { g: 'g', u: 'L1', v: 'R2', state: 'done' })
  quiet('visit', { g: 'g', n: ['L2', 'R2'], state: 'done' })
  add('edge', { g: 'g', u: 'L2', v: 'R1', state: 'done', line: 5, say: 'Flip the path: L1 gives up R1 and takes R2, and L2 takes R1. One more match.', vars: { 'L1': 'R2', 'L2': 'R1' } })
  // L3: R2 is taken by L1; L1's other option R1 belongs to L2, who has nowhere else
  add('visit', { g: 'g', n: 'L3', state: 'current', line: 1, say: 'L3 looks for a partner. First neighbour: R2.', vars: { u: 'L3' } })
  add('edge', { g: 'g', u: 'L3', v: 'R2', state: 'compare', line: 3, say: 'R2 belongs to L1. Ask L1 to move.', vars: { u: 'L3', v: 'R2', owner: 'L1' } })
  add('edge', { g: 'g', u: 'L1', v: 'R1', state: 'compare', line: 3, say: 'L1 could go back to R1, but R1 belongs to L2. Ask L2.', vars: { u: 'L1', v: 'R1', owner: 'L2' } })
  add('edge', { g: 'g', u: 'L1', v: 'R1', state: 'bad', line: 4, say: 'L2 has only R1, and R1 is already on this path. Nobody can move, so this attempt fails.', vars: { u: 'L2' } })
  quiet('edge', { g: 'g', u: 'L1', v: 'R1', state: null })
  quiet('edge', { g: 'g', u: 'L3', v: 'R2', state: null })
  add('edge', { g: 'g', u: 'L3', v: 'R3', state: 'compare', line: 3, say: 'Back to L3. Next neighbour: R3 is free.', vars: { u: 'L3', v: 'R3' } })
  give('R3', 'L3')
  quiet('visit', { g: 'g', n: ['L3', 'R3'], state: 'done' })
  add('edge', { g: 'g', u: 'L3', v: 'R3', state: 'done', line: 5, say: 'Match L3–R3.', vars: { u: 'L3', v: 'R3' } })
  add('say', { say: 'Perfect matching: L1–R2, L2–R1, L3–R3. Each search either flips an augmenting path (the matching grows by one) or fails. Max flow is the same idea with capacities on the edges.' })
  return {
    title: 'Bipartite matching · augmenting paths',
    complexity: 'O(V · E)',
    structures: {
      g: {
        type: 'graph', directed: false,
        // staggered columns, so no two edges share a vertical run
        nodes: { L1: { x: 0.06, y: 0.08 }, L2: { x: 0.14, y: 0.5 }, L3: { x: 0.22, y: 0.92 }, R1: { x: 0.94, y: 0.22 }, R2: { x: 0.8, y: 0.58 }, R3: { x: 0.72, y: 0.78 } },
        // drawn in this order, so the edges that end up matched are painted last (over the shared stubs)
        edges: [['L1', 'R1'], ['L3', 'R2'], ['L1', 'R2'], ['L2', 'R1'], ['L3', 'R3']],
        height: 190, caption: 'green matched · purple tried',
      },
      match: { type: 'array', values: [null, null, null], caption: 'match[R1..R3] = left partner' },
    },
    code: ['for u in left: try(u)', 'def try(u):', '  for v in adj[u] not visited:', '    visited.add(v)', '    if v is free or try(owner[v]):', '      owner[v] = u; return True'],
    steps,
  }
}

/** Pascal's triangle: each inner cell is the sum of the two above it. */
export function pascal(): AlgoJson {
  const rows = 6
  const t = Array.from({ length: rows }, () => Array<number | null>(rows).fill(null))
  const { steps, add, quiet } = recorder()
  add('say', { line: 0, say: 'C(n, k) = ways to choose k of n. The edges are 1 (choose none, choose all); every inner cell adds the two above it.' })
  for (let n = 0; n < rows; n++) {
    if (n === 0) {
      t[0][0] = 1
      add('cell', { s: 't', r: 0, c: 0, v: 1, line: 1, say: 'C(0, 0) = 1: one way to choose nothing from nothing.' })
      continue
    }
    t[n][0] = 1
    quiet('cell', { s: 't', r: n, c: 0, v: 1, line: 1 })
    t[n][n] = 1
    quiet('cell', { s: 't', r: n, c: n, v: 1, line: 1 })
    for (let k = 1; k < n; k++) {
      const up = t[n - 1][k - 1] as number
      const left = t[n - 1][k] as number
      t[n][k] = up + left
      add('cellHl', { s: 't', cells: [[n - 1, k - 1], [n - 1, k]], state: 'compare', line: 2, say: `C(${n}, ${k}): look at C(${n - 1}, ${k - 1}) = ${up} and C(${n - 1}, ${k}) = ${left}.`, vars: { n, k } })
      add('cell', { s: 't', r: n, c: k, v: up + left, line: 2, say: `C(${n}, ${k}) = ${up} + ${left} = ${up + left}. Either item ${n} is in the group (${up}) or it is not (${left}).`, vars: { n, k, value: up + left } })
    }
  }
  add('cellMark', { s: 't', r: 5, c: 2, state: 'done', say: `C(5, 2) = ${t[5][2]}: ten ways to pick two of five. The same table counts grid paths: the ways to reach a cell are the ways to reach the cell above plus the cell to its left.` })
  return {
    title: 'Pascal’s triangle · binomials',
    complexity: 'O(n²)',
    structures: {
      t: { type: 'grid', rows: t, rowLabels: ['0', '1', '2', '3', '4', '5'], colLabels: ['0', '1', '2', '3', '4', '5'], caption: 'rows = n · cols = k' },
    },
    code: ['C[n][0] = C[n][n] = 1', 'for k in 1..n-1:', '  C[n][k] = C[n-1][k-1]', '          + C[n-1][k]'],
    steps,
  }
}

/** Simulation: one generation of Game of Life. Decide every cell from the old grid, queue the changes, then apply them together. */
export function life(): AlgoJson {
  const size = 5
  const g: (number | null)[][] = Array.from({ length: size }, () => Array<number | null>(size).fill(null))
  for (const c of [1, 2, 3]) g[2][c] = 1
  const alive = (r: number, c: number) => (g[r]?.[c] === 1 ? 1 : 0)
  const around = (r: number, c: number): [number, number][] => {
    const out: [number, number][] = []
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && r + dr >= 0 && r + dr < size && c + dc >= 0 && c + dc < size) out.push([r + dr, c + dc])
    }
    return out
  }
  const { steps, add } = recorder()
  const queue: { r: number; c: number; v: number | null }[] = []
  add('say', { line: 0, say: 'Rule: a live cell with 2 or 3 live neighbours stays; a dead cell with exactly 3 comes alive; everything else is dead next turn.' })
  const check = (r: number, c: number, why: string) => {
    const nb = around(r, c)
    const n = nb.reduce((s, [rr, cc]) => s + alive(rr, cc), 0)
    const now = alive(r, c)
    const next = now ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0
    add('cellHl', { s: 'g', cells: [[r, c], ...nb.filter(([rr, cc]) => alive(rr, cc)) as [number, number][]], state: 'compare', line: 1, say: `Cell (${r}, ${c}) is ${now ? 'alive' : 'dead'} and has ${n} live neighbour${n === 1 ? '' : 's'}. ${why}`, vars: { r, c, neighbours: n } })
    if (next !== now) {
      queue.push({ r, c, v: next ? 1 : null })
      add('push', { s: 'q', v: `(${r},${c})→${next}`, line: 2, say: `It changes: queue (${r}, ${c}) → ${next ? 'alive' : 'dead'}. Do not write it into the grid yet.`, vars: { r, c } })
    }
  }
  check(2, 1, 'Fewer than 2: it dies.')
  check(2, 2, 'Two: it stays alive.')
  check(2, 3, 'Fewer than 2: it dies.')
  check(1, 2, 'Exactly 3: it comes alive.')
  check(3, 2, 'Exactly 3: it comes alive.')
  add('say', { line: 3, say: 'No other cell is alive or has exactly 3 live neighbours, so they stay as they are. Every decision used the old grid. If the dying cells were erased as we went, later cells would count the wrong neighbours.' })
  for (const ch of queue) {
    add('shift', { s: 'q', group: 'next' })
    add('cell', { s: 'g', r: ch.r, c: ch.c, v: ch.v, line: 4, say: `Apply (${ch.r}, ${ch.c}) → ${ch.v ? 'alive' : 'dead'}.`, vars: { r: ch.r, c: ch.c } })
  }
  add('say', { say: 'The row of three became a column of three. The next turn turns it back: the blinker oscillates. Most simulation problems are this loop: read the old state, write a new one, repeat.' })
  return {
    title: 'Simulation · Game of Life, one generation',
    complexity: 'O(R · C) per generation',
    structures: {
      g: { type: 'grid', rows: g, rowLabels: ['0', '1', '2', '3', '4'], colLabels: ['0', '1', '2', '3', '4'], caption: '1 = alive' },
      q: { type: 'queue', values: [], caption: 'changes · (r,c)→1 alive, 0 dead' },
    },
    code: ['for each cell (r, c):', '  n = live neighbours (old grid)', '  if it changes: queue it', '# only now:', 'for change in queue: apply it'],
    steps,
  }
}

/** The nine new pieces by walkthrough key. No Atlas-page string is needed: they are built here, like PIECE_OVERRIDES. */
export const NEW_PIECES: Readonly<Record<string, () => AlgoJson>> = {
  prefixSum, bitmaskTsp, trie, segTree, kmp, bridges, matching, pascal, life,
}
