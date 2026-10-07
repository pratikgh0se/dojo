import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SrAlgo } from '../../src/ui/engines/SrAlgo'
import { SrChart } from '../../src/ui/engines/SrChart'
import { SrDiagram } from '../../src/ui/engines/SrDiagram'
import { PomStage } from '../../src/ui/engines/PomStage'

class FakeSheet { replaceSync() {} }
const defined = new Map<string, () => void>()

beforeEach(() => {
  vi.stubGlobal('CSSStyleSheet', FakeSheet)
  Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
  // engines are loaded lazily: pretend nothing is defined until the test says so
  vi.spyOn(customElements, 'whenDefined').mockImplementation(tag => new Promise<CustomElementConstructor>(res => defined.set(tag, () => res(class extends HTMLElement {}))))
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { f(); return 0 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); defined.clear() })

/** an element whose shadow root exists once "defined" */
function withShadow(container: HTMLElement, tag: string) {
  const el = container.querySelector(tag) as HTMLElement
  el.attachShadow({ mode: 'open' })
  ;(el.shadowRoot as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = []
  return el
}

describe('engine wrappers adopt the readable sheet after the engine is defined (also when mounted later)', () => {
  it.each([
    ['sr-chart', () => <SrChart type="hpBar" data={{ max: 1, value: 1 }} label="c" />],
    ['sr-diagram', () => <SrDiagram data={{}} label="d" />],
    ['sr-algo', () => <SrAlgo engine="algo" json={{}} label="a" />],
    ['sr-algo2', () => <SrAlgo engine="algo2" json={{}} label="a2" />],
    ['pom-stage', () => <PomStage form={0} pose="idle" label="p" />],
  ] as const)('%s', async (tag, ui) => {
    const { container } = render(ui())
    const el = withShadow(container, tag)
    const sheets = () => (el.shadowRoot as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets
    expect(sheets()).toHaveLength(0)
    defined.get(tag)!()
    await vi.waitFor(() => expect(sheets()).toHaveLength(1))
  })
})
