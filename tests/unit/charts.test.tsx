import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GroupedColumns, Ring, SteppedLine, StackedColumns, type ChartSeries } from '../../src/ui/charts'
import { Stat } from '../../src/ui/Stat'

const SERIES: ChartSeries[] = [
  { key: 'total', label: 'Total', tone: 'muted' },
  { key: 'solved', label: 'Solved', tone: 'accent' },
]

describe('GroupedColumns', () => {
  it('draws one bar per value, scaled to the tallest, with a legend', () => {
    const { container } = render(
      <GroupedColumns
        label="Solved by difficulty"
        series={SERIES}
        groups={[{ label: 'E', values: [8, 2] }, { label: 'M', values: [112, 0] }, { label: 'H', values: [49, 49] }]}
      />,
    )
    expect(screen.getByRole('img', { name: 'Solved by difficulty' })).toBeInTheDocument()
    const bars = [...container.querySelectorAll('rect.bar')]
    expect(bars).toHaveLength(6)
    const m = bars.filter(b => b.getAttribute('data-value') === '112')[0]
    expect(m.getAttribute('height')).toBe('70') // height 96 − 14 label − 12 value band
    const zero = bars.find(b => b.getAttribute('data-value') === '0')!
    expect(zero.getAttribute('height')).toBe('0')
    expect(m).toHaveClass('ct-muted')
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('Solved')).toBeInTheDocument()
  })

  it('never divides by zero when every value is 0', () => {
    const { container } = render(<GroupedColumns label="Empty" series={SERIES} groups={[{ label: 'E', values: [0, 0] }]} />)
    for (const b of container.querySelectorAll('rect.bar')) expect(b.getAttribute('height')).toBe('0')
  })

  it('honours an explicit max', () => {
    const { container } = render(<GroupedColumns label="Max" series={SERIES.slice(0, 1)} groups={[{ label: 'A', values: [35] }]} max={70} />)
    expect(container.querySelector('rect.bar')!.getAttribute('height')).toBe('35')
  })
})

describe('Ring', () => {
  it('lights cells in proportion and labels itself', () => {
    const { container } = render(<Ring label="AI" done={3} total={16} testId="ring-ai" />)
    expect(container.querySelectorAll('rect.ring-cell')).toHaveLength(16)
    expect(container.querySelectorAll('rect.ring-cell.on')).toHaveLength(3)
    expect(screen.getByRole('img', { name: 'AI: 3 of 16' })).toBeInTheDocument()
    expect(screen.getByTestId('ring-ai-count')).toHaveTextContent('3/16')
    expect(screen.getByText('19%')).toBeInTheDocument()
  })
  it('handles zero total', () => {
    const { container } = render(<Ring label="Designs" done={0} total={0} />)
    expect(container.querySelectorAll('rect.ring-cell.on')).toHaveLength(0)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})

describe('SteppedLine', () => {
  it('draws square steps, breaks on null, and places markers', () => {
    const { container } = render(
      <SteppedLine
        label="Burn-up"
        series={[{ key: 'done', label: 'Done', tone: 'accent', points: [0, 2, null, 5] }]}
        markers={[{ at: 2, kind: 'now', label: 'NOW' }, { at: 4, kind: 'slide', label: 'Slide sprint' }]}
      />,
    )
    // height 120: plot 100 tall from y=8; top value 5 → y(0)=108, y(2)=68, y(5)=8; x(i)=6+8i
    expect(container.querySelector('path.line[data-series="done"]')!.getAttribute('d')).toBe('M6 108 H14 V68 H22 M30 8 H38')
    expect(container.querySelector('[data-marker="now"]')!.getAttribute('x1')).toBe('18')
    expect(container.querySelector('[data-marker="slide"]')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Burn-up' })).toBeInTheDocument()
  })
})

describe('StackedColumns', () => {
  it('stacks non-zero values from the base and draws a threshold line', () => {
    const { container } = render(
      <StackedColumns
        label="Outcomes"
        height={94}
        series={[{ key: 'a', label: 'A', tone: 'ok' }, { key: 'b', label: 'B', tone: 'danger' }]}
        columns={[{ label: 'S1', values: [3, 1] }, { label: 'S2', values: [0, 0] }]}
      />,
    )
    const segs = [...container.querySelectorAll('rect.seg')]
    expect(segs.map(s => [s.getAttribute('data-series'), s.getAttribute('height')])).toEqual([['a', '57'], ['b', '19']])
    expect(Number(segs[1].getAttribute('y')) + 19).toBe(Number(segs[0].getAttribute('y')))
  })
  it('scales to the threshold when it is the tallest thing', () => {
    const { container } = render(
      <StackedColumns label="Minutes" series={[{ key: 'm', label: 'Minutes', tone: 'accent' }]} columns={[{ label: 'W1', values: [270] }]} threshold={540} />,
    )
    expect(container.querySelector('[data-threshold="540"]')).toBeInTheDocument()
    expect(container.querySelector('rect.seg')!.getAttribute('height')).toBe('39') // 270/540 × 78
  })

  it('bounds a single-column chart to a small, fixed pixel box instead of stretching to fill the panel', () => {
    const { container } = render(
      <StackedColumns label="Artifacts" height={120} series={[{ key: 'a', label: 'A', tone: 'ok' }]} columns={[{ label: 'S1', values: [3] }]} />,
    )
    const svg = container.querySelector('svg.chart')!
    // Regression: with `width: 100%; height: auto` in charts.css and a viewBox this
    // narrow (one column), the browser used to stretch the SVG's height in proportion
    // to a full-panel width — thousands of px tall instead of a "chart well" band.
    const renderedHeight = Number(svg.getAttribute('style')?.match(/height:\s*(\d+)px/)?.[1])
    expect(renderedHeight).toBeGreaterThan(0)
    expect(renderedHeight).toBeLessThanOrEqual(240)
    // Not `width: 100%` — a narrow chart gets a modest fixed width, not the full panel.
    expect(svg.getAttribute('style')).not.toMatch(/(?<!max-)width:\s*100%/)
  })

  it('caps rendered height at 240px even for an explicit larger height prop', () => {
    const { container } = render(
      <StackedColumns label="Tall" height={9999} series={[{ key: 'a', label: 'A', tone: 'ok' }]} columns={[{ label: 'S1', values: [1] }]} />,
    )
    const svg = container.querySelector('svg.chart')!
    const renderedHeight = Number(svg.getAttribute('style')?.match(/height:\s*(\d+)px/)?.[1])
    expect(renderedHeight).toBeLessThanOrEqual(240)
  })

  it('still fills the panel width for a normal, multi-column chart', () => {
    const { container } = render(
      <StackedColumns
        label="Sprints"
        series={[{ key: 'a', label: 'A', tone: 'ok' }]}
        columns={[1, 2, 3, 4, 5].map(n => ({ label: `S${n}`, values: [n] }))}
      />,
    )
    const svg = container.querySelector('svg.chart')!
    // Multi-column charts keep the plain `width: 100%; height: auto` from charts.css —
    // no inline style at all (see week-screen.test.tsx's regression test for why: an
    // earlier fix had to remove an inline `max-width` that squeezed a working chart).
    expect(svg).not.toHaveAttribute('style')
  })
})

describe('Stat', () => {
  it('renders value and label, test id on the value', () => {
    render(<Stat value="2/169" label="solved" testId="dsa-solved" />)
    expect(screen.getByTestId('dsa-solved')).toHaveTextContent('2/169')
    expect(screen.getByText('solved')).toBeInTheDocument()
  })
})
