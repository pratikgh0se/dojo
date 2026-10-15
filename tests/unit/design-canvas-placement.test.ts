import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  addCustom, addNode, addTableBlock, emptyCanvas, normalizeCanvas, setSub, toEngineJson, type KitCanvas,
} from '../../src/rules/designCanvas'
import { emptyNotes } from '../../src/rules/designNotes'
import { kitGeometry } from '../../src/screens/designSession/kit/geometry'

// D1 (Task 29): a new node never lands on the drawn rectangle of an existing one. The rectangles come from the same
// geometry the app uses: kitGeometry reading the real sr-diagram layout (public/engines/diagram.js), not a copy of its sizes.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) // jsdom has no canvas; the engine falls back to per-character widths
  // eslint-disable-next-line no-new-func
  new Function(readFileSync('public/engines/diagram.js', 'utf8'))()
})

type Rect = { id: string; l: number; t: number; r: number; b: number }
function rects(c: KitCanvas, notes = emptyNotes()): Rect[] {
  const engine = toEngineJson(c, notes)
  const geo = kitGeometry(engine, true)
  return engine.nodes.map(n => { const b = geo.boxes.get(n.id)!; return { id: n.id, l: b.left, t: b.top, r: b.left + b.w, b: b.top + b.h } })
}
const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
function pairs(c: KitCanvas, notes = emptyNotes()): string[] {
  const rs = rects(c, notes)
  const bad: string[] = []
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (overlaps(rs[i], rs[j])) bad.push(`${rs[i].id}~${rs[j].id}`)
  return bad
}

describe('placement accounts for the drawn size of existing nodes (D1)', () => {
  it('the real engine layout is available to this test', () => {
    expect(rects(addCustom(emptyCanvas()).canvas)[0].r).toBeGreaterThan(0)
  })

  it('custom box with a description, then a table block, a plain node and a second custom box: no rectangles overlap', () => {
    let c = addCustom(emptyCanvas()).canvas
    c = setSub(c, 'custom-1', 'Composites layer for the whole feed pipeline') // 80 chars max: a wide box
    let notes = emptyNotes()
    const t = addTableBlock(c, notes)
    c = t.canvas
    notes = t.notes
    c = addNode(c, 'cache', undefined, notes).canvas
    c = addCustom(c, undefined, notes).canvas
    const t2 = addTableBlock(c, notes)
    c = t2.canvas
    notes = t2.notes
    c = addNode(c, 'sql', undefined, notes).canvas
    expect(c.nodes).toHaveLength(6)
    expect(pairs(c, notes)).toEqual([])
    // the description of the first box is not under a later block
    const first = rects(c, notes).find(r => r.id === 'custom-1')!
    for (const o of rects(c, notes)) if (o.id !== 'custom-1') expect(overlaps(first, o)).toBe(false)
  })

  it('a table block with many columns pushes the next node clear of its taller rectangle', () => {
    let notes = emptyNotes()
    const t = addTableBlock(emptyCanvas(), notes)
    let c = t.canvas
    notes = { ...t.notes, schema: t.notes.schema.map(s => ({ ...s, cols: [...s.cols, ...s.cols, ...s.cols, ...s.cols, ...s.cols, ...s.cols] })) }
    for (let i = 0; i < 9; i++) c = addNode(c, 'service', undefined, notes).canvas
    expect(pairs(c, notes)).toEqual([])
  })

  it('stays deterministic, integer, and leaves existing nodes where they are', () => {
    const run = () => {
      let c = setSub(addCustom(emptyCanvas()).canvas, 'custom-1', 'x'.repeat(60))
      c = addNode(c, 'gateway').canvas
      c = addCustom(c).canvas
      return c
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(a.nodes.every(n => Number.isInteger(n.x) && Number.isInteger(n.y))).toBe(true)
    expect(a.nodes[0]).toMatchObject({ id: 'custom-1', x: 1, y: 1 })
    const before = a.nodes.map(n => ({ ...n }))
    const after = addNode(a, 'queue').canvas
    expect(after.nodes.slice(0, before.length)).toEqual(before)
  })

  it('normalizeCanvas stays a no-op on what placement produced (no write when opening a session)', () => {
    let c = setSub(addCustom(emptyCanvas()).canvas, 'custom-1', 'Composites layer')
    c = addNode(c, 'cache').canvas
    expect(normalizeCanvas(c)).toEqual(c)
  })
})
