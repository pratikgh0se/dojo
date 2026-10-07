// Own input (VISUALIZER "The player → Own input"; labs contract §4.6, D-10): the form fields for each input
// kind, the exact error messages, the limits, and each runnable entry's default text (the library's own input).
import type { InputKind } from './atlas'

/** D-10: the Atlas caps (≤ 12 items, ≤ 8 nodes, 8 × 8) translated per entry. */
export const INPUT_LIMITS = {
  items: 12, nodes: 8, grid: 8, intAbs: 999, knapsackItems: 7, capacity: 7, lcsLength: 7, amount: 11, boardMin: 4, boardMax: 8, number: 255, buckets: 8,
} as const

/** §4.6 messages, exact. */
export const INPUT_ERRORS = {
  ints: 'Only whole numbers from -999 to 999, separated by commas.',
  tooMany: 'Too many items: the limit is 12.',
  sorted: 'Needs a sorted array (ascending).',
  target: 'Target must be a whole number.',
  k: 'k must be between 1 and the number of values.',
  nodes: 'Too many nodes: the limit is 8.',
  edge: 'Edges look like A-B or A-B:4.',
  start: "Start node must be one of the graph's nodes.",
  negative: 'Dijkstra needs non-negative weights.',
  cycle: 'Topological sort needs a graph without cycles.',
  gridSize: 'Grid is at most 8 × 8.',
  gridRagged: 'Every grid row must be the same length.',
  gridChars: 'Use only S, E, . and # in the grid.',
  gridEnds: 'The grid needs exactly one S and one E.',
  items: 'Up to 7 items, each weight:value.',
  capacity: 'Capacity must be 1 to 7.',
  strings: 'Each string is 1 to 7 characters.',
  amount: 'Amount must be 1 to 11.',
  coins: 'Coins are positive whole numbers.',
  board: 'n must be 4 to 8.',
  interval: 'Each interval is start-end with start ≤ end.',
  number: 'Number must be 0 to 255.',
  brackets: 'Use only ( ) [ ] { }.',
  buckets: 'Buckets must be 1 to 8.',
} as const

export interface InputField {
  /** key in the raw record and the parsed value */
  name: string
  /** the textbox's accessible name (§4.6, exact) */
  label: string
  multiline?: boolean
}

const f = (name: string, label: string, multiline = false): InputField => ({ name, label, ...(multiline ? { multiline } : {}) })

/** Fields per input kind, labels exact (§4.6 table). */
export const INPUT_FIELDS: Readonly<Record<InputKind, readonly InputField[]>> = {
  ints: [f('values', 'Values')],
  sortedTarget: [f('values', 'Values'), f('target', 'Target')],
  intsK: [f('values', 'Values'), f('k', 'Window size k')],
  graphStart: [f('edges', 'Edges'), f('start', 'Start node')],
  graph: [f('edges', 'Edges')],
  dag: [f('edges', 'Edges')],
  grid: [f('grid', 'Grid', true)],
  items: [f('items', 'Items'), f('capacity', 'Capacity')],
  strings: [f('first', 'First string'), f('second', 'Second string')],
  coins: [f('coins', 'Coins'), f('amount', 'Amount')],
  board: [f('n', 'Board size n')],
  intervals: [f('intervals', 'Intervals')],
  number: [f('number', 'Number')],
  brackets: [f('brackets', 'Brackets')],
  keys: [f('keys', 'Keys'), f('buckets', 'Buckets')],
}

const GRAPH1 = 'A-B:4, A-C:2, B-C:5, B-D:10, C-E:3, E-D:4, D-F:11, E-F:8'

/** Each runnable entry's default text: the input its lab/algo.js generator uses when given none. */
export const INPUT_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  bfs: { edges: GRAPH1, start: 'A' },
  dfs: { edges: GRAPH1, start: 'A' },
  dijkstra: { edges: GRAPH1, start: 'A' },
  bellmanFord: { edges: 'S-A:4, S-B:2, B-A:-3, A-C:3, B-D:5, C-D:-1, C-T:2, D-T:4', start: 'S' },
  topoSort: { edges: 'shirt-tie, tie-jacket, shirt-belt, pants-belt, belt-jacket, pants-shoes, socks-shoes' },
  kruskal: { edges: GRAPH1 },
  bfsGrid: { grid: 'S..#..\n##.#.#\n......\n.####.\n...#E.' },
  knapsack: { items: '1:1, 3:4, 4:5, 5:7', capacity: '7' },
  lcs: { first: 'ABCBDAB', second: 'BDCABA' },
  coinChange: { coins: '1, 3, 4', amount: '6' },
  lis: { values: '10, 9, 2, 5, 3, 7, 101, 18' },
  kadane: { values: '-2, 1, -3, 4, -1, 2, 1, -5, 4' },
  bstInsert: { values: '8, 3, 10, 1, 6, 14, 4, 7, 13' },
  heapPush: { values: '5, 9, 3, 7, 1, 8' },
  nQueens: { n: '4' },
  binarySearch: { values: '1, 3, 4, 7, 9, 12, 15, 18, 21', target: '12' },
  twoSum: { values: '1, 2, 4, 6, 8, 11, 15', target: '14' },
  slidingWindow: { values: '2, 1, 5, 1, 3, 2, 7, 1', k: '3' },
  mergeIntervals: { intervals: '1-3, 2-6, 8-10, 9-12, 15-18' },
  bitCount: { number: '181' },
  bubbleSort: { values: '5, 1, 4, 2, 8, 3' },
  insertionSort: { values: '7, 3, 5, 1, 6, 2' },
  selectionSort: { values: '4, 9, 1, 7, 3' },
  mergeSort: { values: '8, 3, 5, 1, 9, 2, 7, 4' },
  quickSort: { values: '6, 2, 8, 4, 9, 1, 5' },
  reverseList: { values: '1, 2, 3, 4, 5' },
  validParens: { brackets: '{[()()]}(' },
  hashInsert: { keys: 'apple, pear, fig, kiwi, plum, lime, date', buckets: '5' },
}

/** Library generators that take the bare array (`L.bubbleSort = (a = [...])`), not an object. */
export const POSITIONAL: readonly string[] = ['bubbleSort', 'insertionSort', 'selectionSort', 'quickSort', 'mergeSort', 'kadane', 'lis']
/** Generators whose graph is directed. */
export const DIRECTED: readonly string[] = ['bellmanFord', 'topoSort']
/** Generators that read edge weights; an edge written without one weighs 1. */
export const WEIGHTED: readonly string[] = ['dijkstra', 'bellmanFord', 'kruskal']
