import { expect, type Page } from '@playwright/test'

// UAT cu-5 P2-1 (ui-visual-families V0.3, "one size per case"): walks every step of a trace inside the page and records, at
// each one, the box of every family pane, of the band and of the step controls, so a spec can assert that a pane keeps one
// size for a whole case and that the controls never move.

export type Box = { x: number; y: number; w: number; h: number }
export interface Sample {
  k: number
  /** "Case n of m" from the narration, '1' when the run has one case */
  c: string
  /** each `<kind>-view` pane (and the DP table and call-tree panes), by test id */
  panes: Record<string, Box>
  /** where each graph and tree node sits in its drawing (the centre, in layout units), by test id */
  nodes: Record<string, string>
  /** the step controls: prev, play, next, counter, slider */
  ctl: Record<string, Box>
  /** the band (dp-view) and the row under it (the outcome buttons) */
  band: Box
  below: Box | null
}

/** The step controls' CSS selectors inside dp-view. */
const CTL: Record<string, string> = { prev: '.dp-prev', play: '.dp-play', next: '.dp-next', counter: '[data-testid="dp-step-counter"]', slider: '[data-testid="dp-scrubber"]' }

/** Goes to step 1, then steps forward to the end with the real Next button, sampling at each step. */
export async function walkSteps(page: Page, opts: { playFirst?: boolean } = {}): Promise<Sample[]> {
  const view = page.getByTestId('dp-view')
  await view.getByTestId('dp-scrubber').press('Home')
  await expect(view.getByTestId('dp-step-counter')).toHaveText(/^Step 1 \//)
  return page.evaluate(async ({ CTL, playFirst }) => {
    const root = document.querySelector('[data-testid="dp-view"]') as HTMLElement
    const box = (e: Element | null): Box | null => {
      if (!e) return null
      const r = e.getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    }
    const buttons = [...root.querySelectorAll('button')]
    const next = buttons.find(b => b.textContent === 'Next step') as HTMLButtonElement
    const play = root.querySelector('.dp-play') as HTMLButtonElement
    const sample = (): Sample => {
      const said = root.querySelector('[data-testid="dp-narration"]')?.textContent ?? ''
      const panes: Record<string, Box> = {}
      for (const p of root.querySelectorAll('[data-testid$="-view"], [data-testid="dp-table-pane"], [data-testid="dp-tree-pane"]')) {
        const id = p.getAttribute('data-testid')!
        if (id !== 'dp-view') panes[id] = box(p)!
      }
      // layout coordinates, so a drawing scrolling inside its box (the current node kept in view) is not a move
      const nodes: Record<string, string> = {}
      for (const g of root.querySelectorAll('[data-testid^="graph-node-"]')) {
        const r = g.querySelector('rect')!
        nodes[g.getAttribute('data-testid')!] = `${Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2},${r.getAttribute('y')}`
      }
      for (const n of root.querySelectorAll<HTMLElement>('[data-testid^="tree-node-"]')) {
        nodes[n.getAttribute('data-testid')!] = `${parseFloat(n.style.left) + parseFloat(n.style.width) / 2},${parseFloat(n.style.top)}`
      }
      const ctl: Record<string, Box> = {}
      for (const [n, sel] of Object.entries(CTL)) ctl[n] = box(root.querySelector(sel))!
      return {
        k: Number(/Step (\d+)/.exec(root.querySelector('[data-testid="dp-step-counter"]')!.textContent!)![1]),
        c: /^Case (\d+) of/.exec(said)?.[1] ?? '1',
        panes, nodes, ctl, band: box(root)!, below: box(document.querySelector('.do-outcome-row')),
      }
    }
    const out: Sample[] = []
    // one painted frame: what the learner sees, after any layout work the step triggers (the band's own height hold included)
    const tick = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
    if (playFirst) {
      // the Play button reads Pause while it runs: the controls must not move for that either
      play.click()
      await tick()
      out.push(sample())
      play.click()
      await tick()
    }
    for (;;) {
      out.push(sample())
      if (next.disabled) return out
      next.click()
      await tick()
    }
  }, { CTL, playFirst: !!opts.playFirst })
}

const r1 = (n: number) => Math.round(n * 10) / 10
const sig = (b: Box | null | undefined, rel = 0) => (b ? `${r1(b.w)}x${r1(b.h)}@${r1(b.y - rel)}` : 'none')

/** Groups samples by case, in order. */
export function byCase(samples: Sample[]): Map<string, Sample[]> {
  const m = new Map<string, Sample[]>()
  for (const s of samples) m.set(s.c, [...(m.get(s.c) ?? []), s])
  return m
}

/** Every pane keeps one width and height for a whole case (and one place under the band's top); so do the band and the row below. */
export function assertOneSizePerCase(samples: Sample[], what: string) {
  for (const [c, ss] of byCase(samples)) {
    const kinds = new Set(ss.flatMap(s => Object.keys(s.panes)))
    for (const kind of kinds) {
      const seen = new Map<string, number[]>()
      for (const s of ss) {
        const key = sig(s.panes[kind], s.band.y)
        seen.set(key, [...(seen.get(key) ?? []), s.k])
      }
      expect([...seen.entries()].map(([sg, ks]) => `${sg} at steps ${ks.slice(0, 6).join(',')}${ks.length > 6 ? '…' : ''}`), `${what}: ${kind} in case ${c} (width x height @ top under the band)`).toHaveLength(1)
    }
    // the band holds the tallest height it has had (DpView), rounded up to a whole pixel
    const band = new Set(ss.map(s => `${Math.ceil(s.band.w)}x${Math.ceil(s.band.h)}`))
    expect([...band], `${what}: the band in case ${c}`).toHaveLength(1)
    const below = new Set(ss.map(s => (s.below ? Math.ceil(s.below.y - s.band.y) : 'none')))
    expect([...below], `${what}: the row under the band in case ${c}`).toHaveLength(1)
  }
}

/** A node keeps its place in its drawing for a whole case, from the step it first appears. */
export function assertNodesStay(samples: Sample[], what: string) {
  for (const [c, ss] of byCase(samples)) {
    const at = new Map<string, Map<string, number[]>>()
    for (const s of ss) {
      for (const [id, pos] of Object.entries(s.nodes)) {
        const m = at.get(id) ?? new Map<string, number[]>()
        m.set(pos, [...(m.get(pos) ?? []), s.k])
        at.set(id, m)
      }
    }
    for (const [id, m] of at) {
      expect([...m.entries()].map(([pos, ks]) => `${pos} at steps ${ks.slice(0, 6).join(',')}`), `${what}: ${id} in case ${c}`).toHaveLength(1)
    }
  }
}

/** The step controls (prev, play, next, counter, slider) sit in one place for the whole run. */
export function assertControlsStill(samples: Sample[], what: string) {
  for (const name of Object.keys(CTL)) {
    const seen = new Map<string, number[]>()
    for (const s of samples) {
      const b = s.ctl[name]
      const key = `${r1(b.x)},${r1(b.y)} ${r1(b.w)}x${r1(b.h)}`
      seen.set(key, [...(seen.get(key) ?? []), s.k])
    }
    expect([...seen.entries()].map(([sg, ks]) => `${sg} at steps ${ks.slice(0, 6).join(',')}${ks.length > 6 ? '…' : ''}`), `${what}: the ${name} control (x,y w x h)`).toHaveLength(1)
  }
}

/** A readable table of what a walk saw, for a spec's failure message or a probe. */
export function summary(samples: Sample[]): string {
  const lines: string[] = []
  for (const [c, ss] of byCase(samples)) {
    const kinds = [...new Set(ss.flatMap(s => Object.keys(s.panes)))]
    lines.push(`case ${c}: steps ${ss[0].k}-${ss[ss.length - 1].k}`)
    for (const kind of kinds) {
      const seen = new Map<string, number>()
      for (const s of ss) seen.set(sig(s.panes[kind], s.band.y), (seen.get(sig(s.panes[kind], s.band.y)) ?? 0) + 1)
      lines.push(`  ${kind}: ${[...seen.entries()].map(([k, n]) => `${k} x${n}`).join(' | ')}`)
    }
    const below = new Set(ss.map(s => (s.below ? Math.ceil(s.below.y - s.band.y) : 'none')))
    lines.push(`  below: ${[...below].join(' | ')}  band h: ${[...new Set(ss.map(s => r1(s.band.h)))].join(' | ')}`)
  }
  return lines.join('\n')
}
