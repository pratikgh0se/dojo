// The trace band (ui-dp-view.md; C-RUNNER §5, C-VISUAL §3): a panel of its own titled "Trace", with the step
// controls, the recurrence strip, the bottom-up table pane(s) with index labels and dependency arrows, the
// top-down call tree as a real tree (one per case), the cell↔node mapping, the legend, and the family panels.
// Lazy-loaded; it opens on Step N. Every state reflects the true step k; wide content scrolls inside its pane.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../ui/primitives'
import { latestWrite, nodeCell, nodesAt, nodeText, tablesAt, tableViewFor, tableWindow, type DpModel, type TableView, type TreeNode } from './dpModel'
import { cellName } from './recurrence'
import { buildStepModel, caseLabels, narrate } from './stepModel'
import { edgePath, labelWidth, layoutForest, LEVEL, NODE_H, tileWidth, type Placed } from './treeLayout'
import type { Step } from './types'
import './trace.css'

export const TREE_CAP = 600
const MAX_ROWS = 16
const MAX_COLS_2D = 16
const MAX_COLS_1D = 40
/** F3.3: Play advances one step every 600 ms. */
export const PLAY_MS = 600
/** C-VISUAL §6: the family panels load only after a run with family steps. */
const FamilyPanels = lazy(() => import('./families/FamilyPanels'))

type Pick = { kind: 'cell'; t: number; i: number; j: number } | { kind: 'node'; n: number } | null
type CellRef = { t: number; i: number; j: number }

const isTextField = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e) return false
  if (e.isContentEditable) return true
  if (e.tagName === 'TEXTAREA') return true
  if (e.tagName === 'INPUT') return (e as HTMLInputElement).type !== 'range'
  return false
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const sameCell = (a: CellRef | null, t: number, i: number, j: number) => a !== null && a.t === t && a.i === i && a.j === j

export default function DpView({ steps, caseCalls = {} }: { steps: Step[]; caseCalls?: Record<number, string> }) {
  const sm = useMemo(() => buildStepModel(steps), [steps])
  const m = sm.dp
  const N = sm.N
  // UAT J4 / r3: the narration names the case and its input ('Case 2 of 5 ("226") · write dp[3] ← 3')
  const caseKey = Object.entries(caseCalls).map(([id, call]) => `${id}\u0000${call}`).join('\u0001')
  const cases = useMemo(
    () => caseLabels(steps, Object.keys(caseCalls).map(Number).sort((a, b) => a - b), caseCalls),
    [steps, caseKey], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const said = (at: number) => (cases[at] ? `${cases[at]} · ${narrate(sm, at)}` : narrate(sm, at))
  // UAT cu-5 P2-1: the last step of the case step k belongs to (the whole run when it has no cases)
  const caseStarts = useMemo(() => steps.flatMap((x, i) => (x.case !== undefined ? [i + 1] : [])), [steps])
  const caseEnd = (at: number) => {
    const nextStart = caseStarts.find(c => c > at)
    return nextStart === undefined ? N : nextStart - 1
  }
  const [k, setK] = useState(N)
  const [playing, setPlaying] = useState(false)
  const [pick, setPick] = useState<Pick>(null)
  const [peer, setPeer] = useState<Pick>(null)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setK(x => {
      if (x >= N) { setPlaying(false); return x }
      return x + 1
    }), PLAY_MS)
    return () => clearInterval(id)
  }, [playing, N])

  const scrubRef = useRef<HTMLInputElement>(null)
  // UAT J4/J5: the trace never gets shorter while it is stepped (a shorter step, or a smaller case, used to pull the page
  // up under the pointer, so Previous step landed on Submit). Its height is the tallest it has been in this run.
  const viewRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let max = 0 // 0 until the layout has settled: the first commit is not the layout that stays (below)
    let frame = 0
    // Hold from the first settled frame, not the first commit: the panes start stacked until they are measured, and a height
    // taken then (cu-4 P3-15: 250 px of empty panel under the legend after the last step) would never shrink back. A change of
    // the window's width (stacked to side by side, or back) starts the hold again for the same reason.
    const settle = () => {
      el.style.minHeight = ''
      max = Math.ceil(el.getBoundingClientRect().height)
      el.style.minHeight = `${max}px`
    }
    const restart = () => { cancelAnimationFrame(frame); max = 0; el.style.minHeight = ''; frame = requestAnimationFrame(settle) }
    restart()
    let width = window.innerWidth
    const onResize = () => { if (window.innerWidth !== width) { width = window.innerWidth; restart() } }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(() => { const h = Math.ceil(el.getBoundingClientRect().height); if (max > 0 && h > max) { max = h; el.style.minHeight = `${max}px` } })
    ro.observe(el)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); ro.disconnect() }
  }, [])
  const step = useCallback((to: number) => {
    const next = Math.max(1, Math.min(N, to))
    // K2: a focused Previous/Next that is about to be disabled hands focus to the scrubber, so Home/End
    // and the arrows keep working from inside the band
    const a = document.activeElement as HTMLElement | null
    if (a && ((next >= N && a.classList.contains('dp-next')) || (next <= 1 && a.classList.contains('dp-prev')))) scrubRef.current?.focus()
    setPlaying(false)
    setK(next)
  }, [N])
  const play = () => {
    if (playing) { setPlaying(false); return }
    if (k >= N) setK(1)
    setPlaying(true)
  }

  const tableIds = m.hasTable ? tablesAt(m, k) : []
  const views = tableIds.map(id => tableViewFor(m, id, k))
  // UAT cu-5 P2-1: the width the layout is judged on is the tables' at the case's last step (values only grow longer), so a
  // value gaining a digit never flips the panes between side by side and stacked in the middle of a case
  const ce = caseEnd(k)
  const drawnKey = tableIds.join(',')
  const sizing = useMemo(() => (m.hasTable ? tablesAt(m, ce).map(id => tableViewFor(m, id, ce)) : []), [m, ce])
  // M9: a pressed cell belongs to a table drawn at this step; drop it when that table is gone.
  useEffect(() => { setPick(p => (p?.kind === 'cell' && !tableIds.includes(p.t) ? null : p)) }, [drawnKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // the linked table: the drawn one a tk.Link names
  const linkedView = views.find(v => m.links.some(l => l.table === v.table.name)) ?? null
  const link = linkedView ? m.links.find(l => l.table === linkedView.table.name) ?? null : null
  const ev = steps[k - 1]
  const hasTree = m.hasTree
  const both = views.length > 0 && hasTree

  const nodeOf = (p: Pick) => (p?.kind === 'node' ? m.nodes.find(x => x.n === p.n) ?? null : null)
  const cellOfNode = (nd: TreeNode | null): CellRef | null => {
    if (!nd || !linkedView) return null
    const c = nodeCell(m, nd, linkedView.table.name)
    return c ? { t: linkedView.table.t, i: c[0], j: c[1] } : null
  }
  const curNode = useMemo(() => currentNode(m, k), [m, k])
  const callCell = cellOfNode(curNode)
  const callKind: 'current' | 'hit' | null = curNode ? (curNode.hit ? 'hit' : 'current') : null
  const pickedNode = nodeOf(pick)
  const linkedCell = cellOfNode(pickedNode)
  const peerCell = cellOfNode(nodeOf(peer))
  const pressedCell: CellRef | null = pick?.kind === 'cell' ? pick : linkedCell
  const cellRec = pressedCell ? cellRecurrence(m, pressedCell.t, pressedCell.i, pressedCell.j, k) : null

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (isTextField(e.target)) return
    const t = e.target as HTMLElement
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (t.closest('[data-roving]') || (t as HTMLInputElement).type === 'range') return
      e.preventDefault(); step(k + (e.key === 'ArrowRight' ? 1 : -1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); step(e.key === 'Home' ? 1 : N)
    } else if (e.key === ' ' && !t.closest('button')) {
      e.preventDefault(); play()
    }
  }

  // M2 / ruling 7 Q19 / ruling 17: while a cell or node is pressed, Esc clears the press whatever has focus (the
  // page body included; not in a text field or a dialog) and is used up, so Do's own Esc (which leaves) sees it as
  // handled. A window capture listener runs before Do's window listener, wherever the key was pressed.
  useEffect(() => {
    if (!pick) return
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTextField(e.target)) return
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"], [role="alertdialog"]')) return
      e.preventDefault()
      setPick(null)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [pick])

  const legend: [string, string][] = views.length === 0 && hasTree
    ? [['called', 'Called now'], ['hit', 'Cache hit'], ['stack', 'On the call stack']]
    : [['current', 'Written now'], ['dep', 'Depends on'], ...(hasTree ? [['hit', 'Cache hit'] as [string, string]] : []), ['selected', 'Selected'], ...(both && link ? [['linked', 'Linked'] as [string, string]] : [])]
  const dp = views.length > 0 || hasTree

  return (
    <section ref={viewRef} className="sr-panel dp-view" data-testid="dp-view" aria-label="Trace" onKeyDown={onKey}>
      <h2 className="sr-panel-title">Trace</h2>
      <div className="dp-controls">
        <Button className="dp-prev" onClick={() => step(k - 1)} disabled={k <= 1}>Previous step</Button>
        <Button className="dp-play" variant="accent" aria-pressed={playing} onClick={play}>{playing ? 'Pause' : 'Play'}</Button>
        <Button className="dp-next" onClick={() => step(k + 1)} disabled={k >= N}>Next step</Button>
        <span className="dp-step-counter" data-testid="dp-step-counter" style={{ minWidth: `${Math.max(15, 8 + 2 * String(N).length)}ch` }}>Step {k} / {N}</span>
        <input
          ref={scrubRef} type="range" min={1} max={N} value={k} aria-label="Step" className="dp-scrub" data-testid="dp-scrubber"
          style={{ ['--fill' as string]: `${N > 1 ? ((k - 1) / (N - 1)) * 100 : 100}%` }}
          onChange={e => step(Number(e.target.value))}
          onKeyDown={e => {
            // C-VISUAL Addendum 1 Q4: Home is Step 1, End is Step N
            if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); step(e.key === 'Home' ? 1 : N) }
          }}
        />
      </div>
      {dp ? (
        <div className="dp-strip">
          {views.length > 0 && <p className="dp-recurrence" data-testid="dp-recurrence">{views.find(v => v.recurrence)?.recurrence ?? ''}</p>}
          {/* UAT cu-4 P3-16: the SELECTED line's row is always there on a trace with a table (R2 says it shows only while a cell is
              pressed: its text does), so pressing a cell never pushes the panes down and a second click lands on the same pixel */}
          {views.length > 0 && (
            <div className="dp-selected-slot">
              {cellRec !== null && (
                <p className="dp-selected-line"><span className="dp-selected-label">Selected</span> <span className="dp-cell-recurrence" data-testid="dp-cell-recurrence">{cellRec}</span></p>
              )}
            </div>
          )}
          <p className="dp-narration" data-testid="dp-narration" aria-live="polite">{said(k)}</p>
        </div>
      ) : (
        // families only: each panel's caption says what the step did, so the narration is for screen readers only
        <p className="dp-narration vh" data-testid="dp-narration" aria-live="polite">{said(k)}</p>
      )}
      {/* UAT cu-5 P3-6: a family trace with several cases says which case is on screen (the structures change at a case boundary);
          the line is there on every step, so it never moves the panes */}
      {!dp && sm.fam && Object.keys(caseCalls).length > 1 && (
        <p className="dp-case" data-testid="dp-case" aria-hidden="true">{cases[k] ?? ''}</p>
      )}
      {dp && (
        <Panes sizing={sizing} hasTree={hasTree}>
          {compact => (
            <>
              {views.length > 0 && (
                <div className="dp-tables">
                  {views.map(v => (
                    <TablePane
                      key={v.table.t} m={m} k={k} tv={v} ev={ev} pick={pick} compact={compact}
                      linkedCell={linkedCell} peerCell={peerCell} callCell={callCell} callKind={callKind}
                      onPick={(i, j) => setPick(p => (p?.kind === 'cell' && sameCell(p, v.table.t, i, j) ? null : { kind: 'cell', t: v.table.t, i, j }))}
                      onPeer={setPeer}
                    />
                  ))}
                </div>
              )}
              {hasTree && (
                <TreePane
                  m={m} k={k} reserveAt={caseEnd(k)} cur={curNode} caseCalls={caseCalls} pick={pick} peer={peer}
                  cellOf={cellOfNode} onPick={n => setPick(p => (p?.kind === 'node' && p.n === n ? null : { kind: 'node', n }))} onPeer={setPeer}
                />
              )}
            </>
          )}
        </Panes>
      )}
      {dp && (
        <div className="dp-maprow">
          <div className="dp-mapcol">
            {both && link && linkedView && (
              // M1 / Q6: dp-mapping (Chivo 15 secondary) holds the formula (Space Mono 15 primary), then the hint
              <p className="dp-mapping" data-testid="dp-mapping">
                <span className="dp-mapping-formula">{linkedView.table.rows === 1 ? `${link.fn}(i) ↔ ${link.table}[i]` : `${link.fn}(i, j) ↔ ${link.table}[i][j]`}</span>
                <span className="dp-mapping-hint"> · press a cell or a call to link them</span>
              </p>
            )}
            {/* cu-4 P3-16: its row is held too, so a press does not push what is under the trace down either */}
            {both && (
              <div className="dp-summary-slot">
                {pick && <p className="dp-link-summary" data-testid="dp-link-summary">{linkSummary(m, k, pick, linkedView, cellOfNode(pickedNode))}</p>}
              </div>
            )}
          </div>
          <ul className="dp-legend" data-testid="dp-legend" aria-label="Legend">
            {legend.map(([cls, label]) => <li key={cls}><i className={`dp-sw dp-sw-${cls}`} aria-hidden="true" />{label}</li>)}
          </ul>
        </div>
      )}
      {m.unexited > 0 && <p className="dp-note" data-testid="dp-unexited">{plural(m.unexited, 'call never returned', 'calls never returned')}</p>}
      {sm.fam && (
        <Suspense fallback={<p className="dp-note">Loading the views…</p>}>
          <div className="fam-grid">
            <FamilyPanels m={sm.fam} k={k} />
          </div>
        </Suspense>
      )}
    </section>
  )
}

/** The call the event at step k is about: the node entered or hit at k, else the one that returned at k. */
function currentNode(m: DpModel, k: number): TreeNode | null {
  const c = nodesAt(m, k)
  const last = c > 0 ? m.nodes[c - 1] : null
  if (last && last.n === k) return last
  for (let i = c - 1; i >= 0; i--) if (m.nodes[i].exitAt === k) return m.nodes[i]
  return null
}

/** R2: the recurrence of (i, j)'s latest write at or before step k, or "dp[i] is not written yet". */
function cellRecurrence(m: DpModel, t: number, i: number, j: number, k: number): string {
  const table = m.tables.get(t)
  if (!table) return ''
  const at = latestWrite(m, t, i, j, k)
  if (at === null) return `${cellName(table, i, j)} is not written yet`
  return tableViewFor(m, t, at).recurrence
}

/** M3: the link summary line for the pressed cell or node. */
function linkSummary(m: DpModel, k: number, pick: NonNullable<Pick>, lv: TableView | null, nodeCellRef: CellRef | null): string {
  if (!lv) return ''
  const t = lv.table
  if (pick.kind === 'cell') {
    const nodes = m.nodes.filter(n => {
      if (n.n > k) return false
      const c = nodeCell(m, n, t.name)
      return c !== null && c[0] === pick.i && c[1] === pick.j
    })
    const calls = nodes.filter(n => !n.hit).length
    const hits = nodes.filter(n => n.hit).length
    const fn = m.links.find(l => l.table === t.name)?.fn ?? 'f'
    const callText = t.rows === 1 ? `${fn}(${pick.j})` : `${fn}(${pick.i}, ${pick.j})`
    // M3 / M14: both counts, always; a zero is written as words
    const parts = [calls === 0 ? 'no calls yet' : plural(calls, 'computed call', 'computed calls'), hits === 0 ? 'no cache hits' : plural(hits, 'cache hit', 'cache hits')]
    return `${cellName(t, pick.i, pick.j)} ↔ ${callText}: ${parts.join(', ')}`
  }
  const node = m.nodes.find(n => n.n === pick.n)
  if (!node || !nodeCellRef) return ''
  const v = tableViewFor(m, nodeCellRef.t, k).values.get(nodeCellRef.i * t.cols + nodeCellRef.j)
  return `${node.fn}(${node.args.join(', ')}) ↔ ${cellName(t, nodeCellRef.i, nodeCellRef.j)}${v === undefined ? ' (empty)' : ` = ${v}`}`
}

function keepInView(sc: HTMLElement, el: HTMLElement) {
  const s = sc.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  // sim-align F4: a 2-D table's sticky row-index column and header row cover the pane's left and top edges, so the
  // visible area starts after them (otherwise column 0's current cell hides under the index column)
  const stickyRow = sc.querySelector<HTMLElement>('.dp-2d .dp-row, .dp-2d .dp-corner')
  const stickyHead = sc.querySelector<HTMLElement>('.dp-2d thead th')
  const left = s.left + (stickyRow ? stickyRow.getBoundingClientRect().width : 0)
  const top = s.top + (stickyHead ? stickyHead.getBoundingClientRect().height : 0)
  if (e.right > s.left + sc.clientWidth - 8) sc.scrollLeft += e.right - (s.left + sc.clientWidth) + 12
  if (e.left < left + 8) sc.scrollLeft -= left - e.left + 12
  if (e.bottom > s.top + sc.clientHeight - 8) sc.scrollTop += e.bottom - (s.top + sc.clientHeight) + 12
  if (e.top < top + 8) sc.scrollTop -= top - e.top + 12
}

// ---------------------------------------------------------------- panes and layout (L1, I3)

/** The width a table needs at regular or compact size, its pane's padding and border included. */
export function tableNeedWidth(tv: TableView, compact: boolean): number {
  const t = tv.table
  const cols = Math.min(t.cols, t.rows === 1 ? MAX_COLS_1D : MAX_COLS_2D)
  const maxLen = Math.max(1, ...[...tv.values.values()].map(v => String(v).length))
  const cellW = Math.max(compact ? 36 : 48, maxLen * 9 + (compact ? 12 : 16))
  const w = t.rows === 1 ? cols * (cellW + 4) : 32 + cols * (cellW + (compact ? 12 : 16))
  return w + 28
}

function Panes({ sizing, hasTree, children }: { sizing: TableView[]; hasTree: boolean; children: (compact: boolean) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => { setW(el.clientWidth); setVw(window.innerWidth) }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const twoD = sizing.some(v => v.table.rows > 1)
  let mode: 'one' | 'side' | 'stack' = sizing.length && hasTree ? 'stack' : 'one'
  let compact = false
  if (sizing.length && hasTree && vw >= 1100 && w > 0) {
    // L1: side by side only when every table fits its column at regular or compact size
    const col = twoD ? ((w - 24) * 7) / 12 : (w - 24) / 2
    if (sizing.every(v => tableNeedWidth(v, false) <= col)) mode = 'side'
    else if (sizing.every(v => tableNeedWidth(v, true) <= col)) { mode = 'side'; compact = true }
  }
  if (mode !== 'side' && w > 0) compact = sizing.some(v => tableNeedWidth(v, false) > w) && sizing.every(v => tableNeedWidth(v, true) <= w)
  return (
    <div ref={host} className={`dp-panes dp-panes-${mode}${twoD ? ' dp-panes-2d' : ''}`} data-layout={mode}>
      {children(compact)}
    </div>
  )
}

// ---------------------------------------------------------------- the table pane (P1–P2, I, C, A)

type Arrow = { id: string; kind: 'current' | 'selected'; points: string; head: string; tick: string; width: number }

function TablePane({ m, k, tv, ev, pick, compact, linkedCell, peerCell, callCell, callKind, onPick, onPeer }: {
  m: DpModel; k: number; tv: TableView; ev: Step | undefined; pick: Pick; compact: boolean
  linkedCell: CellRef | null; peerCell: CellRef | null; callCell: CellRef | null; callKind: 'current' | 'hit' | null
  onPick: (i: number, j: number) => void; onPeer: (p: Pick) => void
}) {
  const { table, values, current, deps, focus } = tv
  const oneD = table.rows === 1
  const win = tableWindow(table, focus, oneD ? 1 : MAX_ROWS, oneD ? MAX_COLS_1D : MAX_COLS_2D)
  const rows = Array.from({ length: win.R }, (_, r) => win.r0 + r)
  const cols = Array.from({ length: win.C }, (_, c) => win.c0 + c)
  const clipped = win.R < table.rows || win.C < table.cols
  const read = ev && ev.op === 'get' && ev.t === table.t ? [ev.i, ev.j] : null
  const isDep = (i: number, j: number) => deps.some(([a, b]) => a === i && b === j)
  const wrap = useRef<HTMLDivElement>(null)
  const sc = useRef<HTMLDivElement>(null)
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [size, setSize] = useState<[number, number]>([0, 0])
  const [focusIJ, setFocusIJ] = useState<[number, number]>([rows[0] ?? 0, cols[0] ?? 0])

  // A1: the arrows of the current write (green), or of the selected cell's latest write (yellow)
  const specs = useMemo(() => {
    const out: { fi: number; fj: number; ti: number; tj: number; kind: 'current' | 'selected' }[] = []
    let selTarget: [number, number] | null = null
    if (pick?.kind === 'cell' && pick.t === table.t) {
      const at = latestWrite(m, table.t, pick.i, pick.j, k)
      const w = at ? m.steps[at - 1] : null
      if (w && w.op === 'set') { selTarget = [w.i, w.j]; for (const [i, j] of w.deps) out.push({ fi: i, fj: j, ti: w.i, tj: w.j, kind: 'selected' }) }
    }
    if (current && !(selTarget && selTarget[0] === current[0] && selTarget[1] === current[1])) {
      for (const [i, j] of deps) out.push({ fi: i, fj: j, ti: current[0], tj: current[1], kind: 'current' })
    }
    return out
  }, [m, k, pick, table.t, current, deps])

  useLayoutEffect(() => {
    const root = wrap.current
    if (!root) return
    const rb = root.getBoundingClientRect()
    setSize([root.scrollWidth, root.scrollHeight])
    const cellRect = (i: number, j: number) => {
      const el = root.querySelector<HTMLElement>(`[data-ij="${i}-${j}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - rb.left, y: r.top - rb.top, w: r.width, h: r.height }
    }
    const out: Arrow[] = []
    const byTarget = new Map<string, typeof specs>()
    for (const s of specs) {
      const key = `${s.ti}-${s.tj}-${s.kind}`
      byTarget.set(key, [...(byTarget.get(key) ?? []), s])
    }
    for (const group of byTarget.values()) {
      if (oneD) group.sort((a, b) => Math.abs(a.fj - a.tj) - Math.abs(b.fj - b.tj))
      group.forEach((s, idx) => {
        const t = cellRect(s.ti, s.tj)
        if (!t) return
        const f = cellRect(s.fi, s.fj)
        const id = `${s.fi}-${s.fj}-${s.ti}-${s.tj}`
        const width = s.kind === 'current' ? 3 : 2
        if (oneD) {
          // A3: rise from the dep's top centre to the lane, across, and drop into the target's top edge
          const top = t.y
          const lane = top - Math.min(12 + 12 * idx, 36)
          const ex = t.x + t.w / 2 + (idx - (group.length - 1) / 2) * 8
          // A5: a dep outside the window starts at the window edge, with a 6 px tick
          const sx = f ? f.x + f.w / 2 : s.fj < s.tj ? 1 : rb.width - 1
          const pts = f ? `${sx},${top} ${sx},${lane} ${ex},${lane} ${ex},${top - 8}` : `${sx},${lane} ${ex},${lane} ${ex},${top - 8}`
          out.push({ id, kind: s.kind, width, points: pts, head: `${ex},${top} ${ex - 4},${top - 8} ${ex + 4},${top - 8}`, tick: f ? '' : `${sx},${lane - 3} ${sx},${lane + 3}` })
        } else {
          const fr = f ?? (() => {
            // A5: an off-window dep is drawn from the window edge it lies beyond
            const cx = s.fj < cols[0] ? -t.w : s.fj > cols[cols.length - 1] ? rb.width : t.x
            const cy = s.fi < rows[0] ? -t.h : s.fi > rows[rows.length - 1] ? rb.height : t.y
            return { x: cx, y: cy, w: t.w, h: t.h }
          })()
          const fx = fr.x + fr.w / 2, fy = fr.y + fr.h / 2, tx = t.x + t.w / 2, ty = t.y + t.h / 2
          const dx = tx - fx, dy = ty - fy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
          const clip = (r: { w: number; h: number }) => Math.min(ux ? r.w / 2 / Math.abs(ux) : Infinity, uy ? r.h / 2 / Math.abs(uy) : Infinity)
          const s0 = f ? clip(fr) + 1 : clip(fr), s1 = clip(t) + 1
          const x0 = fx + ux * s0, y0 = fy + uy * s0, x1 = tx - ux * s1, y1 = ty - uy * s1
          const a = Math.atan2(uy, ux), bx = x1 - 8 * Math.cos(a), by = y1 - 8 * Math.sin(a)
          out.push({
            id, kind: s.kind, width, points: `${x0},${y0} ${x1 - ux * 7},${y1 - uy * 7}`,
            head: `${x1},${y1} ${bx + 4 * Math.sin(a)},${by - 4 * Math.cos(a)} ${bx - 4 * Math.sin(a)},${by + 4 * Math.cos(a)}`,
            tick: f ? '' : `${x0 - 3 * Math.sin(a)},${y0 + 3 * Math.cos(a)} ${x0 + 3 * Math.sin(a)},${y0 - 3 * Math.cos(a)}`,
          })
        }
      })
    }
    setArrows(out)
    // I3: keep the current cell in view (instant, nearest)
    const curEl = current ? root.querySelector<HTMLElement>(`[data-ij="${current[0]}-${current[1]}"]`) : null
    if (curEl && sc.current) keepInView(sc.current, curEl)
  }, [specs, k, compact, oneD, current, table.cols, table.rows, values.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, j: number, di: number, dj: number) => {
    const ni = Math.max(rows[0], Math.min(rows[rows.length - 1], i + di))
    const nj = Math.max(cols[0], Math.min(cols[cols.length - 1], j + dj))
    setFocusIJ([ni, nj])
    wrap.current?.querySelector<HTMLElement>(`[data-ij="${ni}-${nj}"]`)?.focus()
  }
  const tabIJ: [number, number] = rows.includes(focusIJ[0]) && cols.includes(focusIJ[1]) ? focusIJ : [rows[0] ?? 0, cols[0] ?? 0]

  const cell = (i: number, j: number) => {
    const v = values.get(i * table.cols + j)
    const state = current && current[0] === i && current[1] === j ? 'current' : v === undefined ? 'empty' : 'set'
    const pressed = pick?.kind === 'cell' && sameCell(pick, table.t, i, j)
    const call = sameCell(callCell, table.t, i, j) ? callKind : null
    return (
      <button
        type="button" className="dp-cell" data-testid={`dp-cell-${i}-${j}`} data-ij={`${i}-${j}`} data-state={state}
        data-dep={current && isDep(i, j) ? 'true' : undefined} data-read={read && read[0] === i && read[1] === j ? 'true' : undefined}
        data-linked={sameCell(linkedCell, table.t, i, j) ? 'true' : 'false'} data-call={call ?? undefined}
        data-peer={sameCell(peerCell, table.t, i, j) ? 'true' : undefined}
        aria-pressed={pressed} aria-label={`${cellName(table, i, j)}${v === undefined ? ' (empty)' : ` = ${v}`}`}
        tabIndex={tabIJ[0] === i && tabIJ[1] === j ? 0 : -1}
        onClick={() => { setFocusIJ([i, j]); onPick(i, j) }}
        onMouseEnter={() => onPeer({ kind: 'cell', t: table.t, i, j })} onMouseLeave={() => onPeer(null)}
        onFocus={() => { setFocusIJ([i, j]); onPeer({ kind: 'cell', t: table.t, i, j }) }} onBlur={() => onPeer(null)}
        onKeyDown={e => {
          // K1: arrows rove from this cell (however it got focus)
          const d: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
          if (d[e.key]) { e.preventDefault(); e.stopPropagation(); move(i, j, d[e.key][0], d[e.key][1]) }
        }}
      >{v === undefined ? '' : v}</button>
    )
  }
  const note = clipped && (oneD
    ? `Showing columns ${win.c0}–${win.c0 + win.C - 1} of ${table.cols}, around the latest write`
    : `Showing rows ${win.r0}–${win.r0 + win.R - 1} and columns ${win.c0}–${win.c0 + win.C - 1} of ${table.rows} × ${table.cols}`)
  return (
    <div className="dp-pane dp-table-pane" data-testid="dp-table-pane">
      <div className="dp-pane-head">
        <span className="dp-pane-label">Bottom-up · {table.name}</span>
        <span className="dp-pane-meta">{table.rows} × {table.cols}</span>
      </div>
      {note && <p className="dp-note" data-testid="dp-note">{note}</p>}
      <div className="dp-sc sc" ref={sc}>
        <div className={`dp-table-wrap ${oneD ? 'dp-1d' : 'dp-2d'}${compact ? ' dp-compact' : ''}`} ref={wrap} data-roving="table">
          <table className="dp-table" data-testid="dp-table" aria-label={`Table ${table.name}`}>
            {oneD ? (
              <tbody>
                <tr>{cols.map(j => <td key={j}>{cell(0, j)}</td>)}</tr>
                <tr className="dp-idx-row">{cols.map(j => <td key={j} className="dp-col" data-testid={`dp-col-${j}`}>{j}</td>)}</tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr>
                    <th className="dp-corner" scope="col">i \ j</th>
                    {cols.map(j => <th key={j} className="dp-col" data-testid={`dp-col-${j}`} scope="col">{j}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(i => (
                    <tr key={i}>
                      <th className="dp-row" data-testid={`dp-row-${i}`} scope="row">{i}</th>
                      {cols.map(j => <td key={j}>{cell(i, j)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          <svg className="dp-arrows" data-testid="dp-arrows" aria-hidden="true" width={size[0]} height={size[1]} viewBox={`0 0 ${size[0] || 1} ${size[1] || 1}`}>
            {arrows.map(a => (
              <g key={`${a.id}-${a.kind}`} data-testid={`dp-arrow-${a.id}`} data-kind={a.kind} className={`dp-arrow dp-arrow-${a.kind}`}>
                <polyline points={a.points} fill="none" strokeWidth={a.width} strokeLinecap="square" strokeLinejoin="miter" />
                {a.tick && <polyline points={a.tick} fill="none" strokeWidth={a.width} strokeLinecap="square" />}
                <polygon points={a.head} />
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the tree pane (P3, C3–C5, TL1–TL4, W2)

/**
 * UAT cu-5 P2-1 (one size per case): the height the call tree has at the last step of step k's case. Calls are only ever
 * added, so that is the most it reaches in the case; the pane holds it from the case's first step.
 */
function treeReserve(m: DpModel, reserveAt: number, caseCalls: Record<number, string>): number {
  const count = nodesAt(m, reserveAt)
  let depth = -1
  let label = false
  for (let i = Math.max(0, count - TREE_CAP); i < count; i++) {
    depth = Math.max(depth, m.nodes[i].depth)
    if (caseCalls[m.nodes[i].caseId]) label = true
  }
  return depth < 0 ? 0 : (label ? 28 : 0) + depth * LEVEL + NODE_H
}

function TreePane({ m, k, reserveAt, cur, caseCalls, pick, peer, cellOf, onPick, onPeer }: {
  m: DpModel; k: number; reserveAt: number; cur: TreeNode | null; caseCalls: Record<number, string>; pick: Pick; peer: Pick
  cellOf: (n: TreeNode | null) => CellRef | null; onPick: (n: number) => void; onPeer: (p: Pick) => void
}) {
  const count = nodesAt(m, k)
  const curIdx = cur ? m.nodes.indexOf(cur) : -1
  // W2: the latest 600 calls, plus the current call's ancestors so its path to the root is whole
  const idxs = useMemo(() => {
    const keep = new Set<number>()
    for (let i = Math.max(0, count - TREE_CAP); i < count; i++) keep.add(i)
    for (let i = curIdx; i >= 0; i = m.nodes[i].parent) keep.add(i)
    return [...keep].sort((a, b) => a - b)
  }, [m, count, curIdx])
  const labels = idxs.map(i => nodeText(m.nodes[i], k))
  const lay = useMemo(() => {
    const pos = new Map(idxs.map((i, p) => [i, p]))
    const groups = new Map<number, number>()
    for (const i of idxs) { const g = m.nodes[i].caseId; if (!groups.has(g)) groups.set(g, labelWidth(caseCalls[g] ?? '')) }
    return layoutForest(idxs.map((i, p) => ({ key: m.nodes[i].n, parent: pos.get(m.nodes[i].parent) ?? -1, width: tileWidth(labels[p]), group: m.nodes[i].caseId })), groups)
  }, [idxs, labels.join('\u0000'), caseCalls]) // eslint-disable-line react-hooks/exhaustive-deps
  const reserve = useMemo(() => treeReserve(m, reserveAt, caseCalls), [m, reserveAt, caseCalls])
  const caseNow = count > 0 ? m.nodes[count - 1].caseId : 0
  const onStack = (nd: TreeNode) => !nd.hit && nd.n <= k && (nd.exitAt === null || nd.exitAt > k) && nd.caseId === caseNow
  // C5: the edges from the root to the current node are on the call stack
  const stackSet = new Set<number>()
  for (let i = curIdx; i >= 0; i = m.nodes[i].parent) stackSet.add(i)
  const hits = m.nodes.slice(0, count).filter(n => n.hit).length
  const pressedCell = pick?.kind === 'cell' ? pick : null
  const peerCell = peer?.kind === 'cell' ? peer : null
  const sc = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const byKey = new Map<number, Placed>(lay.nodes.map(p => [p.key, p]))

  // TL4: follow the step: the current case's whole tree when it fits, else the current node (instant, nearest)
  useLayoutEffect(() => {
    const s = sc.current
    if (!s) return
    const g = lay.groups.find(x => x.group === caseNow)
    if (g && g.right - g.left <= s.clientWidth && (g.left < s.scrollLeft || g.right > s.scrollLeft + s.clientWidth)) {
      s.scrollLeft = Math.max(0, g.left - (s.clientWidth - (g.right - g.left)) / 2)
    }
    const el = cur ? canvas.current?.querySelector<HTMLElement>(`[data-testid="dp-node-${cur.n}"]`) : null
    if (el) keepInView(s, el)
    else if (g && g.right - g.left > s.clientWidth) s.scrollLeft = Math.max(0, g.cx - s.clientWidth / 2) // a table-write step: the current case's root
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps

  const [focusN, setFocusN] = useState<number | null>(null)
  const shown = idxs.map(i => m.nodes[i])
  const tabN = focusN !== null && shown.some(x => x.n === focusN) ? focusN : shown[0]?.n ?? null
  const move = (from: TreeNode, key: string) => {
    const fi = m.nodes.indexOf(from)
    const fam = shown.filter(x => x.parent === from.parent && (from.parent >= 0 || x.caseId === from.caseId))
    const to = key === 'ArrowUp' ? (from.parent >= 0 ? m.nodes[from.parent] : undefined)
      : key === 'ArrowDown' ? shown.find(x => x.parent === fi)
        : fam[fam.indexOf(from) + (key === 'ArrowLeft' ? -1 : 1)]
    if (to) canvas.current?.querySelector<HTMLElement>(`[data-testid="dp-node-${to.n}"]`)?.focus()
  }

  return (
    <div className="dp-pane dp-tree-pane" data-testid="dp-tree-pane">
      <div className="dp-pane-head">
        <span className="dp-pane-label">Top-down · calls</span>
        <span className="dp-pane-meta">{plural(count, 'call', 'calls')} · {plural(hits, 'cache hit', 'cache hits')}</span>
      </div>
      {count > TREE_CAP && <p className="dp-note" data-testid="dp-note">Showing the latest {TREE_CAP} of {count} calls</p>}
      <div className="dp-sc dp-tree-sc sc" ref={sc}>
        <div className="dp-tree" data-testid="dp-tree" aria-label="Call tree" role="tree" ref={canvas} data-roving="tree" style={{ width: lay.width, height: Math.max(lay.height, reserve) }}>
          <svg className="dp-tree-edges" aria-hidden="true" width={lay.width} height={lay.height} viewBox={`0 0 ${lay.width || 1} ${lay.height || 1}`}>
            {idxs.map(i => {
              const nd = m.nodes[i]
              const p = nd.parent >= 0 ? byKey.get(m.nodes[nd.parent].n) : undefined
              const c = byKey.get(nd.n)
              if (!p || !c) return null
              const kind = nd.hit ? 'hit' : stackSet.has(i) ? 'stack' : 'idle'
              return <polyline key={nd.n} className={`dp-edge dp-edge-${kind}`} points={edgePath(p, c)} fill="none" />
            })}
          </svg>
          {lay.groups.map(g => (caseCalls[g.group] ? (
            <span key={`l${g.group}`} className="dp-root-label" data-testid={`dp-root-label-${g.group}`} style={{ left: g.cx - g.labelWidth / 2, width: g.labelWidth }}>{caseCalls[g.group]}</span>
          ) : null))}
          {shown.map((nd, p) => {
            const at = byKey.get(nd.n)
            if (!at) return null
            const c = cellOf(nd)
            const linked = pressedCell !== null && c !== null && c.t === pressedCell.t && c.i === pressedCell.i && c.j === pressedCell.j
            const isPeer = peerCell !== null && c !== null && c.t === peerCell.t && c.i === peerCell.i && c.j === peerCell.j
            return (
              <button
                key={nd.n} type="button" role="treeitem" className="dp-node" data-testid={`dp-node-${nd.n}`}
                data-hit={nd.hit ? 'true' : 'false'} data-linked={linked ? 'true' : 'false'}
                data-current={cur === nd ? 'true' : undefined} data-onstack={onStack(nd) && cur !== nd ? 'true' : undefined}
                data-peer={isPeer ? 'true' : undefined}
                aria-pressed={pick?.kind === 'node' && pick.n === nd.n}
                tabIndex={tabN === nd.n ? 0 : -1}
                style={{ left: at.x, top: at.y, width: at.width }}
                onClick={() => { setFocusN(nd.n); onPick(nd.n) }}
                onMouseEnter={() => onPeer({ kind: 'node', n: nd.n })} onMouseLeave={() => onPeer(null)}
                onFocus={() => { setFocusN(nd.n); onPeer({ kind: 'node', n: nd.n }) }} onBlur={() => onPeer(null)}
                onKeyDown={e => { if (e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation(); move(nd, e.key) } }}
              >{labels[p]}</button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
