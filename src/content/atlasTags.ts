// Lens tags (ATLAS-06): plan problems listed under an Atlas row although none of their ways (content/approaches.ts) is
// that pattern. Approaches say how a problem is solved; a lens says which row's picture helps you read it. The three rows
// below had no problem at all (the sieve row has its own, p204 Count Primes, so it needs no lens). Every entry is a problem the pattern genuinely applies to; the reason sits beside it.
// Read by rules/atlasPattern.ts after a problem's own ways, so a lens never becomes a problem's chip.

export const ATLAS_LENS: Readonly<Record<string, readonly string[]>> = {
  geometry: [
    'p1039', // Minimum Score Triangulation of Polygon: cut a convex polygon along diagonals, a plane-geometry problem
    'p11', // Container With Most Water: area of the rectangle two vertical lines make on the plane
    'p1584', // Min Cost to Connect All Points: points on the plane, distances are Manhattan geometry
  ],
  'all-pairs-paths': [
    'p743', // Network Delay Time: n <= 100, so Floyd-Warshall (k outermost) is a valid O(n^3) solution
    'p847', // Shortest Path Visiting All Nodes: n <= 12, the standard alternative is Floyd-Warshall distances plus a mask DP
  ],
  'flow-matching': [
    'p785', // Is Graph Bipartite?: two-colouring is the entry test for bipartite matching, the row's walkthrough
  ],
}
