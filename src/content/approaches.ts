// approaches.json (TRACKING §3 "DSA: one problem, several ways"; labs contract §2.4), kept as TypeScript so
// ids, patterns and library keys are type-checked: for each of the 169 plan problems, 2–4 ways, ordered
// brute → best, exactly one starred best (the last). `pattern` is one of the 36 Atlas rows (its slug);
// `libraryKey` names the library walkthrough a chip opens (none = "No library picture for this approach yet.").
// Where no row is a close fit: exhaustive search and plain recursion → Backtracking (as §2.4 p322 does),
// hash maps and linked-list link surgery → LRU · design (its row lists hashInsert and reverseList),
// stacks → Monotonic stack (lists validParens), a plain step-by-step scan → Simulation.

export interface Approach {
  /** stable id, stored on the session as the "Which approach did you use?" answer */
  id: string
  /** ≤ 4 words */
  name: string
  complexity: string
  /** Atlas row slug (content/atlas.ts PATTERNS) */
  pattern: string
  /** walkthrough key (content/atlas.ts WALKTHROUGHS) */
  libraryKey?: string
  best: boolean
}

type Row = readonly [id: string, name: string, complexity: string, pattern: string, libraryKey?: string]

/** The last row is the best one (★). */
const ways = (...rows: Row[]): Approach[] =>
  rows.map(([id, name, complexity, pattern, libraryKey], i) => ({ id, name, complexity, pattern, ...(libraryKey ? { libraryKey } : {}), best: i === rows.length - 1 }))

const brute = (c: string): Row => ['brute', 'Brute force', c, 'backtracking']
const recursion = (c: string): Row => ['recursion', 'Brute recursion', c, 'backtracking']

export const APPROACHES: Readonly<Record<string, Approach[]>> = {
  // S1 · Graphs: BFS and DFS on grids and adjacency lists
  p200: ways(['uf', 'Union-find', 'O(m·n·α)', 'union-find', 'dsu'], ['bfs', 'BFS flood fill', 'O(m·n)', 'bfs-dfs', 'bfsGrid'], ['dfs', 'DFS flood fill', 'O(m·n)', 'bfs-dfs', 'islands']),
  p695: ways(['bfs', 'BFS per island', 'O(m·n)', 'bfs-dfs', 'bfsGrid'], ['dfs', 'DFS area count', 'O(m·n)', 'bfs-dfs', 'islands']),
  p133: ways(['bfs', 'BFS + hash map', 'O(V + E)', 'bfs-dfs', 'bfs'], ['dfs', 'DFS + hash map', 'O(V + E)', 'bfs-dfs', 'dfs']),
  p417: ways(['each', 'DFS from every cell', 'O((m·n)²)', 'bfs-dfs', 'dfs'], ['reverse', 'Reverse flow from oceans', 'O(m·n)', 'bfs-dfs', 'bfsGrid']),
  p130: ways(['uf', 'Union-find with border', 'O(m·n·α)', 'union-find', 'dsu'], ['border', 'Border DFS first', 'O(m·n)', 'bfs-dfs', 'islands']),
  p994: ways(['sim', 'Simulate minute by minute', 'O((m·n)²)', 'simulation'], ['multi', 'Multi-source BFS', 'O(m·n)', 'bfs-dfs', 'bfsGrid']),
  p286: ways(['each', 'BFS from each room', 'O((m·n)²)', 'bfs-dfs', 'bfsGrid'], ['multi', 'Multi-source BFS', 'O(m·n)', 'bfs-dfs', 'bfsGrid']),
  p1091: ways(['paths', 'DFS all paths', 'O(8^(n²))', 'backtracking'], ['bfs', 'BFS eight directions', 'O(n²)', 'bfs-dfs', 'bfsGrid']),
  p785: ways(['uf', 'Union-find neighbours', 'O(E·α)', 'union-find', 'dsu'], ['color', 'BFS two-colouring', 'O(V + E)', 'bfs-dfs', 'bfs']),
  p127: ways(['pairs', 'BFS compare all words', 'O(n²·L)', 'bfs-dfs', 'bfs'], ['buckets', 'BFS wildcard buckets', 'O(n·L²)', 'bfs-dfs', 'bfs']),

  // S2 · Topological sort
  p207: ways(['dfs', 'DFS cycle check', 'O(V+E)', 'bfs-dfs', 'dfs'], ['kahn', 'Kahn topo sort', 'O(V+E)', 'topo-sort', 'topoSort']),
  p210: ways(['dfs', 'DFS postorder', 'O(V + E)', 'bfs-dfs', 'dfs'], ['kahn', "Kahn's algorithm", 'O(V + E)', 'topo-sort', 'topoSort']),
  p269: ways(['dfs', 'Letter graph + DFS', 'O(total chars)', 'bfs-dfs', 'dfs'], ['kahn', 'Letter graph + Kahn', 'O(total chars)', 'topo-sort', 'topoSort']),
  p310: ways(['each', 'BFS from every node', 'O(n²)', 'bfs-dfs', 'bfs'], ['trim', 'Trim leaves inward', 'O(n)', 'topo-sort', 'topoSort']),
  p802: ways(['color', 'DFS three colours', 'O(V + E)', 'bfs-dfs', 'dfs'], ['kahn', 'Reverse graph + Kahn', 'O(V + E)', 'topo-sort', 'topoSort']),
  p444: ways(['dfs', 'Graph + DFS order', 'O(V + E)', 'bfs-dfs', 'dfs'], ['kahn', 'Kahn with unique queue', 'O(V + E)', 'topo-sort', 'topoSort']),
  p2115: ways(['passes', 'Repeated passes', 'O(n²·k)', 'simulation'], ['kahn', 'Kahn on ingredients', 'O(V + E)', 'topo-sort', 'topoSort']),
  p1857: ways(['paths', 'DFS every path', 'O(2^V)', 'backtracking'], ['kahn', 'Kahn + colour DP', 'O(26·(V + E))', 'topo-sort', 'topoSort']),
  p1203: ways(['dfs', 'DFS on two levels', 'O(n + m)', 'bfs-dfs', 'dfs'], ['kahn', 'Two-level Kahn', 'O(n + m)', 'topo-sort', 'topoSort']),

  // S3 · Union-find
  p684: ways(['dfs', 'DFS per edge', 'O(n²)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find', 'O(n·α)', 'union-find', 'dsu']),
  p547: ways(['dfs', 'DFS on the matrix', 'O(n²)', 'bfs-dfs', 'dfs'], ['bfs', 'BFS on the matrix', 'O(n²)', 'bfs-dfs', 'bfs'], ['uf', 'Union-find', 'O(n²·α)', 'union-find', 'dsu']),
  p323: ways(['dfs', 'DFS components', 'O(V + E)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find', 'O(E·α)', 'union-find', 'dsu']),
  p261: ways(['dfs', 'DFS + node count', 'O(V + E)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find', 'O(E·α)', 'union-find', 'dsu']),
  p721: ways(['dfs', 'Email graph + DFS', 'O(n log n)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find + sort', 'O(n log n)', 'union-find', 'dsu']),
  p990: ways(['dfs', 'DFS per inequality', 'O(n·V)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find', 'O(n·α)', 'union-find', 'dsu']),
  p947: ways(['dfs', 'DFS on stones', 'O(n²)', 'bfs-dfs', 'dfs'], ['uf', 'Union rows and columns', 'O(n·α)', 'union-find', 'dsu']),
  p1202: ways(['dfs', 'DFS components + sort', 'O(n log n)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find + sort', 'O(n log n)', 'union-find', 'dsu']),
  p1584: ways(['kruskal', 'Kruskal on all pairs', 'O(n² log n)', 'mst', 'kruskal'], ['prim', 'Prim, dense graph', 'O(n²)', 'mst']),
  p685: ways(['each', 'Remove each edge', 'O(n²)', 'bfs-dfs', 'dfs'], ['uf', 'Union-find + two candidates', 'O(n·α)', 'union-find', 'dsu']),

  // S4 · Advanced graphs
  p743: ways(['bellman', 'Bellman-Ford', 'O(V·E)', 'shortest-path', 'bellmanFord'], ['dijkstra', 'Dijkstra', 'O(E log V)', 'shortest-path', 'dijkstra']),
  p787: ways(['dfs', 'DFS all routes', 'O(n^k)', 'backtracking'], ['dijkstra', 'Dijkstra with stops', 'O(E·k log(n·k))', 'shortest-path', 'dijkstra'], ['bellman', 'Bellman-Ford, k rounds', 'O(k·E)', 'shortest-path', 'bellmanFord']),
  p1631: ways(['bs', 'Binary search + BFS', 'O(m·n log H)', 'binary-search', 'bsAnswer'], ['uf', 'Union-find by effort', 'O(m·n log(m·n))', 'union-find', 'dsu'], ['dijkstra', 'Dijkstra on max', 'O(m·n log(m·n))', 'shortest-path', 'dijkstra']),
  p1514: ways(['bellman', 'Bellman-Ford', 'O(V·E)', 'shortest-path', 'bellmanFord'], ['dijkstra', 'Dijkstra max-heap', 'O(E log V)', 'shortest-path', 'dijkstra']),
  p778: ways(['bs', 'Binary search + DFS', 'O(n² log n)', 'binary-search', 'bsAnswer'], ['uf', 'Union-find by time', 'O(n² log n)', 'union-find', 'dsu'], ['dijkstra', 'Dijkstra on max', 'O(n² log n)', 'shortest-path', 'dijkstra']),
  p1976: ways(['paths', 'DFS all paths', 'O(2^V)', 'backtracking'], ['dijkstra', 'Dijkstra + path count', 'O(E log V)', 'shortest-path', 'dijkstra']),
  p332: ways(['bt', 'Backtracking in order', 'O(E^d)', 'backtracking'], ['hierholzer', 'Hierholzer DFS', 'O(E log E)', 'bfs-dfs', 'dfs']),
  p1192: ways(['each', 'Remove each edge', 'O(E·(V + E))', 'bfs-dfs', 'dfs'], ['tarjan', 'Tarjan low-link', 'O(V + E)', 'scc-bridges']),
  p1489: ways(['all', 'All spanning trees', 'O(2^E)', 'backtracking'], ['kruskal', 'Kruskal per edge', 'O(E²·α)', 'mst', 'kruskal']),
  p2092: ways(['bfs', 'BFS per time group', 'O(M log M + N)', 'bfs-dfs', 'bfs'], ['uf', 'Union-find per time', 'O(M log M)', 'union-find', 'dsu']),

  // S5 · Trees: DFS returns, path problems, BST properties
  p543: ways(['each', 'Height from every node', 'O(n²)', 'bfs-dfs', 'dfs'], ['dfs', 'One DFS returns height', 'O(n)', 'bfs-dfs', 'dfs']),
  p236: ways(['paths', 'Store root paths', 'O(n)', 'bfs-dfs', 'bfs'], ['dfs', 'Recursive DFS', 'O(n)', 'bfs-dfs', 'dfs']),
  p124: ways(['each', 'Try every path', 'O(n²)', 'bfs-dfs', 'dfs'], ['dfs', 'DFS returns best gain', 'O(n)', 'bfs-dfs', 'dfs']),
  p98: ways(['inorder', 'Inorder into array', 'O(n)', 'bfs-dfs', 'bstInsert'], ['bounds', 'DFS with bounds', 'O(n)', 'bfs-dfs', 'bstInsert']),
  p230: ways(['sort', 'Collect and sort', 'O(n log n)', 'sorting'], ['inorder', 'Inorder, stop at k', 'O(h + k)', 'bfs-dfs', 'bstInsert']),
  p105: ways(['scan', 'Linear search for root', 'O(n²)', 'divide-conquer', 'mergeSort'], ['index', 'Hash map of indices', 'O(n)', 'divide-conquer', 'mergeSort']),
  p297: ways(['bfs', 'BFS level order', 'O(n)', 'bfs-dfs', 'bfs'], ['dfs', 'Preorder DFS', 'O(n)', 'bfs-dfs', 'dfs']),
  p337: ways(recursion('O(2^n)'), ['memo', 'Memo on node', 'O(n)', 'dp-memo', 'memo'], ['pair', 'DFS returns a pair', 'O(n)', 'dp-memo', 'memo']),
  p1448: ways(['bfs', 'BFS carrying max', 'O(n)', 'bfs-dfs', 'bfs'], ['dfs', 'DFS carrying max', 'O(n)', 'bfs-dfs', 'dfs']),
  p968: ways(['dp', 'Tree DP, three states', 'O(n)', 'dp-memo', 'memo'], ['greedy', 'Greedy from leaves', 'O(n)', 'greedy']),

  // S6 · Trees II: views and orders, tries, segment trees and BIT
  p199: ways(['dfs', 'DFS right first', 'O(n)', 'bfs-dfs', 'dfs'], ['bfs', 'BFS last per level', 'O(n)', 'bfs-dfs', 'bfs']),
  p987: ways(['dfs', 'DFS + global sort', 'O(n log n)', 'sorting'], ['bfs', 'BFS + column sort', 'O(n log n)', 'bfs-dfs', 'bfs']),
  p114: ways(['list', 'Preorder into list', 'O(n)', 'bfs-dfs', 'dfs'], ['post', 'Reverse postorder', 'O(n)', 'bfs-dfs', 'dfs'], ['morris', 'Morris threading', 'O(n) · O(1)', 'bfs-dfs', 'dfs']),
  p2385: ways(['graph', 'Graph + BFS', 'O(n)', 'bfs-dfs', 'bfs'], ['dfs', 'One-pass DFS', 'O(n)', 'bfs-dfs', 'dfs']),
  p208: ways(['scan', 'Word list scan', 'O(n·L)', 'string-match'], ['prefixes', 'Hash set of prefixes', 'O(L²)', 'lru-design', 'hashInsert'], ['trie', 'Trie nodes', 'O(L)', 'trie']),
  p211: ways(['scan', 'Word list + pattern', 'O(n·L)', 'string-match'], ['trie', 'Trie + dot DFS', 'O(26^d·L)', 'trie']),
  p212: ways(['each', 'DFS per word', 'O(w·m·n·4^L)', 'backtracking'], ['trie', 'Trie + board DFS', 'O(m·n·4^L)', 'trie']),
  p1268: ways(['filter', 'Sort + filter prefixes', 'O(L·n log n)', 'sorting'], ['bs', 'Sort + binary search', 'O(n log n + L log n)', 'binary-search', 'binarySearch'], ['trie', 'Trie with top three', 'O(total chars)', 'trie']),
  p307: ways(['rebuild', 'Prefix sums, rebuild', 'O(n) update', 'prefix-sum'], ['segment', 'Segment tree', 'O(log n)', 'segment-fenwick'], ['fenwick', 'Fenwick tree', 'O(log n)', 'segment-fenwick']),
  p315: ways(brute('O(n²)'), ['merge', 'Merge sort counting', 'O(n log n)', 'divide-conquer', 'mergeSort'], ['fenwick', 'Fenwick on ranks', 'O(n log n)', 'segment-fenwick']),

  // S7 · Dynamic programming I: 1-D state, subsequences
  p198: ways(recursion('O(2^n)'), ['memo', 'Memoized recursion', 'O(n)', 'dp-memo', 'memo'], ['two', 'Two rolling variables', 'O(n) · O(1)', 'dp-tabulation', 'tab']),
  p91: ways(recursion('O(2^n)'), ['memo', 'Memo on index', 'O(n)', 'dp-memo', 'memo'], ['rolling', 'Rolling DP', 'O(n) · O(1)', 'dp-tabulation', 'tab']),
  p322: ways(recursion('O(c^a)'), ['memo', 'Memoization', 'O(a·c)', 'dp-memo', 'memo'], ['tab', 'Tabulation', 'O(a·c)', 'dp-tabulation', 'coinChange']),
  p139: ways(recursion('O(2^n)'), ['memo', 'Memo on index', 'O(n²)', 'dp-memo', 'memo'], ['dp', 'Bottom-up DP', 'O(n²)', 'dp-tabulation', 'tab']),
  p152: ways(brute('O(n²)'), ['minmax', 'Track max and min', 'O(n)', 'dp-tabulation', 'kadane']),
  p279: ways(['bfs', 'BFS on remainders', 'O(n√n)', 'bfs-dfs', 'bfs'], ['dp', 'Bottom-up DP', 'O(n√n)', 'dp-tabulation', 'coinChange'], ['math', 'Four-square theorem', 'O(√n)', 'number-theory']),
  p300: ways(recursion('O(2^n)'), ['dp', 'Quadratic DP', 'O(n²)', 'dp-tabulation', 'lis'], ['patience', 'Patience + binary search', 'O(n log n)', 'binary-search', 'binarySearch']),
  p673: ways(['dp', 'DP length + count', 'O(n²)', 'dp-tabulation', 'lis'], ['fenwick', 'Fenwick on values', 'O(n log n)', 'segment-fenwick']),
  p354: ways(['dp', 'Sort + quadratic DP', 'O(n²)', 'dp-tabulation', 'lis'], ['lis', 'Sort + LIS search', 'O(n log n)', 'binary-search', 'binarySearch']),
  p416: ways(['subsets', 'Try all subsets', 'O(2^n)', 'backtracking'], ['memo', 'Memo on (i, sum)', 'O(n·sum)', 'dp-memo', 'memo'], ['dp', 'Subset-sum DP', 'O(n·sum)', 'dp-tabulation', 'knapsack']),

  // S8 · Dynamic programming II: 2-D grids and two-string DP
  p62: ways(recursion('O(2^(m+n))'), ['grid', 'Grid DP', 'O(m·n)', 'dp-tabulation', 'tab'], ['binomial', 'Binomial coefficient', 'O(min(m, n))', 'combinatorics']),
  p64: ways(recursion('O(2^(m+n))'), ['grid', 'Grid DP', 'O(m·n)', 'dp-tabulation', 'tab']),
  p1143: ways(recursion('O(2^(m+n))'), ['memo', 'Memo on (i, j)', 'O(m·n)', 'dp-memo', 'memo'], ['table', '2-D table', 'O(m·n)', 'dp-tabulation', 'lcs']),
  p72: ways(recursion('O(3^(m+n))'), ['memo', 'Memo on (i, j)', 'O(m·n)', 'dp-memo', 'memo'], ['table', '2-D table', 'O(m·n)', 'dp-tabulation', 'lcs']),
  p516: ways(recursion('O(2^n)'), ['lcs', 'LCS with reverse', 'O(n²)', 'dp-tabulation', 'lcs'], ['interval', 'Interval DP', 'O(n²)', 'dp-tabulation', 'lcs']),
  p97: ways(recursion('O(2^(m+n))'), ['memo', 'Memo on (i, j)', 'O(m·n)', 'dp-memo', 'memo'], ['table', '2-D table', 'O(m·n)', 'dp-tabulation', 'lcs']),
  p115: ways(recursion('O(2^n)'), ['memo', 'Memo on (i, j)', 'O(m·n)', 'dp-memo', 'memo'], ['rolling', '1-D rolling DP', 'O(m·n)', 'dp-tabulation', 'lcs']),
  p10: ways(['bt', 'Backtracking match', 'O(2^(m+n))', 'backtracking'], ['memo', 'Memo on (i, j)', 'O(m·n)', 'dp-memo', 'memo'], ['table', '2-D table', 'O(m·n)', 'dp-tabulation', 'lcs']),
  p174: ways(['bs', 'Binary search on HP', 'O(m·n log H)', 'binary-search', 'bsAnswer'], ['reverse', 'Reverse grid DP', 'O(m·n)', 'dp-tabulation', 'tab']),
  p329: ways(['dfs', 'DFS from each cell', 'O(2^(m·n))', 'bfs-dfs', 'dfs'], ['layers', 'Topological layers', 'O(m·n)', 'topo-sort', 'topoSort'], ['memo', 'DFS + memo', 'O(m·n)', 'dp-memo', 'memo']),

  // S9 · Dynamic programming III: knapsack, palindromes, stock and game DP
  p494: ways(['signs', 'Try all signs', 'O(2^n)', 'backtracking'], ['memo', 'Memo on (i, sum)', 'O(n·S)', 'dp-memo', 'memo'], ['dp', 'Subset-sum DP', 'O(n·S)', 'dp-tabulation', 'knapsack']),
  p518: ways(recursion('O(2^amount)'), ['memo', 'Memo on (i, amount)', 'O(n·amount)', 'dp-memo', 'memo'], ['dp', 'Unbounded knapsack DP', 'O(n·amount)', 'dp-tabulation', 'coinChange']),
  p474: ways(['subsets', 'Try all subsets', 'O(2^n)', 'backtracking'], ['dp', '2-D knapsack DP', 'O(l·m·n)', 'dp-tabulation', 'knapsack']),
  p1049: ways(['signs', 'Try all signs', 'O(2^n)', 'backtracking'], ['dp', 'Subset-sum DP', 'O(n·S)', 'dp-tabulation', 'knapsack']),
  p5: ways(brute('O(n³)'), ['dp', 'DP table', 'O(n²)', 'dp-tabulation', 'lcs'], ['expand', 'Expand around centre', 'O(n²) · O(1)', 'two-pointers', 'twoSum'], ['manacher', "Manacher's algorithm", 'O(n)', 'string-match']),
  p647: ways(brute('O(n³)'), ['dp', 'DP table', 'O(n²)', 'dp-tabulation', 'lcs'], ['expand', 'Expand around centre', 'O(n²) · O(1)', 'two-pointers', 'twoSum']),
  p309: ways(recursion('O(2^n)'), ['state', 'State machine DP', 'O(n)', 'dp-tabulation', 'tab']),
  p188: ways(recursion('O(2^n)'), ['memo', 'Memo on state', 'O(n·k)', 'dp-memo', 'memo'], ['state', 'State DP', 'O(n·k)', 'dp-tabulation', 'tab']),
  p877: ways(['minimax', 'Minimax recursion', 'O(2^n)', 'game-theory', 'minimax'], ['interval', 'Interval DP', 'O(n²)', 'dp-tabulation', 'lcs'], ['math', 'First player always wins', 'O(1)', 'game-theory', 'nim']),
  p1035: ways(recursion('O(2^(m+n))'), ['lcs', 'LCS table', 'O(m·n)', 'dp-tabulation', 'lcs']),

  // S10 · Dynamic programming IV: intervals, bitmask, state machines
  p312: ways(['orders', 'Try every order', 'O(n!)', 'backtracking'], ['memo', 'Memo on interval', 'O(n³)', 'dp-memo', 'memo'], ['interval', 'Interval DP', 'O(n³)', 'dp-tabulation', 'lcs']),
  p1039: ways(recursion('O(2^n)'), ['interval', 'Interval DP', 'O(n³)', 'dp-tabulation', 'lcs']),
  p1547: ways(['orders', 'Try all cut orders', 'O(m!)', 'backtracking'], ['interval', 'Interval DP on cuts', 'O(m³)', 'dp-tabulation', 'lcs']),
  p1000: ways(recursion('O(2^n)'), ['interval', 'Interval DP + prefix', 'O(n³ / k)', 'dp-tabulation', 'lcs']),
  p664: ways(recursion('O(2^n)'), ['interval', 'Interval DP', 'O(n³)', 'dp-tabulation', 'lcs']),
  p698: ways(['buckets', 'Backtracking into buckets', 'O(k^n)', 'backtracking', 'nQueens'], ['mask', 'Bitmask DP', 'O(n·2^n)', 'dp-bitmask']),
  p847: ways(['perm', 'Try all permutations', 'O(n!·n)', 'backtracking'], ['mask', 'BFS on (node, mask)', 'O(n²·2^n)', 'dp-bitmask']),
  p1220: ways(recursion('O(5^n)'), ['state', 'State DP', 'O(n)', 'dp-tabulation', 'tab'], ['matrix', 'Matrix exponentiation', 'O(log n)', 'number-theory']),
  p935: ways(recursion('O(3^n)'), ['state', 'State DP', 'O(n)', 'dp-tabulation', 'tab'], ['matrix', 'Matrix exponentiation', 'O(log n)', 'number-theory']),
  p879: ways(['subsets', 'Try all subsets', 'O(2^n)', 'backtracking'], ['dp', '3-D knapsack DP', 'O(n·G·P)', 'dp-tabulation', 'knapsack']),

  // S11 · Heaps: two heaps, top-K, K-way merge
  p215: ways(['sort', 'Sort', 'O(n log n)', 'sorting', 'quickSort'], ['heap', 'Min-heap of size k', 'O(n log k)', 'heap-pq', 'heapPush'], ['select', 'Quickselect', 'O(n) avg', 'sorting', 'quickSort']),
  p703: ways(['sort', 'Sort on every add', 'O(n log n)', 'sorting', 'insertionSort'], ['heap', 'Min-heap of k', 'O(log k)', 'heap-pq', 'heapPush']),
  p295: ways(['sorted', 'Sorted list insert', 'O(n)', 'sorting', 'insertionSort'], ['two', 'Two heaps', 'O(log n)', 'heap-pq', 'heapPush']),
  p480: ways(['sort', 'Sort every window', 'O(n·k log k)', 'sorting'], ['two', 'Two heaps, lazy delete', 'O(n log k)', 'heap-pq', 'heapPush']),
  p502: ways(['scan', 'Scan every round', 'O(k·n)', 'greedy'], ['heap', 'Sort + max-heap', 'O((n + k) log n)', 'heap-pq', 'heapPush']),
  p23: ways(['sort', 'Collect and sort', 'O(N log N)', 'sorting', 'mergeSort'], ['pairs', 'Merge in pairs', 'O(N log k)', 'divide-conquer', 'mergeSort'], ['heap', 'Min-heap of heads', 'O(N log k)', 'heap-pq', 'heapPush']),
  p378: ways(['sort', 'Flatten and sort', 'O(n² log n)', 'sorting'], ['heap', 'Heap of rows', 'O(k log n)', 'heap-pq', 'heapPush'], ['bs', 'Binary search on value', 'O(n log(max − min))', 'binary-search', 'bsAnswer']),
  p632: ways(['window', 'Merge + sliding window', 'O(N log N)', 'sliding-window', 'slidingWindow'], ['heap', 'Heap of heads', 'O(N log k)', 'heap-pq', 'heapPush']),
  p621: ways(['heap', 'Simulate with heap', 'O(n log 26)', 'heap-pq', 'heapPush'], ['formula', 'Count formula', 'O(n)', 'greedy']),
  p857: ways(['each', 'Try each captain', 'O(n² log n)', 'sorting'], ['heap', 'Sort ratio + max-heap', 'O(n log n)', 'heap-pq', 'heapPush']),

  // S12 · Backtracking, monotonic stack, binary search on the answer
  p51: ways(brute('O(n^n)'), ['bt', 'Backtracking with sets', 'O(n!)', 'backtracking', 'nQueens']),
  p37: ways(brute('O(9^81)'), ['bt', 'Backtracking with sets', 'O(9^m)', 'backtracking', 'nQueens']),
  p131: ways(['bt', 'Backtracking, check each', 'O(n·2^n)', 'backtracking', 'nQueens'], ['dp', 'Backtracking + palindrome table', 'O(n·2^n)', 'backtracking', 'nQueens']),
  p739: ways(brute('O(n²)'), ['mono', 'Monotonic stack', 'O(n)', 'monotonic-stack', 'mono']),
  p84: ways(brute('O(n²)'), ['dc', 'Divide at the minimum', 'O(n log n)', 'divide-conquer', 'mergeSort'], ['mono', 'Monotonic stack', 'O(n)', 'monotonic-stack', 'mono']),
  p42: ways(brute('O(n²)'), ['prefix', 'Prefix max arrays', 'O(n)', 'prefix-sum'], ['two', 'Two pointers', 'O(n) · O(1)', 'two-pointers', 'twoSum']),
  p875: ways(['each', 'Try every speed', 'O(n·max)', 'simulation'], ['bs', 'Binary search on speed', 'O(n log max)', 'binary-search', 'bsAnswer']),
  p1011: ways(['each', 'Try every capacity', 'O(n·sum)', 'simulation'], ['bs', 'Binary search on capacity', 'O(n log sum)', 'binary-search', 'bsAnswer']),
  p410: ways(['dp', 'Partition DP', 'O(k·n²)', 'dp-tabulation', 'tab'], ['bs', 'Binary search on answer', 'O(n log sum)', 'binary-search', 'bsAnswer']),
  p4: ways(['merge', 'Merge both arrays', 'O(m + n)', 'two-pointers', 'twoSum'], ['bs', 'Binary search partition', 'O(log min(m, n))', 'binary-search', 'binarySearch']),

  // S16 · Practical coding rounds: design-a-class problems
  p146: ways(['scan', 'List + linear scan', 'O(n)', 'lru-design'], ['lru', 'Hash map + DLL', 'O(1)', 'lru-design']),
  p460: ways(['heap', 'Heap by frequency', 'O(log n)', 'heap-pq', 'heapPush'], ['buckets', 'Frequency buckets + DLL', 'O(1)', 'lru-design']),
  p981: ways(['scan', 'Scan the list', 'O(n)', 'lru-design'], ['bs', 'Hash + binary search', 'O(log n)', 'binary-search', 'binarySearch']),
  p380: ways(['convert', 'Set, copy on random', 'O(n)', 'lru-design'], ['swap', 'Hash map + array', 'O(1)', 'lru-design', 'hashInsert']),
  p706: ways(['array', 'One huge array', 'O(1) · O(U)', 'lru-design'], ['chain', 'Chaining buckets', 'O(1) average', 'lru-design', 'hashInsert']),
  p355: ways(['sort', 'Merge all, then sort', 'O(n log n)', 'sorting', 'mergeSort'], ['heap', 'Heap merge of feeds', 'O(k log f)', 'heap-pq', 'heapPush']),
  p1396: ways(['list', 'Store every trip', 'O(n) per query', 'lru-design'], ['maps', 'Two hash maps', 'O(1)', 'lru-design', 'hashInsert']),
  p895: ways(['heap', 'Heap by (freq, time)', 'O(log n)', 'heap-pq', 'heapPush'], ['stacks', 'Stack per frequency', 'O(1)', 'lru-design']),
  p2034: ways(['scan', 'Scan for max, min', 'O(n)', 'lru-design'], ['heaps', 'Hash + two heaps', 'O(log n)', 'heap-pq', 'heapPush']),
  p1206: ways(['sorted', 'Sorted array', 'O(n) insert', 'binary-search', 'binarySearch'], ['skip', 'Skip list levels', 'O(log n) expected', 'probability']),
  p359: ways(['queue', 'Queue + set', 'O(1) amortised', 'streaming'], ['map', 'Map of last time', 'O(1)', 'lru-design', 'hashInsert']),
  p362: ways(['list', 'List of hits', 'O(n)', 'sliding-window'], ['queue', 'Queue, drop old', 'O(1) amortised', 'sliding-window', 'slidingWindow'], ['ring', 'Circular buckets', 'O(1) · O(300)', 'sliding-window', 'slidingWindow']),
  p588: ways(['flat', 'Flat path map', 'O(n)', 'lru-design'], ['trie', 'Trie of paths', 'O(path length)', 'trie']),

  // S15 · Pattern sweep I: sliding window and two pointers
  p3: ways(brute('O(n³)'), ['set', 'Window + set', 'O(n)', 'sliding-window', 'slidingWindow'], ['last', 'Window + last index', 'O(n)', 'sliding-window', 'slidingWindow']),
  p76: ways(brute('O(n²·k)'), ['window', 'Window with counts', 'O(m + n)', 'sliding-window', 'slidingWindow']),
  p424: ways(brute('O(26·n²)'), ['window', 'Window, max count', 'O(n)', 'sliding-window', 'slidingWindow']),
  p239: ways(brute('O(n·k)'), ['heap', 'Max-heap', 'O(n log n)', 'heap-pq', 'heapPush'], ['deque', 'Monotonic deque', 'O(n)', 'monotonic-stack', 'mono']),
  p567: ways(['sort', 'Sort every window', 'O(n·k log k)', 'sorting'], ['window', 'Fixed window counts', 'O(n)', 'sliding-window', 'slidingWindow']),
  p15: ways(brute('O(n³)'), ['hash', 'Hash per pair', 'O(n²)', 'lru-design', 'hashInsert'], ['two', 'Sort + two pointers', 'O(n²)', 'two-pointers', 'twoSum']),
  p11: ways(brute('O(n²)'), ['two', 'Two pointers inward', 'O(n)', 'two-pointers', 'twoSum']),
  p16: ways(brute('O(n³)'), ['two', 'Sort + two pointers', 'O(n²)', 'two-pointers', 'twoSum']),

  // S18 · Pattern sweep II: fast and slow pointers, in-place reversal, cyclic sort
  p141: ways(['set', 'Hash set of nodes', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['floyd', 'Fast and slow', 'O(n) · O(1)', 'cycle-fast-slow', 'cycle']),
  p142: ways(['set', 'Hash set of nodes', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['floyd', 'Fast/slow, then reset', 'O(n) · O(1)', 'cycle-fast-slow', 'cycle']),
  p287: ways(['sort', 'Sort', 'O(n log n)', 'sorting'], ['set', 'Hash set', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['count', 'Binary search on count', 'O(n log n)', 'binary-search', 'bsAnswer'], ['floyd', 'Fast/slow on indices', 'O(n) · O(1)', 'cycle-fast-slow', 'cycle']),
  p206: ways(['stack', 'Copy onto a stack', 'O(n) · O(n)', 'monotonic-stack', 'validParens'], ['iter', 'Three pointers', 'O(n) · O(1)', 'lru-design', 'reverseList']),
  p92: ways(['copy', 'Copy values out', 'O(n) · O(n)', 'simulation'], ['iter', 'One-pass sublist reversal', 'O(n) · O(1)', 'lru-design', 'reverseList']),
  p25: ways(['array', 'Collect into array', 'O(n) · O(n)', 'simulation'], ['iter', 'Reverse group by group', 'O(n) · O(1)', 'lru-design', 'reverseList']),
  p41: ways(['sort', 'Sort', 'O(n log n)', 'sorting'], ['set', 'Hash set', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['cyclic', 'Cyclic sort', 'O(n) · O(1)', 'sorting']),
  p448: ways(['set', 'Hash set', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['negate', 'Mark by negation', 'O(n) · O(1)', 'sorting']),

  // S20 · Pattern sweep III: merge intervals, subsets, XOR, modified binary search
  p56: ways(brute('O(n²)'), ['sort', 'Sort + merge', 'O(n log n)', 'greedy', 'mergeIntervals']),
  p57: ways(['remerge', 'Append + re-merge', 'O(n log n)', 'greedy', 'mergeIntervals'], ['pass', 'One linear pass', 'O(n)', 'greedy', 'mergeIntervals']),
  p435: ways(['subsets', 'Try all subsets', 'O(2^n)', 'backtracking'], ['greedy', 'Sort by end, greedy', 'O(n log n)', 'greedy', 'greedy']),
  p253: ways(['minute', 'Check every minute', 'O(n·T)', 'simulation'], ['heap', 'Min-heap of ends', 'O(n log n)', 'heap-pq', 'heapPush'], ['sweep', 'Sweep starts and ends', 'O(n log n)', 'sweep-line', 'mergeIntervals']),
  p78: ways(['mask', 'Bitmask enumeration', 'O(n·2^n)', 'bit-tricks', 'bitCount'], ['bt', 'Backtracking', 'O(n·2^n)', 'backtracking', 'nQueens']),
  p90: ways(['dedupe', 'Generate + set dedupe', 'O(n·2^n)', 'backtracking'], ['bt', 'Sort + skip duplicates', 'O(n·2^n)', 'backtracking', 'nQueens']),
  p136: ways(['hash', 'Hash counts', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['xor', 'XOR everything', 'O(n) · O(1)', 'bit-tricks', 'bitCount']),
  p260: ways(['hash', 'Hash counts', 'O(n) · O(n)', 'lru-design', 'hashInsert'], ['xor', 'XOR, split by bit', 'O(n) · O(1)', 'bit-tricks', 'bitCount']),
  p33: ways(['scan', 'Linear scan', 'O(n)', 'simulation'], ['bs', 'Binary search, one pass', 'O(log n)', 'binary-search', 'binarySearch']),
  p153: ways(['scan', 'Linear scan', 'O(n)', 'simulation'], ['bs', 'Binary search', 'O(log n)', 'binary-search', 'binarySearch']),
  p162: ways(['scan', 'Linear scan', 'O(n)', 'simulation'], ['bs', 'Binary search on slope', 'O(log n)', 'binary-search', 'binarySearch']),

  // S24 · Pattern sweep IV: greedy, prefix sums, hash maps, stack
  p55: ways(recursion('O(2^n)'), ['dp', 'DP reachability', 'O(n²)', 'dp-tabulation', 'tab'], ['greedy', 'Greedy farthest reach', 'O(n)', 'greedy', 'greedy']),
  p45: ways(['dp', 'DP min jumps', 'O(n²)', 'dp-tabulation', 'tab'], ['levels', 'Greedy BFS levels', 'O(n)', 'greedy', 'greedy']),
  p134: ways(['each', 'Try each start', 'O(n²)', 'simulation'], ['greedy', 'One-pass greedy', 'O(n)', 'greedy', 'greedy']),
  p846: ways(['remove', 'Sort + remove', 'O(n²)', 'sorting'], ['greedy', 'Count map + sort', 'O(n log n)', 'greedy', 'greedy']),
  p560: ways(brute('O(n²)'), ['prefix', 'Prefix sums + hash', 'O(n)', 'prefix-sum']),
  p238: ways(['divide', 'Total product, divide', 'O(n)', 'simulation'], ['prefix', 'Prefix and suffix', 'O(n)', 'prefix-sum']),
  p1094: ways(['sim', 'Simulate every km', 'O(n·L)', 'simulation'], ['heap', 'Heap by drop-off', 'O(n log n)', 'heap-pq', 'heapPush'], ['diff', 'Difference array', 'O(n + L)', 'prefix-sum']),
  p49: ways(['pairs', 'Compare all pairs', 'O(n²·k)', 'backtracking'], ['sorted', 'Sorted-key map', 'O(n·k log k)', 'sorting', 'hashInsert'], ['count', 'Count-key map', 'O(n·k)', 'lru-design', 'hashInsert']),
  p155: ways(['scan', 'Scan for the min', 'O(n)', 'simulation'], ['pairs', 'Stack of (val, min)', 'O(1)', 'monotonic-stack', 'validParens']),
  p150: ways(['recursion', 'Recursive parse', 'O(n)', 'divide-conquer'], ['stack', 'Operand stack', 'O(n)', 'monotonic-stack', 'validParens']),
}

export function approachesFor(ticketId: string): Approach[] {
  return APPROACHES[ticketId] ?? []
}

/** The chip's accessible name (§7.1): `<name> · <complexity>` plus ` · best` on the starred one. */
export function chipName(a: Approach): string {
  return `${a.name} · ${a.complexity}${a.best ? ' · best' : ''}`
}
