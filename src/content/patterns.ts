/** The 36 pattern rows of the Atlas map (lab/Algorithm Atlas.dc.html, section 01), in map order. */
export const ATLAS_PATTERNS = [
  'TWO POINTERS', 'SLIDING WINDOW', 'PREFIX SUM', 'BINARY SEARCH', 'SORTING',
  'GREEDY', 'BACKTRACKING', 'DP · MEMO', 'DP · TABULATION', 'DP · BITMASK',
  'BFS / DFS', 'SHORTEST PATH', 'MST', 'TOPO SORT', 'UNION-FIND',
  'HEAP / PQ', 'TRIE', 'SEGMENT / FENWICK', 'MONOTONIC STACK', 'BIT TRICKS',
  'NUMBER THEORY', 'GEOMETRY', 'GAME THEORY', 'STREAMING', 'STRING MATCH',
  'DIVIDE & CONQUER', 'ALL-PAIRS PATHS', 'CYCLE · FAST/SLOW', 'SCC · BRIDGES', 'FLOW · MATCHING',
  'LRU · DESIGN', 'COMBINATORICS', 'PROBABILITY', 'SWEEP LINE', 'SIMULATION', 'SIEVE · PRIMES',
] as const

export type AtlasPattern = (typeof ATLAS_PATTERNS)[number]

export function isAtlasPattern(v: unknown): v is AtlasPattern {
  return typeof v === 'string' && (ATLAS_PATTERNS as readonly string[]).includes(v)
}
