import { render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEngine, resetEnginesForTest } from '../../src/lib/engines'
import { PomStage } from '../../src/ui/engines/PomStage'
import { SrAlgo, type AlgoElement } from '../../src/ui/engines/SrAlgo'
import { SrChart } from '../../src/ui/engines/SrChart'
import { SrDiagram } from '../../src/ui/engines/SrDiagram'

const scripts = () => [...document.head.querySelectorAll('script[data-engine]')]

describe('loadEngine', () => {
  beforeEach(() => {
    resetEnginesForTest()
    scripts().forEach(s => s.remove())
  })

  it('appends one script per engine however often it is asked', () => {
    void loadEngine('charts')
    void loadEngine('charts')
    void loadEngine('pom-stage')
    expect(scripts().map(s => s.getAttribute('src'))).toEqual(['/engines/charts.js', '/engines/pom-stage.js'])
  })

  it('rejects when the script fails and retries with a fresh script next time (Review Focus #1)', async () => {
    const p = loadEngine('charts')
    scripts()[0].dispatchEvent(new Event('error'))
    await expect(p).rejects.toThrow('engine charts failed to load')
    void loadEngine('charts')
    expect(scripts()).toHaveLength(2)
  })

  it('loads the lab engines from /engines too', () => {
    void loadEngine('algo')
    void loadEngine('algo2')
    void loadEngine('diagram')
    expect(scripts().map(s => s.getAttribute('src'))).toEqual(['/engines/algo.js', '/engines/algo2.js', '/engines/diagram.js'])
  })

  it('retries algo with a fresh script after a load error', async () => {
    const p = loadEngine('algo')
    scripts()[0].dispatchEvent(new Event('error'))
    await expect(p).rejects.toThrow('engine algo failed to load')
    void loadEngine('algo')
    expect(scripts()).toHaveLength(2)
  })
})

describe('SrChart', () => {
  it('writes type, data and opts as JSON attributes', () => {
    const { container } = render(<SrChart type="hpBar" data={{ max: 6, value: 5 }} testId="hp" label="Carrot HP" className="hp-chart" />)
    const el = container.querySelector('sr-chart')!
    expect(el.getAttribute('class')).toBe('hp-chart')
    expect(el.getAttribute('type')).toBe('hpBar')
    expect(JSON.parse(el.getAttribute('data')!)).toEqual({ max: 6, value: 5 })
    expect(el.hasAttribute('opts')).toBe(false)
    expect(el.getAttribute('data-testid')).toBe('hp')
    expect(el.getAttribute('aria-label')).toBe('Carrot HP')
  })
  it('serialises opts when given', () => {
    const { container } = render(<SrChart type="stackedColumn" data={{ series: [], labels: [] }} opts={{ barWidth: 18 }} />)
    expect(JSON.parse(container.querySelector('sr-chart')!.getAttribute('opts')!)).toEqual({ barWidth: 18 })
  })
  it('can be decorative inside a labelled wrapper', () => {
    const { container } = render(<SrChart type="radial" data={{ axes: ['A'], series: [] }} label="ignored" decorative />)
    const el = container.querySelector('sr-chart')!
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('role')).toBe(false)
    expect(el.hasAttribute('aria-label')).toBe(false)
  })
})

describe('PomStage', () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('maps form and pose to attributes, autorotates, and is transparent over its well', () => {
    const { container } = render(<PomStage form={2} pose="training" label="Pom, form SURGE" />)
    const el = container.querySelector('pom-stage')!
    expect(el.getAttribute('who')).toBe('pom')
    expect(el.getAttribute('form')).toBe('2')
    expect(el.getAttribute('pose')).toBe('training')
    expect(el.getAttribute('zoom')).toBe('1.05')
    expect(el.getAttribute('background')).toBe('transparent')
    expect(el.hasAttribute('autorotate')).toBe(true)
    expect(el.getAttribute('role')).toBe('img')
    expect(el.getAttribute('aria-label')).toBe('Pom, form SURGE')
  })

  it('drops autorotate under prefers-reduced-motion', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
    })) as unknown as typeof window.matchMedia
    const { container } = render(<PomStage form={0} pose="idle" label="Pom" />)
    expect(container.querySelector('pom-stage')!.hasAttribute('autorotate')).toBe(false)
  })
})

describe('lab engine wrappers', () => {
  beforeEach(() => {
    resetEnginesForTest()
    scripts().forEach(s => s.remove())
  })

  it('SrAlgo engine="algo" mounts <sr-algo> with JSON data and theme, forwards its ref, and loads algo.js', () => {
    const ref = createRef<AlgoElement>()
    const json = { title: 't', structures: {}, steps: [] }
    const { container } = render(<SrAlgo ref={ref} engine="algo" json={json} label="Picture for Two Sum" testId="player" />)
    const el = container.querySelector('sr-algo')!
    expect(ref.current).toBe(el)
    expect(JSON.parse(el.getAttribute('data')!)).toEqual(json)
    expect(el.getAttribute('theme')).toBe('dark')
    expect(el.getAttribute('data-testid')).toBe('player')
    expect(el.getAttribute('role')).toBe('group')
    expect(el.getAttribute('aria-label')).toBe('Picture for Two Sum')
    expect(container.querySelector('sr-algo2')).toBeNull()
    expect(scripts().map(s => s.getAttribute('src'))).toEqual(['/engines/algo.js'])
  })

  it('SrAlgo forwards className as a class attribute (like SrChart)', () => {
    const json = { title: 't', structures: {}, steps: [] }
    const { container } = render(<SrAlgo engine="algo" json={json} label="Demo" className="algo-player" />)
    expect(container.querySelector('sr-algo')!.getAttribute('class')).toBe('algo-player')
  })

  it('SrAlgo engine="algo2" mounts <sr-algo2> and loads algo2.js', () => {
    const ref = createRef<AlgoElement>()
    const { container } = render(<SrAlgo ref={ref} engine="algo2" json={{ title: 'dsu', structures: {}, steps: [] }} label="Union-find" />)
    const el = container.querySelector('sr-algo2')!
    expect(ref.current).toBe(el)
    expect(JSON.parse(el.getAttribute('data')!).title).toBe('dsu')
    expect(el.getAttribute('theme')).toBe('dark')
    expect(el.hasAttribute('data-testid')).toBe(false)
    expect(container.querySelector('sr-algo')).toBeNull()
    expect(scripts().map(s => s.getAttribute('src'))).toEqual(['/engines/algo2.js'])
  })

  it('SrDiagram writes type, view, data, opts and play, and loads diagram.js', () => {
    const data = { layout: 'layered', nodes: [{ id: 'a', kind: 'service', label: 'A' }], links: [] }
    const { container, rerender } = render(<SrDiagram data={data} view="iso" opts={{ grid: false }} play label="Reference architecture" />)
    const el = container.querySelector('sr-diagram')!
    expect(JSON.parse(el.getAttribute('data')!)).toEqual(data)
    expect(el.getAttribute('type')).toBe('graph')
    expect(el.getAttribute('view')).toBe('iso')
    expect(JSON.parse(el.getAttribute('opts')!)).toEqual({ grid: false })
    expect(el.hasAttribute('play')).toBe(true)
    expect(el.getAttribute('aria-label')).toBe('Reference architecture')
    rerender(<SrDiagram data={data} label="Reference architecture" />)
    expect(container.querySelector('sr-diagram')!.hasAttribute('play')).toBe(false)
    expect(container.querySelector('sr-diagram')!.getAttribute('view')).toBe('2d')
    expect(scripts().map(s => s.getAttribute('src'))).toEqual(['/engines/diagram.js'])
  })
})
