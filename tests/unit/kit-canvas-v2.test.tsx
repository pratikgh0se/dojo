import { addKind, openTile } from '../helpers/kitPalette'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { KIT_FAMILIES, KIT_KINDS } from '../../src/content/diagramKit'
import { addNode, emptyCanvas, normalizeCanvas, type KitCanvas } from '../../src/rules/designCanvas'
import type { DesignNotes } from '../../src/rules/designDigest'
import { emptyNotes } from '../../src/rules/designNotes'
import { KitCanvas as Kit } from '../../src/screens/designSession/kit/KitCanvas'

let lastCanvas: KitCanvas = emptyCanvas()
let lastNotes: DesignNotes = emptyNotes()
function Harness({ locked = false, initial = emptyCanvas(), initialNotes = emptyNotes() }: { locked?: boolean; initial?: KitCanvas; initialNotes?: DesignNotes }) {
  const [c, setC] = useState(initial)
  const [n, setN] = useState(initialNotes)
  const [view, setView] = useState<'2d' | 'iso'>('2d')
  lastCanvas = c
  lastNotes = n
  return <Kit canvas={c} notes={n} view={view} locked={locked} exportName="x.png" onChange={setC} onNotes={setN} onView={setView} />
}
const tid = (id: string) => screen.getByTestId(id)
const engineData = () => JSON.parse(screen.getByRole('group', { name: 'Canvas drawing' }).getAttribute('data')!)

describe('tools in the palette (DESIGN-23)', () => {
  it('offers Box, Note, Table, Frame inside the kit-palette region, after one button per family and a divider, and no tile while every family is closed', () => {
    render(<Harness />)
    const region = tid('kit-palette')
    for (const id of ['kit-add-custom', 'kit-add-note', 'kit-add-table', 'kit-add-frame']) expect(within(region).getByTestId(id)).toBeInTheDocument()
    const fams = within(screen.getByRole('toolbar', { name: 'Kit families' })).getAllByRole('button')
    expect(fams.map(b => b.getAttribute('data-testid'))).toEqual(KIT_FAMILIES.map(f => `kit-family-${f.family}`))
    expect(fams.map(b => b.getAttribute('aria-expanded'))).toEqual(fams.map(() => 'false'))
    expect(document.querySelectorAll('[data-testid^="kit-tile-"]')).toHaveLength(0)
    expect(tid('kit-count-notes')).toHaveTextContent('0 of 20 notes')
    expect(tid('kit-count-frames')).toHaveTextContent('0 of 8 frames')
  })
  it('disables every tool when locked', () => {
    render(<Harness locked />)
    for (const id of ['kit-add-custom', 'kit-add-table']) expect(tid(id)).toBeDisabled()
  })
  it('gives every kit tile a kit-tile-<kind> hook and clicking one adds a node of that kind', () => {
    render(<Harness />)
    for (const k of KIT_KINDS) expect(openTile(k)).toHaveAttribute('data-kind', k)
    addKind('sql')
    expect(tid('kit-node-sql-1')).toHaveAttribute('data-kind', 'sql')
  })
  it('puts the 2D and Iso switch behind kit-view-2d and kit-view-iso', () => {
    render(<Harness />)
    expect(tid('kit-view-2d')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(tid('kit-view-iso'))
    expect(tid('kit-view-iso')).toHaveAttribute('aria-pressed', 'true')
    expect(tid('kit-view-2d')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('custom box (DESIGN-24 to 26)', () => {
  it('adds a node with data-kind custom, selects it, focuses the node label, and edits label, description (80) and glyph', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    expect(tid('kit-node-custom-1')).toHaveAttribute('data-kind', 'custom')
    expect(tid('kit-node-custom-1')).toHaveAttribute('aria-pressed', 'true')
    expect(tid('kit-node-label')).toHaveFocus()
    fireEvent.change(tid('kit-custom-label'), { target: { value: 'Render engine' } })
    fireEvent.change(tid('kit-custom-sub'), { target: { value: 's'.repeat(90) } })
    expect(lastCanvas.nodes[0]).toMatchObject({ kind: 'custom', label: 'Render engine' })
    expect(lastCanvas.nodes[0].sub).toHaveLength(80)
    expect(tid('kit-custom-sub-count')).toHaveTextContent('80 / 80')
    fireEvent.change(tid('kit-custom-glyph'), { target: { value: 'gpu' } })
    expect(lastCanvas.nodes[0].glyph).toBe('gpu')
  })
  it('lists every kit kind except table and custom as a glyph, process by default', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    const opts = within(tid('kit-custom-glyph')).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(opts).toEqual(KIT_KINDS.filter(k => k !== 'table'))
    expect(opts).not.toContain('custom')
    expect(tid('kit-custom-glyph')).toHaveValue('process')
  })
  it('keeps a space typed in the middle of the label', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    fireEvent.change(tid('kit-custom-label'), { target: { value: 'Render ' } })
    expect(lastCanvas.nodes[0].label).toBe('Render ')
    expect(tid('kit-node-label')).toHaveValue('Render ')
  })
  it('commits the node label input live, with no blur needed, and keeps a mid-word space', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    fireEvent.change(tid('kit-node-label'), { target: { value: 'Render ' } })
    expect(lastCanvas.nodes[0].label).toBe('Render ')
    fireEvent.change(tid('kit-node-label'), { target: { value: 'Render e' } })
    expect(lastCanvas.nodes[0].label).toBe('Render e')
    expect(tid('kit-custom-label')).toHaveValue('Render e')
  })
  it('commits a plain kit node label live too', () => {
    render(<Harness initial={addNode(emptyCanvas(), 'gateway').canvas} />)
    fireEvent.click(tid('kit-node-gateway-1'))
    fireEvent.change(tid('kit-node-label'), { target: { value: 'Edge API' } })
    expect(lastCanvas.nodes[0].label).toBe('Edge API')
  })
  it('hands the engine the glyph kind and the description, never the custom kind', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    fireEvent.change(tid('kit-custom-sub'), { target: { value: 'Composites tiles' } })
    expect(engineData().nodes[0]).toMatchObject({ kind: 'process', sub: 'Composites tiles' })
  })
})

describe('schema table block (DESIGN-27 to 30)', () => {
  it('Table adds a linked node and a schema table at once, and the engine draws the columns', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-table'))
    expect(tid('kit-node-table-1')).toHaveAttribute('data-kind', 'table')
    expect(tid('kit-node-label')).toHaveFocus()
    expect(lastNotes.schema).toHaveLength(1)
    expect(lastCanvas.nodes[0]).toMatchObject({ schemaId: lastNotes.schema[0].id, label: lastNotes.schema[0].name })
    expect(engineData().nodes[0].fields ?? []).toEqual([]) // a new table has no columns until the learner adds them
  })
  it('lists the columns in the block as ul/li, one per column, and omits the list for an orphaned block', () => {
    const notes: DesignNotes = { ...emptyNotes(), schema: [{ id: 's1', name: 'layers', cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'doc_id', type: 'uuid', key: 'FK' }] }] }
    const canvas: KitCanvas = { ...emptyCanvas(), nodes: [{ id: 'table-1', kind: 'table', label: 'layers', x: 1, y: 1, schemaId: 's1' }, { id: 'table-2', kind: 'table', label: 'lonely', x: 9, y: 1 }] }
    render(<Harness initial={canvas} initialNotes={notes} />)
    const ul = tid('kit-node-fields-table-1')
    expect(tid('kit-node-table-1')).toContainElement(ul)
    expect(ul.tagName).toBe('UL')
    expect(within(ul).getAllByRole('listitem').map(li => li.textContent)).toEqual(['id uuid PK', 'doc_id uuid FK'])
    expect(screen.queryByTestId('kit-node-fields-table-2')).toBeNull()
  })
  it('renaming the block renames the schema table', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-table'))
    const input = tid('kit-node-label')
    fireEvent.change(input, { target: { value: 'layers' } })
    expect(lastNotes.schema[0].name).toBe('layers')
    expect(lastCanvas.nodes[0].label).toBe('layers')
    fireEvent.blur(input)
    expect(lastNotes.schema[0].name).toBe('layers')
  })
  it('keeps a space typed mid-name in a linked block label (the draft survives the trimming rename)', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-table'))
    fireEvent.change(tid('kit-node-label'), { target: { value: 'my ' } })
    expect(tid('kit-node-label')).toHaveValue('my ')
    fireEvent.change(tid('kit-node-label'), { target: { value: 'my layers' } })
    expect(lastNotes.schema[0].name).toBe('my layers')
    expect(tid('kit-node-label')).toHaveValue('my layers')
  })
  it('follows a schema rename made elsewhere and detaches a block whose table was deleted', () => {
    function Wrap() {
      const [c, setC] = useState(emptyCanvas())
      const [n, setN] = useState(emptyNotes())
      lastCanvas = c
      return (
        <>
          <button type="button" data-testid="ext-rename" onClick={() => setN({ ...n, schema: n.schema.map(t => ({ ...t, name: 'orders' })) })} />
          <button type="button" data-testid="ext-drop" onClick={() => setN({ ...n, schema: [] })} />
          <Kit canvas={c} notes={n} view="2d" locked={false} exportName="x.png" onChange={setC} onNotes={setN} onView={() => {}} />
        </>
      )
    }
    render(<Wrap />)
    fireEvent.click(tid('kit-add-table'))
    fireEvent.click(tid('ext-rename'))
    expect(lastCanvas.nodes[0].label).toBe('orders')
    fireEvent.click(tid('ext-drop'))
    expect(lastCanvas.nodes[0].schemaId).toBeUndefined()
  })
  it('a plain table node can be linked to a schema table from the select', () => {
    render(<Harness initialNotes={{ ...emptyNotes(), schema: [{ id: 's1', name: 'users', cols: [] }] }} />)
    addKind('table')
    fireEvent.change(tid('kit-table-select'), { target: { value: 's1' } })
    expect(lastCanvas.nodes[0]).toMatchObject({ schemaId: 's1', label: 'users' })
  })
})

describe('links between custom, table and kit nodes (DESIGN-26)', () => {
  const setup = () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    addKind('gateway')
  }
  it('links by pressing the source port and releasing over the target, default kind sync, and changes the kind', () => {
    setup()
    const target = tid('kit-node-gateway-1')
    document.elementsFromPoint = () => [target]
    // jsdom has no PointerEvent: a plain Event drops button/clientX, so set them on the event itself
    const down = createEvent.pointerDown(tid('kit-port-custom-1'))
    Object.defineProperties(down, { button: { value: 0 }, clientX: { value: 5 }, clientY: { value: 5 } })
    fireEvent(tid('kit-port-custom-1'), down)
    const up = createEvent.pointerUp(window)
    Object.defineProperties(up, { clientX: { value: 40 }, clientY: { value: 40 } })
    fireEvent(window, up)
    expect(tid('kit-link-custom-1-gateway-1')).toHaveAttribute('data-kind', 'sync')
    fireEvent.click(tid('kit-link-custom-1-gateway-1'))
    expect(tid('kit-link-kind')).toHaveValue('sync')
    fireEvent.change(tid('kit-link-kind'), { target: { value: 'async' } })
    expect(lastCanvas.links[0]).toMatchObject({ from: 'custom-1', to: 'gateway-1', kind: 'async' })
  })
  it('links with L then a click on the target', () => {
    setup()
    fireEvent.click(tid('kit-node-custom-1'))
    fireEvent.keyDown(tid('kit-node-custom-1'), { key: 'L' })
    expect(tid('kit-status')).toHaveTextContent('Link from Custom 1: pick a target')
    fireEvent.click(tid('kit-node-gateway-1'))
    expect(tid('kit-link-custom-1-gateway-1')).toHaveAttribute('data-kind', 'sync')
  })
})

describe('write-nothing guard for notes sync (DESIGN-78)', () => {
  const schemaNotes = (name: string): DesignNotes => ({ ...emptyNotes(), schema: [{ id: 's1', name, cols: [{ name: 'id', type: 'uuid', key: 'PK' }] }] })
  const tableCanvas = (schemaId: string): KitCanvas => ({ ...emptyCanvas(), nodes: [{ id: 'table-1', kind: 'table', label: 'layers', x: 1, y: 1, schemaId }] })
  const view = (canvas: KitCanvas, notes: DesignNotes, locked: boolean, onChange: (c: KitCanvas) => void) =>
    <Kit canvas={canvas} notes={notes} view="2d" locked={locked} exportName="x.png" onChange={onChange} onNotes={() => {}} onView={() => {}} />

  it.each([false, true])('mounting a table block whose schema table is missing writes nothing (locked=%s)', locked => {
    const onChange = vi.fn()
    render(view(tableCanvas('gone'), emptyNotes(), locked, onChange))
    expect(onChange).not.toHaveBeenCalled()
  })
  it('a locked canvas does not write when the notes change', () => {
    const onChange = vi.fn()
    const canvas = tableCanvas('s1')
    const { rerender } = render(view(canvas, schemaNotes('layers'), true, onChange))
    rerender(view(canvas, schemaNotes('layers_v2'), true, onChange))
    expect(onChange).not.toHaveBeenCalled()
  })
  it('an unlocked canvas writes exactly once, the synced canvas, when the notes change', () => {
    const onChange = vi.fn()
    const canvas = tableCanvas('s1')
    const { rerender } = render(view(canvas, schemaNotes('layers'), false, onChange))
    expect(onChange).not.toHaveBeenCalled()
    rerender(view(canvas, schemaNotes('layers_v2'), false, onChange))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].nodes[0]).toMatchObject({ id: 'table-1', label: 'layers_v2', schemaId: 's1' })
  })
})

describe('Table tool without a notes sink', () => {
  it('is disabled and adds nothing when onNotes is absent', () => {
    const onChange = vi.fn()
    render(<Kit canvas={emptyCanvas()} view="2d" locked={false} exportName="x.png" onChange={onChange} onView={() => {}} />)
    expect(tid('kit-add-table')).toBeDisabled()
    fireEvent.click(tid('kit-add-table'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

/** jsdom has no PointerEvent: build the event and give it the fields the handlers read. */
function ptr(type: 'pointerDown' | 'pointerMove' | 'pointerUp', el: Element, x: number, y: number) {
  const ev = createEvent[type](el)
  Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: y }, button: { value: 0 }, pointerId: { value: 1 } })
  fireEvent(el, ev)
}

describe('text notes (DESIGN-31 to 33)', () => {
  it('Note adds a sticky positioned over the canvas, focuses its textarea, stores text capped at 280', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-note'))
    const sticky = tid('kit-note-note-1')
    expect(sticky.tagName).not.toBe('svg')
    expect(sticky.style.left).not.toBe('')
    expect(tid('kit-note-text-note-1')).toHaveFocus()
    fireEvent.change(tid('kit-note-text-note-1'), { target: { value: 'Edits are small diffs' } })
    expect(lastCanvas.notes[0]).toMatchObject({ id: 'note-1', text: 'Edits are small diffs' })
    expect(tid('kit-note-text-note-1')).toHaveAttribute('maxlength', '280')
    expect(tid('kit-count-notes')).toHaveTextContent('1 of 20 notes')
  })
  it('keeps data-x and data-y in cells and is absolutely positioned in 2D (DESIGN-31)', () => {
    const c = { ...emptyCanvas(), notes: [{ id: 'note-1', x: 3, y: 2, text: '' }] }
    render(<Harness initial={c} />)
    const sticky = tid('kit-note-note-1')
    expect(sticky).toHaveAttribute('data-x', '3')
    expect(sticky).toHaveAttribute('data-y', '2')
    expect(getComputedStyle(sticky).position).toBe('absolute')
  })
  it('arrows move the sticky one cell when the sticky has focus, not when its textarea does', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-note'))
    const x0 = lastCanvas.notes[0].x
    fireEvent.keyDown(tid('kit-note-text-note-1'), { key: 'ArrowLeft' })
    expect(lastCanvas.notes[0].x).toBe(x0)
    const sticky = tid('kit-note-note-1')
    sticky.focus()
    for (let i = 0; i < 3; i++) fireEvent.keyDown(sticky, { key: 'ArrowRight' })
    expect(lastCanvas.notes[0].x).toBe(x0 + 3)
    fireEvent.keyDown(sticky, { key: 'Delete' })
    expect(lastCanvas.notes).toEqual([])
  })
  it('floors the sticky at cell 0 on ArrowLeft', () => {
    const c = { ...emptyCanvas(), notes: [{ id: 'note-1', x: 1, y: 0, text: '' }] }
    render(<Harness initial={c} />)
    const sticky = tid('kit-note-note-1')
    sticky.focus()
    for (let i = 0; i < 4; i++) fireEvent.keyDown(sticky, { key: 'ArrowLeft' })
    expect(lastCanvas.notes[0].x).toBe(0)
  })
  it('letters and Backspace typed in the textarea type; they never move or delete the sticky', () => {
    const c = { ...emptyCanvas(), notes: [{ id: 'note-1', x: 1, y: 1, text: 'abc' }] }
    render(<Harness initial={c} />)
    const ta = tid('kit-note-text-note-1')
    ta.focus()
    for (const key of ['n', 'c', 't', 'g', 'l', 'Backspace', 'Delete']) fireEvent.keyDown(ta, { key })
    expect(lastCanvas.notes).toHaveLength(1)
    expect(lastCanvas.nodes).toHaveLength(0)
    expect(lastCanvas.notes[0]).toMatchObject({ x: 1, y: 1 })
  })
  it('a pointerdown on the textarea does not start a drag; one on the sticky does and ends with the sticky focused', () => {
    const c = { ...emptyCanvas(), notes: [{ id: 'note-1', x: 1, y: 1, text: '' }] }
    render(<Harness initial={c} />)
    const sticky = tid('kit-note-note-1')
    const ta = tid('kit-note-text-note-1')
    const capture = vi.fn()
    sticky.setPointerCapture = capture
    ptr('pointerDown', ta, 100, 100)
    ptr('pointerMove', sticky, 220, 100)
    ptr('pointerUp', sticky, 220, 100)
    expect(capture).not.toHaveBeenCalled()
    expect(lastCanvas.notes[0].x).toBe(1)
    ptr('pointerDown', sticky, 100, 100)
    expect(capture).toHaveBeenCalled()
    ptr('pointerMove', sticky, 196, 100)
    ptr('pointerUp', sticky, 196, 100)
    expect(lastCanvas.notes[0].x).toBe(5)
    expect(sticky).toHaveFocus()
  })
  it('disables Note at 20 stickies', () => {
    let c = emptyCanvas()
    c = { ...c, notes: Array.from({ length: 20 }, (_, i) => ({ id: `note-${i + 1}`, x: i, y: 0, text: '' })) }
    render(<Harness initial={c} />)
    expect(tid('kit-add-note')).toBeDisabled()
    expect(tid('kit-count-notes')).toHaveTextContent('20 of 20 notes')
  })
  it('in Iso no sticky is drawn; kit-notes-list lists every text and a count', () => {
    const c = { ...emptyCanvas(), notes: [{ id: 'note-1', x: 1, y: 1, text: 'one' }, { id: 'note-2', x: 2, y: 2, text: 'two' }] }
    render(<Harness initial={c} />)
    fireEvent.click(tid('kit-view-iso'))
    expect(screen.queryByTestId('kit-note-note-1')).toBeNull()
    expect(tid('kit-notes-list')).toHaveTextContent('2 notes')
    expect(tid('kit-notes-list')).toHaveTextContent('one')
    expect(tid('kit-notes-list')).toHaveTextContent('two')
    expect(tid('kit-notes-list').querySelectorAll('li')).toHaveLength(2)
  })
})

const press = (el: HTMLElement, key: string, o: object = {}) => fireEvent.keyDown(el, { key, ...o })

describe('frames (DESIGN-34 to 38, 40)', () => {
  it('Frame adds an empty frame row with label, kind (exactly seven options) and remove', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-frame'))
    expect(lastCanvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: [] }])
    expect(within(tid('kit-frames')).getByTestId('kit-frame-frame-1')).toBeInTheDocument()
    fireEvent.change(tid('kit-frame-label-frame-1'), { target: { value: 'Write path' } })
    fireEvent.change(tid('kit-frame-kind-frame-1'), { target: { value: 'vpc' } })
    expect(lastCanvas.zones[0]).toMatchObject({ label: 'Write path', kind: 'vpc', nodes: [] })
    expect(within(tid('kit-frame-kind-frame-1')).getAllByRole('option').map(o => o.textContent)).toEqual(['system', 'region', 'az', 'vpc', 'trust', 'tenant', 'team'])
    expect(tid('kit-count-frames')).toHaveTextContent('1 of 8 frames')
    fireEvent.click(tid('kit-frame-remove-frame-1'))
    expect(lastCanvas.zones).toEqual([])
  })
  it('trims a frame name on commit but keeps a space typed mid-name in the box', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-frame'))
    fireEvent.change(tid('kit-frame-label-frame-1'), { target: { value: '  Edge ' } })
    expect(lastCanvas.zones[0].label).toBe('Edge')
    expect(tid('kit-frame-label-frame-1')).toHaveValue('  Edge ')
    fireEvent.change(tid('kit-frame-label-frame-1'), { target: { value: 'Edge tier' } })
    expect(lastCanvas.zones[0].label).toBe('Edge tier')
    fireEvent.change(tid('kit-frame-label-frame-1'), { target: { value: '   ' } })
    expect(lastCanvas.zones[0].label).toBe('Edge tier')
    fireEvent.blur(tid('kit-frame-label-frame-1'))
    expect(tid('kit-frame-label-frame-1')).toHaveValue('Edge tier')
  })
  it('the Frame select puts the selected node in exactly one frame; None removes it', () => {
    render(<Harness />)
    addKind('gateway')
    fireEvent.click(tid('kit-add-frame'))
    fireEvent.click(tid('kit-add-frame'))
    fireEvent.click(tid('kit-node-gateway-1'))
    expect(within(tid('kit-frame-select')).getAllByRole('option').map(o => o.textContent)).toEqual(['None', 'Frame 1', 'Frame 2'])
    fireEvent.change(tid('kit-frame-select'), { target: { value: 'frame-1' } })
    expect(lastCanvas.zones.map(z => z.nodes)).toEqual([['gateway-1'], []])
    fireEvent.change(tid('kit-frame-select'), { target: { value: 'frame-2' } })
    expect(lastCanvas.zones.map(z => z.nodes)).toEqual([[], ['gateway-1']])
    fireEvent.change(tid('kit-frame-select'), { target: { value: '' } })
    expect(lastCanvas.zones.map(z => z.nodes)).toEqual([[], []])
  })
  it('adding a frame selects nothing', () => {
    render(<Harness />)
    addKind('gateway')
    fireEvent.click(tid('kit-add-frame'))
    expect(lastCanvas.zones[0].nodes).toEqual([])
  })
  it('disables Frame at 8 frames', () => {
    const c = { ...emptyCanvas(), zones: Array.from({ length: 8 }, (_, i) => ({ id: `frame-${i + 1}`, label: 'F', kind: 'system', nodes: [] as string[] })) }
    render(<Harness initial={c} />)
    expect(tid('kit-add-frame')).toBeDisabled()
    expect(tid('kit-count-frames')).toHaveTextContent('8 of 8 frames')
  })
})

describe('canvas keys (DESIGN-39 to 41, 44, 18)', () => {
  it('N, C and T add a note, a custom box and a table block, each ready to be named', () => {
    render(<Harness />)
    const canvas = tid('kit-canvas')
    canvas.focus()
    press(canvas, 'n')
    expect(lastCanvas.notes).toHaveLength(1)
    expect(tid('kit-note-text-note-1')).toHaveFocus()
    press(canvas, 'c')
    expect(lastCanvas.nodes.map(n => n.kind)).toEqual(['custom'])
    expect(tid('kit-node-label')).toHaveFocus()
    press(canvas, 't')
    expect(lastCanvas.nodes.map(n => n.kind)).toEqual(['custom', 'table'])
    expect(tid('kit-node-label')).toHaveFocus()
    expect(lastNotes.schema).toHaveLength(1)
  })
  it('G frames the selected node and moves focus to the new frame name; Shift+G deletes the frame and keeps the node', () => {
    render(<Harness />)
    addKind('sql')
    const canvas = tid('kit-canvas')
    press(canvas, 'G', { shiftKey: true })
    expect(lastCanvas.zones).toEqual([])
    press(tid('kit-node-sql-1'), 'g')
    expect(lastCanvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: ['sql-1'] }])
    expect(within(tid('kit-frames')).getByTestId('kit-frame-frame-1')).toBeInTheDocument()
    expect(tid('kit-frame-label-frame-1')).toHaveFocus()
    press(tid('kit-node-sql-1'), 'G', { shiftKey: true })
    expect(lastCanvas.zones).toEqual([])
    expect(lastCanvas.nodes).toHaveLength(1)
  })
  it('G with nothing selected does nothing', () => {
    render(<Harness />)
    press(tid('kit-canvas'), 'g')
    expect(lastCanvas.zones).toEqual([])
  })
  it('does nothing when locked', () => {
    render(<Harness locked />)
    press(tid('kit-canvas'), 'n')
    press(tid('kit-canvas'), 'c')
    expect(lastCanvas.notes).toEqual([])
    expect(lastCanvas.nodes).toEqual([])
  })
  it('? asks for the keys overlay and prevents the default; the canvas root opts out of global number keys', () => {
    let helped = 0
    render(<Kit canvas={emptyCanvas()} view="2d" locked={false} exportName="x.png" onChange={() => {}} onView={() => {}} onHelp={() => { helped++ }} />)
    const help = createEvent.keyDown(tid('kit-canvas'), { key: '?' })
    fireEvent(tid('kit-canvas'), help)
    expect(helped).toBe(1)
    expect(help.defaultPrevented).toBe(true)
    expect(tid('kit-canvas')).toHaveAttribute('data-no-global-keys')
    expect(tid('kit-canvas')).toHaveAttribute('data-focus-zone', 'canvas')
    for (const key of ['1', '2', '3', '4']) {
      const ev = createEvent.keyDown(tid('kit-canvas'), { key })
      fireEvent(tid('kit-canvas'), ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(helped).toBe(1)
  })
  it('existing keys still work: arrows move, Delete deletes (and prunes the frame), L starts a link', () => {
    render(<Harness />)
    addKind('sql')
    const x0 = lastCanvas.nodes[0].x
    press(tid('kit-node-sql-1'), 'ArrowRight')
    expect(lastCanvas.nodes[0].x).toBe(x0 + 1)
    press(tid('kit-node-sql-1'), 'l')
    expect(tid('kit-status')).toHaveTextContent('Link from')
    press(tid('kit-node-sql-1'), 'g')
    expect(lastCanvas.zones[0].nodes).toEqual(['sql-1'])
    press(tid('kit-node-sql-1'), 'Delete')
    expect(lastCanvas.nodes).toEqual([])
    expect(lastCanvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: [] }])
  })
})

describe('letters typed into fields type and never act (Review Focus 2)', () => {
  const KEYS = ['n', 'c', 't', 'g', 'G', 'l', '?', '1', '2', '3', '4']
  const untouched = (c: KitCanvas) => {
    expect(c.nodes).toHaveLength(1)
    expect(c.notes).toHaveLength(1)
    expect(c.zones).toHaveLength(1)
  }
  const seeded = () => {
    const base = addNode(emptyCanvas(), 'sql').canvas
    return { ...base, notes: [{ id: 'note-1', x: 1, y: 1, text: 'abc' }], zones: [{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: ['sql-1'] }] }
  }
  const fire = (el: HTMLElement) => {
    for (const key of KEYS) {
      const ev = createEvent.keyDown(el, { key, shiftKey: key === 'G' })
      fireEvent(el, ev)
      expect(ev.defaultPrevented).toBe(false)
    }
  }
  it('the sticky textarea', () => {
    let helped = 0
    render(<Kit canvas={seeded()} view="2d" locked={false} exportName="x.png" onChange={() => { throw new Error('wrote') }} onView={() => {}} onHelp={() => { helped++ }} />)
    fire(tid('kit-note-text-note-1'))
    expect(helped).toBe(0)
  })
  it('the node label input (selected node)', () => {
    render(<Harness initial={seeded()} />)
    fireEvent.click(tid('kit-node-sql-1'))
    fire(tid('kit-node-label'))
    untouched(lastCanvas)
    expect(lastCanvas).toEqual(seeded())
  })
  it('the frame name input and the frame kind select', () => {
    render(<Harness initial={seeded()} />)
    fire(tid('kit-frame-label-frame-1'))
    fire(tid('kit-frame-kind-frame-1'))
    expect(lastCanvas).toEqual(seeded())
  })
  it('a field inside the canvas region is also left alone by the canvas handler', () => {
    // the sticky textarea is the one field that lives inside kit-canvas: events there bubble to its root handler
    let helped = 0
    render(<Kit canvas={seeded()} view="2d" locked={false} exportName="x.png" onChange={() => { throw new Error('wrote') }} onView={() => {}} onHelp={() => { helped++ }} />)
    const ta = tid('kit-note-text-note-1')
    expect(tid('kit-canvas')).toContainElement(ta)
    press(ta, '?')
    expect(helped).toBe(0)
  })
})

describe('DESIGN-38: a zone that lists a missing block', () => {
  it('opening a canvas does not write; the first edit stores the zone without the missing id', () => {
    const raw = { ...addNode(emptyCanvas(), 'sql').canvas, zones: [{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: ['ghost', 'sql-1'] }] }
    const onChange = vi.fn()
    const opened = normalizeCanvas(raw)
    const { rerender } = render(<Kit canvas={opened} view="2d" locked={false} exportName="x.png" onChange={onChange} onView={() => {}} />)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(tid('kit-node-sql-1'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: ['sql-1'] }])
    rerender(<Kit canvas={onChange.mock.calls[0][0]} view="2d" locked={false} exportName="x.png" onChange={onChange} onView={() => {}} />)
  })
})

describe('canvas-level selection keys (14b: SHELL-05, DESIGN-40, 41, 44)', () => {
  const withSql = () => {
    render(<Harness />)
    addKind('sql')
    fireEvent.click(tid('kit-node-sql-1'))
    return tid('kit-canvas')
  }
  it('clicking a node (or a link, or empty space) leaves kit-canvas as the active element', () => {
    const canvas = withSql()
    expect(canvas).toHaveFocus()
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(document.querySelector('.kit-stage')!)
    expect(canvas).toHaveFocus()
  })
  it('does not take focus from a text field it is clicked through, nor from the sticky', () => {
    const c = { ...addNode(emptyCanvas(), 'sql').canvas, notes: [{ id: 'note-1', x: 8, y: 1, text: '' }] }
    render(<Harness initial={c} />)
    const ta = tid('kit-note-text-note-1')
    ta.focus()
    fireEvent.click(ta)
    expect(ta).toHaveFocus()
    const sticky = tid('kit-note-note-1')
    sticky.focus()
    fireEvent.click(sticky)
    expect(sticky).toHaveFocus()
    fireEvent.click(tid('kit-node-sql-1'))
    const label = tid('kit-node-label')
    label.focus()
    fireEvent.click(label)
    expect(label).toHaveFocus()
  })
  it('ArrowRight with canvas focus moves the selected node one cell', () => {
    const canvas = withSql()
    const x0 = lastCanvas.nodes[0].x
    press(canvas, 'ArrowRight')
    expect(lastCanvas.nodes[0].x).toBe(x0 + 1)
    press(canvas, 'ArrowDown')
    expect(lastCanvas.nodes[0].y).toBeGreaterThan(0)
  })
  it('L with canvas focus starts a link and Esc leaves link mode', () => {
    const canvas = withSql()
    press(canvas, 'l')
    expect(tid('kit-status')).toHaveTextContent('Link from Sql 1: pick a target')
    press(canvas, 'Escape')
    expect(tid('kit-status')).toBeEmptyDOMElement()
  })
  it('Delete with canvas focus removes the selected node and prunes its frame', () => {
    const canvas = withSql()
    press(canvas, 'g')
    expect(lastCanvas.zones[0].nodes).toEqual(['sql-1'])
    fireEvent.click(tid('kit-node-sql-1'))
    press(canvas, 'Delete')
    expect(lastCanvas.nodes).toEqual([])
    expect(lastCanvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: [] }])
  })
  it('Backspace removes a selected link; Delete removes a selected sticky', () => {
    let c = addNode(emptyCanvas(), 'sql').canvas
    c = addNode(c, 'cache').canvas
    c = { ...c, links: [{ from: 'sql-1', to: 'cache-1', kind: 'sync' }], notes: [{ id: 'note-1', x: 12, y: 8, text: '' }] }
    render(<Harness initial={c} />)
    const canvas = tid('kit-canvas')
    fireEvent.click(tid('kit-link-sql-1-cache-1'))
    press(canvas, 'Backspace')
    expect(lastCanvas.links).toEqual([])
    fireEvent.click(tid('kit-note-note-1'))
    press(canvas, 'ArrowRight')
    expect(lastCanvas.notes[0].x).toBe(13)
    press(canvas, 'Delete')
    expect(lastCanvas.notes).toEqual([])
  })
  it('clicking empty space (stage, overlay, diagram, canvas) clears the selection and link mode, so G does nothing', () => {
    const targets = [() => document.querySelector('.kit-stage')!, () => document.querySelector('.kit-overlay')!, () => document.querySelector('sr-diagram')!, () => tid('kit-canvas')]
    for (const target of targets) {
      const { unmount } = render(<Harness />)
      addKind('sql')
      fireEvent.click(tid('kit-node-sql-1'))
      press(tid('kit-node-sql-1'), 'l')
      expect(tid('kit-status')).toHaveTextContent('Link from')
      fireEvent.click(target() as Element)
      expect(tid('kit-status')).toBeEmptyDOMElement()
      expect(tid('kit-node-sql-1')).toHaveAttribute('aria-pressed', 'false')
      press(tid('kit-canvas'), 'g')
      expect(lastCanvas.zones).toEqual([])
      unmount()
    }
  })
  it('clicking a node keeps it selected (the root click does not deselect)', () => {
    withSql()
    expect(tid('kit-node-sql-1')).toHaveAttribute('aria-pressed', 'true')
  })
  it('a locked canvas ignores selection keys', () => {
    const c = addNode(emptyCanvas(), 'sql').canvas
    render(<Harness initial={c} locked />)
    fireEvent.click(tid('kit-node-sql-1'))
    const x0 = lastCanvas.nodes[0].x
    press(tid('kit-canvas'), 'ArrowRight')
    press(tid('kit-canvas'), 'Delete')
    expect(lastCanvas.nodes[0].x).toBe(x0)
    expect(lastCanvas.nodes).toHaveLength(1)
  })
})

describe('blind-run fixes: L toggles link mode, a block carries its label as text (DESIGN-41, DESIGN-28)', () => {
  const press2 = (el: Element, key: string) => fireEvent.keyDown(el, { key })
  it('L on a node starts link mode, L again leaves it, with the node or the canvas focused', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    fireEvent.change(tid('kit-node-label'), { target: { value: 'Mover' } })
    press2(tid('kit-node-custom-1'), 'L')
    expect(tid('kit-status')).toHaveTextContent('Link from Mover: pick a target')
    press2(tid('kit-node-custom-1'), 'L')
    expect(tid('kit-status')).toHaveTextContent(/^$/)
    press2(tid('kit-canvas'), 'l')
    expect(tid('kit-status')).toHaveTextContent('Link from Mover: pick a target')
    press2(tid('kit-canvas'), 'l')
    expect(tid('kit-status')).toHaveTextContent(/^$/)
    press2(tid('kit-canvas'), 'l')
    press2(tid('kit-canvas'), 'Escape')
    expect(tid('kit-status')).toHaveTextContent(/^$/)
  })
  it('a table block holds its name and then its column lines as text, in 2D as in Iso', () => {
    const notes: DesignNotes = { ...emptyNotes(), schema: [{ id: 's1', name: 'accounts', cols: [{ name: 'user_id', type: 'uuid', key: 'FK' }] }] }
    const canvas: KitCanvas = { ...emptyCanvas(), nodes: [{ id: 'table-1', kind: 'table', label: 'accounts', x: 1, y: 1, schemaId: 's1' }] }
    render(<Harness initial={canvas} initialNotes={notes} />)
    expect(tid('kit-node-table-1')).toHaveTextContent(/accounts/)
    expect(within(tid('kit-node-fields-table-1')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['user_id uuid FK'])
    fireEvent.click(tid('kit-view-iso'))
    expect(tid('kit-node-table-1')).toHaveTextContent(/accounts/)
  })
  it('G with nothing selected does nothing: a click on empty canvas, or Esc once link mode is off, clears the selection', () => {
    render(<Harness />)
    fireEvent.click(tid('kit-add-custom'))
    fireEvent.click(tid('kit-canvas'))
    press2(tid('kit-canvas'), 'g')
    expect(lastCanvas.zones).toEqual([])
    fireEvent.click(tid('kit-node-custom-1'))
    press2(tid('kit-canvas'), 'l')
    press2(tid('kit-canvas'), 'Escape') // leaves link mode, keeps the selection
    expect(tid('kit-node-custom-1')).toHaveAttribute('aria-pressed', 'true')
    press2(tid('kit-canvas'), 'Escape') // clears it
    expect(tid('kit-node-custom-1')).toHaveAttribute('aria-pressed', 'false')
    press2(tid('kit-canvas'), 'g')
    expect(lastCanvas.zones).toEqual([])
  })
})
