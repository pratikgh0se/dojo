// The Algorithm Atlas as static data (labs contract §2): 16 atoms, 36 patterns in the prototype's order
// (lab/Algorithm Atlas.dc.html section 01 `pat(...)` calls: same main and side atoms), each row's
// walkthroughs and coverage line (§2.2, D-2), the 45-entry walkthrough library (§2.1, D-1), the DSA topic
// warm-ups (§2.3, D-5) and the Two-up partners (§4.5, D-9).

export const ATOMS = [
  'ARRAY', 'GRID', 'GRAPH', 'TREE', 'LIST', 'STACK', 'QUEUE', 'HASH',
  'FRAME', 'INTVL', 'BITS', 'FOREST', 'PLANE', 'NUMLN', 'TAPE', 'SETS',
] as const
export type Atom = (typeof ATOMS)[number]

/** UAT J9: what each atom column draws, in plain words (column tooltips and the key under the map). */
export const ATOM_NAMES: Record<Atom, string> = {
  ARRAY: 'array', GRID: 'grid', GRAPH: 'graph', TREE: 'tree', LIST: 'linked list', STACK: 'stack', QUEUE: 'queue',
  HASH: 'hash map', FRAME: 'call frames', INTVL: 'intervals', BITS: 'bits', FOREST: 'union-find forest',
  PLANE: '2-D plane', NUMLN: 'number line', TAPE: 'one-pass stream', SETS: 'sets / buckets',
}

/** Atlas 08C legend: live = worked example on the Atlas, library = Algorithm Lab entry, recipe = atoms exist, gap = engine work first. */
export type CoverageStatus = 'live' | 'library' | 'recipe' | 'gap'

export interface Pattern {
  /** kebab slug: `atlas-row-<slug>` and `?pattern=<slug>` */
  slug: string
  /** row button text (CSS draws it in Silkscreen uppercase) */
  label: string
  main: Atom[]
  side: Atom[]
  /** walkthrough keys in the order the detail panel lists them */
  walkthroughs: string[]
  status: CoverageStatus
  /** the part of the coverage line after `<status> · ` */
  how: string
}

const P = (slug: string, label: string, main: Atom[], side: Atom[], walkthroughs: string[], status: CoverageStatus, how: string): Pattern =>
  ({ slug, label, main, side, walkthroughs, status, how })

export const PATTERNS: readonly Pattern[] = [
  P('two-pointers', 'Two pointers', ['ARRAY'], ['LIST'], ['twoSum'], 'library', 'pointers l / r walk inward'),
  P('sliding-window', 'Sliding window', ['ARRAY'], ['HASH', 'TAPE'], ['slidingWindow'], 'library', 'window band + running sum in vars'),
  P('prefix-sum', 'Prefix sum', ['ARRAY'], ['GRID'], [], 'recipe', 'second array fills from the first; compare pair = range query'),
  P('binary-search', 'Binary search', ['ARRAY', 'NUMLN'], [], ['binarySearch', 'bsAnswer'], 'library', 'lo / hi / mid pointers'),
  P('sorting', 'Sorting', ['ARRAY'], ['FRAME', 'SETS'], ['bubbleSort', 'insertionSort', 'selectionSort', 'mergeSort', 'quickSort', 'buckets'], 'library', 'compare + swap'),
  P('greedy', 'Greedy', ['INTVL'], ['ARRAY', 'GRAPH'], ['greedy', 'mergeIntervals'], 'live', 'take, skip, never look back'),
  P('backtracking', 'Backtracking', ['TREE', 'GRID'], ['FRAME'], ['nQueens'], 'library', 'bad = conflict, path = placed'),
  P('dp-memo', 'DP · memo', ['TREE', 'ARRAY'], ['FRAME', 'HASH'], ['memo'], 'live', 'a tree you prune with a cache'),
  P('dp-tabulation', 'DP · tabulation', ['GRID', 'ARRAY'], [], ['tab', 'coinChange', 'knapsack', 'lcs', 'lis', 'kadane'], 'live', 'a table you fill in order'),
  P('dp-bitmask', 'DP · bitmask', ['BITS', 'GRID'], [], [], 'recipe', 'mask row, city column'),
  P('bfs-dfs', 'BFS / DFS', ['GRAPH', 'GRID'], ['QUEUE', 'FRAME'], ['bfs', 'dfs', 'bfsGrid', 'islands'], 'library', 'visited · frontier · current'),
  P('shortest-path', 'Shortest path', ['GRAPH'], ['ARRAY', 'QUEUE'], ['dijkstra', 'bellmanFord'], 'live', 'settle the nearest, relax its edges'),
  P('mst', 'MST', ['GRAPH'], ['FOREST'], ['kruskal'], 'live', 'sorted edges, union-find rejects cycles'),
  P('topo-sort', 'Topo sort', ['GRAPH'], ['QUEUE', 'ARRAY'], ['topoSort'], 'live', 'ready queue + order'),
  P('union-find', 'Union-find', ['FOREST'], ['ARRAY'], ['dsu'], 'live', 'a forest that flattens itself'),
  P('heap-pq', 'Heap / PQ', ['TREE', 'ARRAY'], [], ['heapPush'], 'library', 'heap as tree, array as storage'),
  P('trie', 'Trie', ['TREE'], ['HASH'], [], 'recipe', 'children = letters; done = word end'),
  P('segment-fenwick', 'Segment / Fenwick', ['TREE', 'ARRAY'], [], [], 'recipe', 'query = path of visited nodes'),
  P('monotonic-stack', 'Monotonic stack', ['ARRAY', 'STACK'], [], ['mono', 'validParens'], 'live', 'next greater element'),
  P('bit-tricks', 'Bit tricks', ['BITS'], [], ['bitCount'], 'library', 'Kernighan count'),
  P('number-theory', 'Number theory', ['NUMLN', 'ARRAY'], ['GRID'], ['sieve'], 'live', 'sieve live; GCD, modular, fast power are recipes'),
  P('geometry', 'Geometry', ['PLANE'], ['STACK'], ['hull'], 'live', 'gift wrapping on a plane'),
  P('game-theory', 'Game theory', ['TREE', 'GRID'], [], ['minimax', 'payoff', 'nim'], 'live', 'trees you prune, tables you circle'),
  P('streaming', 'Streaming', ['TAPE'], ['HASH', 'SETS'], ['majority', 'reservoir'], 'live', 'one pass, tiny memory'),
  P('string-match', 'String match', ['ARRAY'], ['HASH'], [], 'recipe', 'pattern array + failure array; pointers i / j'),
  P('divide-conquer', 'Divide & conquer', ['ARRAY'], ['FRAME'], ['mergeSort', 'quickSort'], 'library', 'merge sort is the model'),
  P('all-pairs-paths', 'All-pairs paths', ['GRID'], ['GRAPH'], ['floyd'], 'live', 'k outermost'),
  P('cycle-fast-slow', 'Cycle · fast/slow', ['LIST'], ['GRAPH'], ['cycle'], 'live', 'tortoise and hare'),
  P('scc-bridges', 'SCC · bridges', ['GRAPH'], ['STACK'], [], 'recipe', 'labels = low-link; stack side panel'),
  P('flow-matching', 'Flow · matching', ['GRAPH'], [], [], 'gap', 'edge labels show one number; needs cap/flow pairs'),
  P('lru-design', 'LRU · design', ['HASH', 'LIST'], [], ['hashInsert', 'reverseList'], 'recipe', 'move-to-front = link ops'),
  P('combinatorics', 'Combinatorics', ['GRID', 'TREE'], [], [], 'recipe', 'triangle fill; cellHl the two parents'),
  P('probability', 'Probability', ['ARRAY', 'NUMLN'], [], ['reservoir'], 'recipe', 'weights as bars; numberline for CDF'),
  P('sweep-line', 'Sweep line', ['PLANE'], ['INTVL'], ['mergeIntervals'], 'recipe', 'line op x = c moves; window = strip'),
  P('simulation', 'Simulation', ['GRID'], ['QUEUE'], [], 'recipe', 'one cell op per generation change'),
  P('sieve-primes', 'Sieve · primes', ['NUMLN'], [], ['sieve'], 'live', 'strike multiples from p²'),
]

/** Own-input form shape per runnable entry (§2.1 "Input kind", §4.6). */
export type InputKind =
  | 'ints' | 'sortedTarget' | 'intsK' | 'graphStart' | 'graph' | 'dag' | 'grid' | 'items'
  | 'strings' | 'coins' | 'board' | 'intervals' | 'number' | 'brackets' | 'keys'

export type WalkSource = 'library' | 'piece'

export interface WalkDef {
  key: string
  /** library = SRAlgo.library (runnable, own input) · piece = Atlas worked example (fixed) */
  source: WalkSource
  /** exactly what the player header shows for the default input */
  title: string
  complexity: string
  /** runnable entries only */
  input?: InputKind
}

const L = (key: string, title: string, complexity: string, input: InputKind): WalkDef => ({ key, source: 'library', title, complexity, input })
const F = (key: string, title: string, complexity: string): WalkDef => ({ key, source: 'piece', title, complexity })

/** The library (D-1): the 28 SRAlgo.library classics, then the 17 Atlas worked examples. */
export const WALKTHROUGHS: readonly WalkDef[] = [
  L('bfs', 'Breadth-first search', 'O(V + E)', 'graphStart'),
  L('dfs', 'Depth-first search', 'O(V + E)', 'graphStart'),
  L('dijkstra', "Dijkstra's shortest paths", 'O((V + E) log V)', 'graphStart'),
  L('bellmanFord', 'Bellman-Ford', 'O(V · E)', 'graphStart'),
  L('topoSort', 'Topological sort · Kahn', 'O(V + E)', 'dag'),
  L('kruskal', "Kruskal's MST · union-find", 'O(E log E)', 'graph'),
  L('bfsGrid', 'BFS on a grid · shortest path', 'O(R · C)', 'grid'),
  L('knapsack', '0/1 knapsack · DP table', 'O(n · W)', 'items'),
  L('lcs', 'Longest common subsequence', 'O(m · n)', 'strings'),
  L('coinChange', 'Coin change · 1-D DP', 'O(amount · coins)', 'coins'),
  L('lis', 'Longest increasing subsequence', 'O(n²)', 'ints'),
  L('kadane', "Kadane's algorithm", 'O(n) · O(1)', 'ints'),
  L('bstInsert', 'Binary search tree · insert', 'O(h) per insert', 'ints'),
  L('heapPush', 'Min-heap · push with sift-up', 'O(log n) per push', 'ints'),
  L('nQueens', 'N-Queens · backtracking · n = 4', 'O(n!)', 'board'),
  L('binarySearch', 'Binary search', 'O(log n) · O(1)', 'sortedTarget'),
  L('twoSum', 'Two pointers · two sum (sorted)', 'O(n) · O(1)', 'sortedTarget'),
  L('slidingWindow', 'Sliding window · max sum of k', 'O(n) · O(1)', 'intsK'),
  L('mergeIntervals', 'Merge intervals', 'O(n log n)', 'intervals'),
  L('bitCount', "Brian Kernighan's bit count", 'O(set bits)', 'number'),
  L('bubbleSort', 'Bubble sort', 'O(n²) time · O(1) space', 'ints'),
  L('insertionSort', 'Insertion sort', 'O(n²) · O(1)', 'ints'),
  L('selectionSort', 'Selection sort', 'O(n²) · O(1)', 'ints'),
  L('mergeSort', 'Merge sort', 'O(n log n) · O(n)', 'ints'),
  L('quickSort', 'Quick sort · Lomuto', 'O(n log n) avg · O(n²) worst', 'ints'),
  L('reverseList', 'Reverse a linked list', 'O(n) · O(1)', 'ints'),
  L('validParens', 'Valid parentheses · stack', 'O(n)', 'brackets'),
  L('hashInsert', 'Hash table · insert with chaining', 'O(1) avg · O(n) worst', 'keys'),
  F('memo', 'Memoization · fib(5)', 'O(n) calls · O(n) memo'),
  F('tab', 'Tabulation · fib(5)', 'O(n) · O(n) (O(1) with two variables)'),
  F('greedy', 'Greedy · interval scheduling', 'O(n log n)'),
  F('dsu', 'Union-find · rank + path compression', 'α(n) per op'),
  F('majority', 'Boyer–Moore majority vote', 'O(n) · O(1)'),
  F('reservoir', 'Reservoir sampling · k = 3', 'O(n) · O(k)'),
  F('minimax', 'Minimax · alpha-beta pruning', 'O(b^(d/2)) best case'),
  F('payoff', 'Payoff matrix · Nash equilibria', 'O(rows × cols)'),
  F('bsAnswer', 'Binary search on the answer', 'O(log range × check)'),
  F('hull', 'Convex hull · gift wrapping', 'O(n · h)'),
  F('buckets', 'Bucket sort · partition first', 'O(n + k) expected'),
  F('cycle', 'Cycle detection · fast & slow pointers', 'O(n) · O(1)'),
  F('mono', 'Monotonic stack · next greater element', 'O(n) · O(n)'),
  F('sieve', 'Sieve of Eratosthenes · N = 30', 'O(N log log N)'),
  F('islands', 'Flood fill · number of islands', 'O(R · C)'),
  F('floyd', 'Floyd–Warshall · all pairs', 'O(V³)'),
  F('nim', 'Nim · Grundy numbers by mex', 'O(N · moves)'),
]

/** DSA topic sprint → warm-up walkthroughs, default first (§2.3, D-5). */
export const TOPIC_WARMUPS: Readonly<Record<number, readonly string[]>> = {
  1: ['bfsGrid', 'islands', 'bfs', 'dfs'],
  2: ['topoSort'],
  3: ['dsu'],
  4: ['dijkstra', 'bellmanFord', 'kruskal', 'floyd'],
  5: ['bstInsert'],
  6: ['bstInsert', 'heapPush'],
  7: ['memo', 'tab', 'coinChange', 'lis'],
  8: ['lcs'],
  9: ['knapsack'],
  10: ['tab', 'bitCount'],
  11: ['heapPush'],
  12: ['nQueens', 'mono', 'bsAnswer'],
  15: ['slidingWindow', 'twoSum'],
  16: ['hashInsert', 'reverseList'],
  18: ['cycle', 'reverseList'],
  20: ['mergeIntervals', 'binarySearch', 'bitCount'],
  24: ['greedy', 'validParens', 'kadane'],
}

/** Named Two-up pairs (D-9); every other walkthrough pairs with the next one in its row. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [['memo', 'tab'], ['bfs', 'dfs'], ['dijkstra', 'bellmanFord']]
export const TWO_UP: Readonly<Record<string, string>> = Object.fromEntries(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]))

const WALK_BY_KEY = new Map(WALKTHROUGHS.map(w => [w.key, w]))
const PATTERN_BY_SLUG = new Map(PATTERNS.map(p => [p.slug, p]))

export function walkDef(key: string): WalkDef | undefined {
  return WALK_BY_KEY.get(key)
}

export function patternBySlug(slug: string): Pattern | undefined {
  return PATTERN_BY_SLUG.get(slug)
}

/** Case-insensitive label lookup (the AI `classify` job answers with an upper-case label such as `SLIDING WINDOW`). */
export function patternByLabel(label: string): Pattern | undefined {
  const l = label.trim().toLowerCase()
  return PATTERNS.find(p => p.label.toLowerCase() === l)
}

/** Every row that lists the walkthrough (D-4: one fact, many views), in map order. */
export function patternsOfWalk(key: string): string[] {
  return PATTERNS.filter(p => p.walkthroughs.includes(key)).map(p => p.slug)
}

/**
 * Walkthroughs that no §2.2 row lists but a DSA warm-up opens (§2.3 S5/S6: bstInsert). "Open in Atlas" (§6)
 * still needs a row: the closest one. The row does not list it, so watching it credits no row (D-4).
 */
export const ATLAS_ROW_FALLBACK: Readonly<Record<string, string>> = { bstInsert: 'bfs-dfs' }

/** The row "Open in Atlas" goes to: the first row listing the walkthrough, else its fallback. */
export function atlasRowOf(key: string): string | undefined {
  return patternsOfWalk(key)[0] ?? ATLAS_ROW_FALLBACK[key]
}

/** The Two-up partner (D-9): the named pair, else the next walkthrough in the row (wrapping), else none. */
export function twoUpPartner(key: string, slug?: string): string | null {
  if (TWO_UP[key]) return TWO_UP[key]
  const row = slug ? patternBySlug(slug) : undefined
  if (!row || row.walkthroughs.length < 2) return null
  const i = row.walkthroughs.indexOf(key)
  return i < 0 ? null : row.walkthroughs[(i + 1) % row.walkthroughs.length]
}

/** kebab-case of a walkthrough key, for file names (D-11): binarySearch → binary-search. */
export function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
