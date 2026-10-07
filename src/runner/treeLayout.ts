// ui-dp-view TL1–TL2: a tidy top-down layout for the call tree (and the family trees). Each node is a tile of its
// own width; siblings are packed as close as every shared level allows (gap 12), a parent is centred over its
// first and last child, and each case's whole tree is a block of its own (cases never interleave, 20 apart),
// with the case's label row above it. Pure geometry: no DOM, so it is the same in every engine and in tests.

export interface LayoutInput {
  /** stable key (dp-node-<n> uses n) */
  key: number
  /** index in the input of the parent, or -1 for a root */
  parent: number
  width: number
  /** the group (case) the node belongs to; roots of a group sit side by side under the group's label */
  group: number
}
export interface Placed { key: number; x: number; y: number; width: number; depth: number }
export interface GroupBox { group: number; left: number; right: number; cx: number; labelWidth: number }
export interface Layout { nodes: Placed[]; width: number; height: number; groups: GroupBox[]; top: number }

export const NODE_H = 32
export const LEVEL = 56 // 32 node + 24 gap
export const SIB_GAP = 12
export const GROUP_GAP = 20
/** Space Mono's advance (0.612 em) at 14 px, the tile's padding (0 8) and its border (2). */
export const CHAR_W = 8.6
export const tileWidth = (label: string, min = 72) => Math.max(min, Math.ceil(label.length * CHAR_W) + 16 + 4)
export const labelWidth = (label: string) => Math.ceil(label.length * CHAR_W)

type Contour = [number, number][] // per depth: [left, right] relative to the subtree root's centre

/** Offsets for each contour so neighbours never come closer than gap on any shared row. */
function pack(contours: Contour[], gap: number): number[] {
  const offs = [0]
  const acc: Contour = contours[0].map(c => [c[0], c[1]])
  for (let i = 1; i < contours.length; i++) {
    const C = contours[i]
    let off = -Infinity
    for (let d = 0; d < Math.min(acc.length, C.length); d++) off = Math.max(off, acc[d][1] + gap - C[d][0])
    if (off === -Infinity) off = 0
    offs.push(off)
    C.forEach((c, d) => {
      if (d < acc.length) { acc[d][0] = Math.min(acc[d][0], c[0] + off); acc[d][1] = Math.max(acc[d][1], c[1] + off) } else acc.push([c[0] + off, c[1] + off])
    })
  }
  return offs
}

/**
 * Lays out a forest. `labels` maps a group to its label text width (0 for none); `top` is the label row height
 * when any group has a label.
 */
export function layoutForest(input: LayoutInput[], labels: Map<number, number> = new Map()): Layout {
  const n = input.length
  const kids: number[][] = Array.from({ length: n }, () => [])
  const roots: number[] = []
  input.forEach((x, i) => (x.parent >= 0 && x.parent < n ? kids[x.parent].push(i) : roots.push(i)))
  const contour: Contour[] = new Array(n)
  const kidOff: number[][] = new Array(n)
  // post-order without recursion (deep call chains)
  const order: number[] = []
  const stack = [...roots].reverse()
  while (stack.length) {
    const i = stack.pop() as number
    order.push(i)
    for (let k = kids[i].length - 1; k >= 0; k--) stack.push(kids[i][k])
  }
  for (let o = order.length - 1; o >= 0; o--) {
    const i = order[o]
    const w = input[i].width
    if (!kids[i].length) { contour[i] = [[-w / 2, w / 2]]; kidOff[i] = []; continue }
    const cs = kids[i].map(k => contour[k])
    const offs = pack(cs, SIB_GAP)
    const mid = (offs[0] + offs[offs.length - 1]) / 2
    kidOff[i] = offs.map(x => x - mid)
    const C: Contour = [[-w / 2, w / 2]]
    cs.forEach((c, ci) => c.forEach((r, d) => {
      const L = r[0] + kidOff[i][ci]
      const R = r[1] + kidOff[i][ci]
      if (C[d + 1]) { C[d + 1][0] = Math.min(C[d + 1][0], L); C[d + 1][1] = Math.max(C[d + 1][1], R) } else C[d + 1] = [L, R]
    }))
    contour[i] = C
  }
  // a group's roots side by side, then whole groups as boxes (they never interleave)
  const groupsInOrder: number[] = []
  const rootsOf = new Map<number, number[]>()
  for (const r of roots) {
    const g = input[r].group
    if (!rootsOf.has(g)) { rootsOf.set(g, []); groupsInOrder.push(g) }
    rootsOf.get(g)!.push(r)
  }
  const anyLabel = groupsInOrder.some(g => (labels.get(g) ?? 0) > 0)
  const top = anyLabel ? 28 : 0
  const groupContour = new Map<number, { C: Contour; offs: number[] }>()
  for (const g of groupsInOrder) {
    const rs = rootsOf.get(g)!
    const offs = pack(rs.map(r => contour[r]), SIB_GAP)
    const mid = (offs[0] + offs[offs.length - 1]) / 2
    const C: Contour = []
    rs.forEach((r, ri) => contour[r].forEach((c, d) => {
      const L = c[0] + offs[ri] - mid
      const R = c[1] + offs[ri] - mid
      if (C[d]) { C[d][0] = Math.min(C[d][0], L); C[d][1] = Math.max(C[d][1], R) } else C[d] = [L, R]
    }))
    groupContour.set(g, { C, offs: offs.map(x => x - mid) })
  }
  const boxes = groupsInOrder.map(g => {
    const { C } = groupContour.get(g)!
    const lw = labels.get(g) ?? 0
    const L = Math.min(-lw / 2, ...C.map(c => c[0]))
    const R = Math.max(lw / 2, ...C.map(c => c[1]))
    return [[L, R]] as Contour
  })
  const goffs = boxes.length ? pack(boxes, GROUP_GAP) : []
  let minL = Infinity
  let maxR = -Infinity
  boxes.forEach((b, i) => { minL = Math.min(minL, b[0][0] + goffs[i]); maxR = Math.max(maxR, b[0][1] + goffs[i]) })
  if (!boxes.length) { minL = 0; maxR = 0 }
  const X0 = -minL + 2
  const placed: Placed[] = new Array(n)
  let maxDepth = 0
  const groups: GroupBox[] = []
  groupsInOrder.forEach((g, gi) => {
    const cx = goffs[gi] + X0
    const { offs } = groupContour.get(g)!
    groups.push({ group: g, left: boxes[gi][0][0] + cx, right: boxes[gi][0][1] + cx, cx, labelWidth: labels.get(g) ?? 0 })
    rootsOf.get(g)!.forEach((r, ri) => {
      const st: [number, number, number][] = [[r, cx + offs[ri], 0]]
      while (st.length) {
        const [i, x, d] = st.pop() as [number, number, number]
        maxDepth = Math.max(maxDepth, d)
        placed[i] = { key: input[i].key, x: x - input[i].width / 2, y: top + d * LEVEL, width: input[i].width, depth: d }
        kids[i].forEach((k, ki) => st.push([k, x + kidOff[i][ki], d + 1]))
      }
    })
  })
  const width = Math.ceil(maxR - minL + 4)
  const height = n ? top + maxDepth * LEVEL + NODE_H : 0
  return { nodes: placed, width, height, groups, top }
}

/** The orthogonal edge from a parent tile to a child tile: down 12, across, down into the child's top. */
export function edgePath(p: Placed, c: Placed): string {
  const px = p.x + p.width / 2
  const py = p.y + NODE_H
  const cx = c.x + c.width / 2
  return `${px},${py} ${px},${py + 12} ${cx},${py + 12} ${cx},${c.y}`
}
