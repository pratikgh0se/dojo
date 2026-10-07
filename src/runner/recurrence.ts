// C-RUNNER §5: the recurrence line for the current write,
//   <name>[i] = <rule with dep names> = <rule with dep values> = <v>
// e.g. dp[3] = dp[2] + dp[1] = 2 + 1 = 3. Deps are <name>[i] in 1-D (rows = 1) and <name>[i][j] in 2-D.

export interface TableShape { name: string; rows: number; cols: number }

/** `dp[3]` for a 1-D table (rows = 1, the column is the index), `dp[2][3]` for 2-D. */
export function cellName(t: TableShape, i: number, j: number): string {
  return t.rows === 1 ? `${t.name}[${j}]` : `${t.name}[${i}][${j}]`
}

function fill(rule: string, parts: string[]): string {
  return rule.replace(/\{(\d+)\}/g, (m, k: string) => parts[Number(k)] ?? m)
}

/**
 * `valueOf(i, j)` is a dep's value just before the write (null when outside the table, shown as "?";
 * an unset cell reads 0, as tk's Get does).
 */
export function recurrenceText(
  t: TableShape,
  w: { i: number; j: number; v: number; deps: [number, number][]; rule?: string },
  valueOf: (i: number, j: number) => number | null,
): string {
  const lhs = cellName(t, w.i, w.j)
  if (w.rule === undefined) return `${lhs} = ${w.v}`
  const names = w.deps.map(([i, j]) => cellName(t, i, j))
  const values = w.deps.map(([i, j]) => {
    const v = valueOf(i, j)
    return v === null ? '?' : String(v)
  })
  // UAT r4 #11: a step that says nothing new is dropped: "dp[16] = dp[15] = 4", never "dp[16] = dp[15] = 4 = 4"
  const chain = [lhs, fill(w.rule, names), fill(w.rule, values), String(w.v)]
  return chain.filter((part, k) => k === 0 || part.trim() !== chain[k - 1].trim()).join(' = ')
}
