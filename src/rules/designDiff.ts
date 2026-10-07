interface DNode { id: string; kind: string; label?: string }
interface DLink { from: string; to: string; kind?: string }
export interface DiagramLike { nodes: DNode[]; links?: DLink[] }
export interface DiagramDiff { mine: string[]; ref: string[]; links: string[] }

const nodeText = (n: DNode) => `${n.kind} (${n.label ?? n.id})`

/** Nodes of `a` left over after matching kinds against `b` as a multiset, in `a`'s order. */
function unmatched(a: DNode[], b: DNode[]): DNode[] {
  const budget = new Map<string, number>()
  for (const n of b) budget.set(n.kind, (budget.get(n.kind) ?? 0) + 1)
  const out: DNode[] = []
  for (const n of a) {
    const left = budget.get(n.kind) ?? 0
    if (left > 0) budget.set(n.kind, left - 1)
    else out.push(n)
  }
  return out
}

/** "fromKind → toKind" → sorted link kinds (missing kind = sync). Links to unknown nodes are skipped. */
function linkKinds(d: DiagramLike): Map<string, string[]> {
  const kindOf = new Map(d.nodes.map(n => [n.id, n.kind]))
  const m = new Map<string, string[]>()
  for (const l of d.links ?? []) {
    const f = kindOf.get(l.from)
    const t = kindOf.get(l.to)
    if (!f || !t) continue
    const key = `${f} → ${t}`
    m.set(key, [...(m.get(key) ?? []), l.kind ?? 'sync'])
  }
  for (const v of m.values()) v.sort()
  return m
}

/** C-DESIGN §4.8: nodes by kind (multiset), links by (from-kind, to-kind). Information, not a score. */
export function diffDiagrams(mine: DiagramLike, ref: DiagramLike): DiagramDiff {
  const a = linkKinds(mine)
  const b = linkKinds(ref)
  const links: string[] = []
  for (const [key, kinds] of a) {
    const other = b.get(key)
    if (other && other.join(',') !== kinds.join(',')) links.push(`${key}: yours ${kinds.join(', ')}, reference ${other.join(', ')}`)
  }
  return { mine: unmatched(mine.nodes, ref.nodes).map(nodeText), ref: unmatched(ref.nodes, mine.nodes).map(nodeText), links }
}
