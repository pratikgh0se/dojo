// A value's history over the steps: (step, value) pairs in step order. at(k) is the value after events 1..k,
// found by binary search, so a view at any step costs O(log changes) per element and nothing is replayed
// from step 1 (C-VISUAL §6).
export class Timeline<T> {
  readonly ks: number[] = []
  readonly vs: T[] = []

  /** Records v as the value from step k on (k never decreases). */
  set(k: number, v: T): void {
    const n = this.ks.length
    if (n > 0 && this.ks[n - 1] === k) this.vs[n - 1] = v
    else {
      this.ks.push(k)
      this.vs.push(v)
    }
  }

  /** The value after events 1..k, or `fallback` before the first change. */
  at(k: number, fallback: T): T
  at(k: number): T | undefined
  at(k: number, fallback?: T): T | undefined {
    const ks = this.ks
    let lo = 0
    let hi = ks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ks[mid] <= k) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? fallback : this.vs[lo - 1]
  }

  /** The latest value recorded (the end state). */
  last(): T | undefined {
    return this.vs[this.vs.length - 1]
  }
}

/** How many of `addedAt` (ascending steps) are at or before step k. */
export function countAt(addedAt: number[], k: number): number {
  let lo = 0
  let hi = addedAt.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (addedAt[mid] <= k) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The indices 0..count-1 a large view draws: all of them when count ≤ cap, else a block of the cap around the
 * first current index (or from 0), plus every other current index (C-VISUAL §4.11: the current element is
 * always inside the window). Sorted ascending.
 */
export function windowIndices(count: number, cap: number, currents: number[]): number[] {
  const cur = currents.filter(i => i >= 0 && i < count)
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  const extra = new Set(cur)
  const size = Math.max(1, cap - Math.max(0, extra.size - 1))
  const anchor = cur.length ? cur[0] : 0
  const start = Math.max(0, Math.min(count - size, anchor - Math.floor(size / 2)))
  const out: number[] = []
  for (let i = start; i < start + size; i++) out.push(i)
  for (const i of extra) if (i < start || i >= start + size) out.push(i)
  return out.sort((a, b) => a - b)
}
