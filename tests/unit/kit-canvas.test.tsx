import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { KIT_FAMILIES, KIT_KINDS } from '../../src/content/diagramKit'
import { addLink, addNode, emptyCanvas, type KitCanvas } from '../../src/rules/designCanvas'
import { KitCanvas as Kit } from '../../src/screens/designSession/kit/KitCanvas'

let last: KitCanvas = emptyCanvas()
function Harness({ locked = false, initial = emptyCanvas() }: { locked?: boolean; initial?: KitCanvas }) {
  const [c, setC] = useState(initial)
  const [view, setView] = useState<'2d' | 'iso'>('2d')
  last = c
  return <Kit canvas={c} view={view} locked={locked} exportName="x.png" onChange={setC} onView={setView} />
}
const add = (k: string) => fireEvent.click(screen.getByRole('button', { name: `Add ${k}` }))
const node = (id: string) => screen.getByTestId(`kit-node-${id}`)
const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k })

describe('palette (C-DESIGN §3, addendum §10)', () => {
  it('offers the 38 kinds in 11 family groups with a roving tabindex', () => {
    render(<Harness />)
    const tb = screen.getByRole('toolbar', { name: 'Node palette' })
    const btns = within(tb).getAllByRole('button')
    expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(KIT_KINDS.map(k => `Add ${k}`))
    expect(tb.querySelectorAll('[data-testid^="kit-family-"]')).toHaveLength(11)
    expect(within(screen.getByTestId('kit-family-cache')).getAllByRole('button')).toHaveLength(1)
    expect(btns.filter(b => b.tabIndex === 0)).toHaveLength(1)
    btns[0].focus()
    key(btns[0], 'ArrowRight')
    expect(btns[1]).toHaveFocus()
    expect(btns[1].tabIndex).toBe(0)
    key(btns[1], 'ArrowLeft')
    expect(btns[0]).toHaveFocus()
    key(btns[0], 'End')
    expect(btns[37]).toHaveFocus()
  })

  it('wraps the scrollable palette in a region named "Node palette" (D-59, D-6 addendum)', () => {
    render(<Harness />)
    const region = screen.getByRole('region', { name: 'Node palette' })
    expect(region).toHaveAttribute('data-testid', 'kit-palette')
    expect(within(region).getByRole('toolbar', { name: 'Node palette' })).toBeInTheDocument()
  })

  it('triage A5: the palette and canvas scrollers carry the .sc house scrollbar', () => {
    render(<Harness />)
    expect(screen.getByTestId('kit-palette')).toHaveClass('sc')
    expect(screen.getByTestId('kit-canvas')).toHaveClass('sc')
  })

  it('tints each family group with data-family and a per-family border-left/glyph colour (like the prototype)', () => {
    render(<Harness />)
    const css = readFileSync('src/screens/designSession/kit/kit.css', 'utf8')
    for (const f of KIT_FAMILIES) {
      const group = screen.getByTestId(`kit-family-${f.family}`)
      expect(group).toHaveAttribute('data-family', f.family)
      const rule = css.match(new RegExp(`\\.kit-family\\[data-family='${f.family}'\\]\\s*\\{[^}]*\\}`))?.[0]
      expect(rule, `missing tint rule for family "${f.family}"`).toBeDefined()
      expect(rule).toMatch(/border-left-color:\s*var\(--sr-/)
      const nameRule = css.match(new RegExp(`\\.kit-family\\[data-family='${f.family}'\\] \\.kit-family-name\\s*\\{[^}]*\\}`))?.[0]
      expect(nameRule, `missing glyph colour rule for family "${f.family}"`).toBeDefined()
      expect(nameRule).toMatch(/color:\s*var\(--sr-/)
    }
  })

  it('does not block swipe scrolling on the palette buttons themselves (touch-action)', () => {
    render(<Harness />)
    const css = readFileSync('src/screens/designSession/kit/kit.css', 'utf8')
    const rule = css.match(/\.kit-kind\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toMatch(/touch-action:\s*none/)
  })

  // jsdom has no PointerEvent constructor, so react-dom's pointer-event plugin never activates
  // here and a real pointerdown/move/cancel sequence can't be driven through fireEvent. Assert the
  // cleanup wiring from source instead: 'pointercancel' is registered alongside 'pointerup' and
  // 'pointermove', and its handler removes all three window listeners without dropping the node
  // (only a real pointerup should call onDrop).
  it('cleans up its window listeners on pointercancel, not just pointerup (D-6 addendum)', () => {
    const src = readFileSync('src/screens/designSession/kit/Palette.tsx', 'utf8')
    expect(src).toMatch(/addEventListener\('pointercancel',\s*cancel\)/)
    expect(src).toMatch(/addEventListener\('pointerup',\s*up\)/)
    const end = src.match(/const end = \([^{]*\{([\s\S]*?)\n    \}/)?.[1] ?? ''
    expect(end).toMatch(/removeEventListener\('pointermove'/)
    expect(end).toMatch(/removeEventListener\('pointerup'/)
    expect(end).toMatch(/removeEventListener\('pointercancel'/)
    expect(src).toMatch(/const cancel = \(ev: PointerEvent\) => end\(ev, false\)/)
  })
})

describe('click and keyboard editing', () => {
  it('adds nodes by click, selects and focuses the last one (D-12)', () => {
    render(<Harness />)
    for (const k of ['gateway', 'service', 'cache', 'sql']) add(k)
    expect(node('gateway-1')).toHaveAccessibleName('Gateway 1 · gateway')
    const cells = ['gateway-1', 'service-1', 'cache-1', 'sql-1'].map(id => `${node(id).dataset.x},${node(id).dataset.y}`)
    expect(new Set(cells).size).toBe(4)
    expect(screen.getByTestId('kit-count')).toHaveTextContent('4 nodes · 0 links')
    expect(node('sql-1')).toHaveAttribute('aria-pressed', 'true')
    expect(node('gateway-1')).toHaveAttribute('aria-pressed', 'false')
    expect(node('sql-1')).toHaveFocus()
  })

  it('runs the keyboard path: move, link with l, cancel with Escape, delete (D-18)', () => {
    render(<Harness />)
    add('lb')
    const lb = node('lb-1')
    const [x0, y0] = [Number(lb.dataset.x), Number(lb.dataset.y)]
    key(lb, 'ArrowRight'); key(node('lb-1'), 'ArrowRight'); key(node('lb-1'), 'ArrowDown')
    expect(node('lb-1')).toHaveAttribute('data-x', String(x0 + 2))
    expect(node('lb-1')).toHaveAttribute('data-y', String(y0 + 1))
    add('service')
    expect(node('service-1')).toHaveFocus()
    key(node('lb-1'), 'l')
    expect(screen.getByTestId('kit-status')).toHaveTextContent('Link from Lb 1: pick a target')
    fireEvent.click(node('service-1'))
    expect(screen.getByTestId('kit-link-lb-1-service-1')).toHaveAttribute('data-kind', 'sync')
    expect(screen.getByTestId('kit-status')).toHaveTextContent('')
    key(node('lb-1'), 'l')
    key(node('lb-1'), 'Escape')
    expect(screen.getByTestId('kit-status')).toHaveTextContent('')
    key(node('service-1'), 'Delete')
    expect(screen.queryByTestId('kit-node-service-1')).toBeNull()
    expect(screen.queryByTestId('kit-link-lb-1-service-1')).toBeNull()
    expect(screen.getByTestId('kit-count')).toHaveTextContent('1 nodes · 0 links')
  })

  it('renames, changes a link kind and shows compact JSON (D-15, D-17, D-21)', () => {
    let c = addNode(addNode(emptyCanvas(), 'gateway').canvas, 'service').canvas
    c = addLink(addNode(c, 'sql').canvas, 'gateway-1', 'service-1').canvas
    render(<Harness initial={c} />)
    expect(screen.getByRole('textbox', { name: 'Node label' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Link kind' })).toBeDisabled()
    fireEvent.click(node('sql-1'))
    const label = screen.getByRole('textbox', { name: 'Node label' })
    expect(label).toHaveValue('Sql 1')
    fireEvent.change(label, { target: { value: 'Redis counters' } })
    key(label, 'Enter')
    expect(node('sql-1')).toHaveAccessibleName('Redis counters · sql')
    fireEvent.click(screen.getByTestId('kit-link-gateway-1-service-1'))
    const kind = screen.getByRole('combobox', { name: 'Link kind' })
    expect(within(kind).getAllByRole('option')).toHaveLength(13)
    fireEvent.change(kind, { target: { value: 'async' } })
    expect(screen.getByTestId('kit-link-gateway-1-service-1')).toHaveAccessibleName('Gateway 1 to Service 1 · async')
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    const json = screen.getByTestId('kit-json').textContent ?? ''
    expect(json).toContain('{"from":"gateway-1","to":"service-1","kind":"async"}')
    expect(json).toContain('"label":"Redis counters"')
    expect(JSON.parse(json)).toEqual(last)
  })

  it('switches 2D and Iso without touching the JSON (D-20)', () => {
    render(<Harness initial={addNode(emptyCanvas(), 'gateway').canvas} />)
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    const before = screen.getByTestId('kit-json').textContent
    const view = screen.getByRole('group', { name: 'View' })
    fireEvent.click(within(view).getByRole('button', { name: 'Iso' }))
    expect(within(view).getByRole('button', { name: 'Iso' })).toHaveAttribute('aria-pressed', 'true')
    expect(node('gateway-1')).toHaveAccessibleName('Gateway 1 · gateway')
    fireEvent.click(within(view).getByRole('button', { name: '2D' }))
    expect(screen.getByTestId('kit-json').textContent).toBe(before)
  })

  it('is read-only when locked (D-6, D-7)', () => {
    const c = addLink(addNode(addNode(emptyCanvas(), 'lb').canvas, 'service').canvas, 'lb-1', 'service-1').canvas
    render(<Harness locked initial={c} />)
    const canvas = screen.getByTestId('kit-canvas')
    expect(canvas).toHaveAttribute('data-locked', 'true')
    expect(canvas).toHaveAttribute('aria-disabled', 'true')
    expect(within(screen.getByRole('toolbar', { name: 'Node palette' })).getAllByRole('button').every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    key(node('lb-1'), 'ArrowRight')
    key(node('lb-1'), 'Delete')
    key(node('lb-1'), 'l')
    expect(last).toEqual(c)
    expect(screen.getByTestId('kit-status')).toHaveTextContent('')
    fireEvent.click(node('lb-1'))
    expect(screen.getByRole('textbox', { name: 'Node label' })).toBeDisabled()
  })
})
