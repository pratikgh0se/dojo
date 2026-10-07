// C-PYTHON §1: the Python signatures and starters.
import { describe, expect, it } from 'vitest'
import { PY_SIGNATURES, pyStarter } from '../../src/runner/py/starters'
import type { PublicPack } from '../../src/runner/types'

const pack = (id: string, fn: string, desc: string): PublicPack => ({
  id, title: id, fn, signature: `func ${fn}() int`, examples: 2, cases: [],
  starter: `package main\n\n// ${desc}\n//\n// Optional: add import "dojo/tk" ...\nfunc ${fn}() int {\n\treturn 0\n}\n`,
})

describe('Python signatures (C-PYTHON §1 table)', () => {
  it('are exactly the pinned lines (C-PYTHON §1 and C-VISUAL §5)', () => {
    expect(PY_SIGNATURES).toEqual({
      p91: 'def numDecodings(s: str) -> int:',
      p198: 'def rob(nums: list[int]) -> int:',
      p322: 'def coinChange(coins: list[int], amount: int) -> int:',
      p62: 'def uniquePaths(m: int, n: int) -> int:',
      p1143: 'def longestCommonSubsequence(text1: str, text2: str) -> int:',
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
    })
  })
})

describe('Python starters', () => {
  it('has the signature, a body that compiles, the pack description and the tk hint', () => {
    const s = pyStarter(pack('p91', 'numDecodings', 'numDecodings returns how many ways the digit string s decodes.'))!
    expect(s).toContain('\ndef numDecodings(s: str) -> int:\n    return 0\n')
    expect(s).toContain('# numDecodings returns how many ways the digit string s decodes.')
    expect(s).toContain('from dojo import tk')
    expect(s).toContain('tk.Table("dp", 1, len(s) + 1)')
    expect(s).not.toMatch(/\bpackage main\b|dojo\/tk|:=/)
    expect(s.endsWith('\n')).toBe(true)
  })
  it('C-VISUAL §5: the visual starters carry the pinned output order, the family hint and the right body', async () => {
    const { loadPacks, publicPack } = await import('../../server/runner/runner.mjs')
    const packs = loadPacks()
    const py = (id: string) => pyStarter(publicPack(packs.get(id)!) as PublicPack)!
    expect(py('p56')).toContain('# Return the merged intervals sorted by start.')
    expect(py('p56')).toContain('\ndef merge(intervals: list[list[int]]) -> list[list[int]]:\n    return intervals\n')
    expect(py('p802')).toContain('# Return the safe nodes in ascending order.')
    expect(py('p684')).toContain('# If several edges qualify, return the one that comes last in the input.')
    expect(py('p206')).toContain('    return head\n')
    expect(py('p206')).toContain('ListNode(val=0, next=None) is defined for you.')
    expect(py('p206')).not.toMatch(/struct|\*ListNode|:=/)
    expect(py('p743')).toContain('tk.Heap("pq")')
    for (const id of ['p743', 'p207', 'p802', 'p684', 'p1584', 'p877', 'p55', 'p875', 'p153', 'p3', 'p11', 'p206', 'p56', 'p215', 'p543']) {
      expect(py(id), id).toContain(PY_SIGNATURES[id])
      expect(py(id), id).not.toMatch(/\bpackage main\b|dojo\/tk|:=/)
    }
  })
  it('is null for a ticket that has no Python signature', () => {
    expect(pyStarter(pack('p70', 'climbStairs', 'x'))).toBeNull()
  })
})
