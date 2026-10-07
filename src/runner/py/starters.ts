// C-PYTHON §1 / C-VISUAL §5: the Python signature of each pack, and the starter the editor opens with. The
// description comes from the pack's own (Go) starter so the two languages say the same thing.
import type { PublicPack } from '../types'

export const PY_SIGNATURES: Record<string, string> = {
  p91: 'def numDecodings(s: str) -> int:',
  p198: 'def rob(nums: list[int]) -> int:',
  p322: 'def coinChange(coins: list[int], amount: int) -> int:',
  p62: 'def uniquePaths(m: int, n: int) -> int:',
  p1143: 'def longestCommonSubsequence(text1: str, text2: str) -> int:',
  // C-VISUAL §5
  p743: 'def networkDelayTime(times: list[list[int]], n: int, k: int) -> int:',
  p207: 'def canFinish(numCourses: int, prerequisites: list[list[int]]) -> bool:',
  p802: 'def eventualSafeNodes(graph: list[list[int]]) -> list[int]:',
  p684: 'def findRedundantConnection(edges: list[list[int]]) -> list[int]:',
  p1584: 'def minCostConnectPoints(points: list[list[int]]) -> int:',
  p877: 'def stoneGame(piles: list[int]) -> bool:',
  p55: 'def canJump(nums: list[int]) -> bool:',
  p875: 'def minEatingSpeed(piles: list[int], h: int) -> int:',
  p153: 'def findMin(nums: list[int]) -> int:',
  p3: 'def lengthOfLongestSubstring(s: str) -> int:',
  p11: 'def maxArea(height: list[int]) -> int:',
  p206: 'def reverseList(head: ListNode | None) -> ListNode | None:',
  p56: 'def merge(intervals: list[list[int]]) -> list[list[int]]:',
  p215: 'def findKthLargest(nums: list[int], k: int) -> int:',
  p543: 'def diameterOfBinaryTree(root: TreeNode | None) -> int:',
}

export function pySignature(pack: Pick<PublicPack, 'id'>): string | null {
  return PY_SIGNATURES[pack.id] ?? null
}

const TABLE_SIZE: Record<string, string> = { p91: 'len(s) + 1' }

/** C-VISUAL §5: the visual packs' starters: the toolkit hint and the body (what an unchanged starter returns). */
const VISUAL: Record<string, { hint: string[]; ret: string; note?: string }> = {
  p743: { hint: ['g = tk.Graph("g", True); g.Edge(u, v, w); g.Dist(k, 0); g.Visit(u); g.Relax(u, v, d)', 'pq = tk.Heap("pq"); pq.Push(v, d); u, d = pq.Pop()'], ret: '0' },
  p207: { hint: ['g = tk.Graph("g", True); g.Edge(b, a); g.Mark(i, "in 1"); g.Visit(u)', 'q = tk.Queue("q"); q.Push(i); u = q.Pop()'], ret: 'False' },
  p802: { hint: ['g = tk.Graph("g", True); g.Edge(u, v); g.Mark(u, "safe"); g.Visit(u)'], ret: '[]' },
  p684: { hint: ['uf = tk.DSU("uf", n + 1); joined = uf.Union(a, b); r = uf.Find(a)'], ret: '[]' },
  p1584: { hint: ['pq = tk.Heap("pq"); pq.Push(j, cost); j, cost = pq.Pop()', 'g = tk.Graph("mst", False); g.Edge(i, j, cost); g.Visit(j)'], ret: '0' },
  p877: { hint: ['tk.Enter("best", i, j); tk.Hit("best", i, j); tk.Exit(v)', 'gt = tk.GameTable("g"); gt.Set("0-3", "win", 5)'], ret: 'False' },
  p55: { hint: ['a = tk.Array("nums", nums); a.Pointer("i", i); a.Window(0, reach)'], ret: 'False' },
  p875: { hint: ['s = tk.Search("k", 1, max(piles)); s.Mid(mid, ok); s.Hi(mid); s.Lo(mid + 1)'], ret: '0' },
  p153: { hint: ['s = tk.Search("i", 0, len(nums) - 1); s.Mid(mid, nums[mid] <= nums[hi]); s.Hi(mid); s.Lo(mid + 1)'], ret: '0' },
  p3: { hint: ['a = tk.Chars("s", s); a.Pointer("lo", lo); a.Pointer("hi", i); a.Window(lo, i)'], ret: '0' },
  p11: { hint: ['a = tk.Array("h", height); a.Pointer("l", l); a.Pointer("r", r); a.Window(l, r)'], ret: '0' },
  p206: { hint: ['l = tk.List("l"); l.Node(id, val); l.Next(id, nxt); l.Pointer("curr", id)  (-1 or None = nil)'], ret: 'head', note: 'ListNode(val=0, next=None) is defined for you.' },
  p56: { hint: ['inp = tk.Intervals("in", intervals); out = tk.Intervals("out", [])', 'out.Add(s, e); out.Set(i, s, e); inp.Mark(i, "merged")'], ret: 'intervals' },
  p215: { hint: ['h = tk.Heap("h"); h.Push(x, x); key, prio = h.Pop(); key, _ = h.Peek(); h.Len()'], ret: '0' },
  p543: { hint: ['t = tk.Tree("t"); t.Node(id, val, parent, "L"); t.Visit(id); t.Mark(id, "h=2")'], ret: '0', note: 'TreeNode(val=0, left=None, right=None) is defined for you.' },
}

/** The starter for a pack, or null when it has no Python signature. */
export function pyStarter(pack: Pick<PublicPack, 'id' | 'fn' | 'title' | 'starter'>): string | null {
  const sig = pySignature(pack)
  if (!sig) return null
  const desc = /^\/\/ (\S.*)$/m.exec(pack.starter)?.[1] ?? `${pack.fn}: ${pack.title}`
  const v = VISUAL[pack.id]
  if (v) {
    // The Go starter's own comment lines up to the blank one (the description and any pinned output order),
    // without its Go-only sentence about the declared type.
    const head = (/^\/\/ \S.*(?:\n\/\/ \S.*)*/m.exec(pack.starter)?.[0] ?? `// ${desc}`)
      .split('\n').map(l => `# ${l.slice(3).replace(/ (?:ListNode|TreeNode) is declared for you: .*$/, '')}`)
    return [
      ...head,
      ...(v.note ? [`# ${v.note}`] : []),
      '#',
      '# Optional: from dojo import tk to watch it step by step, e.g.',
      '#   from dojo import tk',
      ...v.hint.map(h => `#   ${h}`),
      sig,
      `    return ${v.ret}`,
      '',
    ].join('\n')
  }
  return [
    `# ${desc}`,
    '#',
    '# Optional: from dojo import tk to watch your DP step by step, e.g.',
    '#   from dojo import tk',
    `#   t = tk.Table("dp", 1, ${TABLE_SIZE[pack.id] ?? 'n + 1'})`,
    '#   t.Set(0, i, v, tk.Dep(0, i - 1), tk.Dep(0, i - 2), tk.Rule("{0} + {1}"))',
    sig,
    '    return 0',
    '',
  ].join('\n')
}
