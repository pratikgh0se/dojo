// SEC-D-01 (G6 security review): a stored picture is untrusted text. The vendored engines must show every
// data-derived string as text, never parse it as HTML. jsdom loads no images, so the assertions are
// structural (no element or handler attribute is ever created from the payload) plus the literal text;
// tests/e2e/picture-xss.spec.ts proves the same in Chromium, where a broken <img> really fires onerror.
import { render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AlgoJson } from '../../src/rules/algoJson'
import { frameOnly } from '../../src/ui/algo/AlgoPlayer'
import { SrAlgo, type AlgoElement } from '../../src/ui/engines/SrAlgo'
import { installAlgoEngines } from '../helpers/engines'

const X = '<img src=x onerror="window.__xss=1">'
type Full = AlgoElement & { go(k: number): void }
const w = window as unknown as { __xss?: unknown }

/** Anything a parsed payload would have created inside the engine's shadow root. */
function injected(root: ShadowRoot) {
  const all = [...root.querySelectorAll('*')]
  return {
    tags: all.filter(e => ['img', 'script', 'iframe', 'object', 'embed', 'a'].includes(e.localName)).map(e => e.localName),
    handlers: all.flatMap(e => [...e.attributes].filter(a => a.name.startsWith('on')).map(a => `${e.localName}[${a.name}]`)),
  }
}
const clean = { tags: [], handlers: [] }
const svgText = (root: ShadowRoot) => [...root.querySelectorAll('svg text')].map(t => t.textContent).join('|')

const algoPayload: AlgoJson = {
  title: `Max${X}`,
  complexity: `O(n)${X}`,
  intro: `intro${X}`,
  structures: {
    [`arr${X}`]: { type: 'array', values: [`v${X}`, 2], caption: `cap${X}` },
    g: { type: 'graph', nodes: { [`n${X}`]: {}, b: { label: `lb${X}` } }, edges: [[`n${X}`, 'b', `w${X}`]] },
  },
  code: [`if a < b ${X}`],
  steps: [
    { op: 'pointer', s: `arr${X}`, name: `p${X}`, i: 0, line: 0, say: `say${X}`, vars: { [`k${X}`]: `val${X}` } },
    { op: 'label', g: 'g', n: 'b', text: `tag${X}`, say: `say2${X}` },
  ],
}

const algo2Payload: AlgoJson = {
  title: `Sets${X}`,
  complexity: `O(α(n))${X}`,
  structures: { [`s${X}`]: { type: 'sets', groups: { [`grp${X}`]: [`item${X}`] } } },
  code: [`if a < b ${X}`],
  steps: [{ op: 'mark', s: `s${X}`, i: `item${X}`, state: 'done', say: `say${X}`, vars: { [`k${X}`]: `val${X}` } }],
}

describe('SEC-D-01: engines render picture text as text', () => {
  beforeAll(installAlgoEngines)
  afterEach(() => { delete w.__xss })

  it('<sr-algo>: title, complexity, narration, code, vars and structure labels stay literal', () => {
    const { container } = render(<SrAlgo engine="algo" json={algoPayload} label="x" />)
    const el = container.querySelector('sr-algo') as Full
    const root = el.shadowRoot!
    expect(root.querySelector('.title')!.textContent).toBe(`MAX${X.toUpperCase()}`)
    expect(root.querySelector('.badge')!.textContent).toBe(`O(n)${X}`)
    expect(root.querySelector('.say')!.textContent).toBe(`intro${X}`)
    expect(root.querySelector('.code')!.textContent).toBe(`if a < b ${X}`)
    expect(injected(root)).toEqual(clean)
    el.go(1)
    expect(root.querySelector('.say')!.textContent).toBe(`say${X}`)
    expect(root.querySelector('.vars b')!.textContent).toBe(`k${X}`)
    expect(root.querySelector('.vars span')!.textContent).toBe(`k${X}val${X}`)
    for (const s of [`ARR${X.toUpperCase()}`, `v${X}`, `p${X}`, `n${X}`, `lb${X}`, `w${X}`]) expect(svgText(root)).toContain(s)
    expect(injected(root)).toEqual(clean)
    el.go(2)
    expect(svgText(root)).toContain(`tag${X}`)
    expect(injected(root)).toEqual(clean)
    expect(w.__xss).toBeUndefined()
  })

  it('<sr-algo2>: the same fields, the vars box and the sets labels stay literal', () => {
    const { container } = render(<SrAlgo engine="algo2" json={algo2Payload} label="x" />)
    const el = container.querySelector('sr-algo2') as Full
    const root = el.shadowRoot!
    expect(root.querySelector('.title')!.textContent).toBe(`SETS${X.toUpperCase()}`)
    expect(root.querySelector('.badge')!.textContent).toBe(`O(α(n))${X}`)
    el.go(1)
    expect(root.querySelector('.say')!.textContent).toBe(`say${X}`)
    expect(root.querySelector('.vars span')!.textContent).toBe(`k${X}val${X}`)
    expect(svgText(root)).toContain(`item${X}`)
    expect(svgText(root)).toContain(`GRP${X.toUpperCase()}`)
    expect(injected(root)).toEqual(clean)
    expect(w.__xss).toBeUndefined()
  })

  it.each(['algo', 'algo2'] as const)('the %s error render shows a hostile error, or a bad data attribute, as text', engine => {
    const { container } = render(<SrAlgo engine={engine} json={{ error: `boom${X}` }} label="x" />)
    const el = container.querySelector(engine === 'algo' ? 'sr-algo' : 'sr-algo2') as Full
    expect(el.shadowRoot!.querySelector('.say')!.textContent).toBe(`NO ALGORITHM · boom${X}`)
    expect(injected(el.shadowRoot!)).toEqual(clean)
    // JSON.parse's message quotes the bad input, so a broken data attribute is a sink too
    el.setAttribute('data', `${X}{`)
    expect(el.shadowRoot!.querySelector('.say')!.textContent).toMatch(/^NO ALGORITHM · /)
    expect(injected(el.shadowRoot!)).toEqual(clean)
    expect(w.__xss).toBeUndefined()
  })
})

describe('SEC-D-01: frameOnly hands the engine no header text', () => {
  it('drops title, complexity and error (the wrapper shows the header in React) and keeps the drawing', () => {
    const f = frameOnly({ ...algoPayload, error: 'x' } as AlgoJson) as unknown as Record<string, unknown>
    expect(f).not.toHaveProperty('title')
    expect(f).not.toHaveProperty('complexity')
    expect(f).not.toHaveProperty('error')
    expect(f.structures).toBe(algoPayload.structures)
    expect(f.code).toEqual([])
    expect(f.vars).toBeNull()
    expect((f.steps as Array<Record<string, unknown>>).every(s => !('vars' in s))).toBe(true)
  })
})
