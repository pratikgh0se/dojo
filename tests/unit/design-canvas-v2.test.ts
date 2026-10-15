import { describe, expect, it } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import {
  addCustom, addFrame, addNode, addSticky, addTableBlock, editSticky, emptyCanvas, frameOf, groupNode, groupNodes, moveSticky, nodeView, normalizeCanvas,
  removeFrame, removeNode, removeSticky, renameFrame, renameTableNode, setFrame, setFrameKind, setGlyph, setNodeLabel,
  setSchemaLink, setSub, syncTableNodes, toEngineJson, ungroupNode, type KitCanvas,
} from '../../src/rules/designCanvas'
import { addTable, emptyNotes, removeTable, renameTable } from '../../src/rules/designNotes'

describe('normalizeCanvas, old sessions (Review Focus 1)', () => {
  it('loads a pre-v2 canvas with the same nodes and links and the new keys defaulted', () => {
    const c = normalizeCanvas(legacy.canvas)
    expect(c.nodes).toEqual(legacy.canvas.nodes)
    expect(c.links).toEqual(legacy.canvas.links)
    expect(c.zones).toEqual([])
    expect(c.notes).toEqual([])
  })
  it('is idempotent', () => {
    const once = normalizeCanvas(legacy.canvas)
    expect(normalizeCanvas(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })
})

describe('normalizeCanvas, new items', () => {
  const raw = {
    nodes: [
      { id: 'custom-1', kind: 'custom', label: 'Render engine', x: 1, y: 1, sub: 's'.repeat(120), glyph: 'teapot' },
      { id: 'table-1', kind: 'table', label: 'layers', x: 8, y: 1, schemaId: 's1' },
      { id: 'sql-1', kind: 'sql', label: 'Sql', x: 15, y: 1, sub: 'ignored', schemaId: 'ignored' },
    ],
    links: [{ from: 'custom-1', to: 'sql-1', kind: 'request' }],
    notes: [{ id: 'note-1', x: 2.4, y: 3, text: 't'.repeat(400) }, { id: 'note-1', x: 0, y: 0, text: 'dup' }, { x: 1 }],
    zones: [
      { id: 'f1', label: ' Write path ', kind: 'vpc', nodes: ['custom-1', 'ghost'] },
      { id: 'f2', label: 'Other', kind: 'nope', nodes: ['custom-1', 'sql-1'] },
      { id: 'f3', label: 'Empty', kind: 'team', nodes: [] },
    ],
  }
  it('keeps custom boxes (sub capped at 80, bad glyph to process), table links, and drops stray keys', () => {
    const c = normalizeCanvas(raw)
    expect(c.nodes[0]).toEqual({ id: 'custom-1', kind: 'custom', label: 'Render engine', x: 1, y: 1, sub: 's'.repeat(80), glyph: 'process' })
    expect(c.nodes[1]).toMatchObject({ kind: 'table', schemaId: 's1' })
    expect(c.nodes[2]).toEqual({ id: 'sql-1', kind: 'sql', label: 'Sql', x: 15, y: 1 })
  })
  it('caps stickies at 280 characters and drops duplicate ids and id-less notes', () => {
    const c = normalizeCanvas(raw)
    expect(c.notes).toEqual([{ id: 'note-1', x: 2, y: 3, text: 't'.repeat(280) }])
  })
  it('keeps frames (even empty), drops dangling members, one frame per node, bad kind to system', () => {
    const c = normalizeCanvas(raw)
    expect(c.zones).toEqual([
      { id: 'f1', label: 'Write path', kind: 'vpc', nodes: ['custom-1'] },
      { id: 'f2', label: 'Other', kind: 'system', nodes: ['sql-1'] },
      { id: 'f3', label: 'Empty', kind: 'team', nodes: [] },
    ])
  })
  it('limits stickies to 20 and frames to 8', () => {
    const c = normalizeCanvas({
      nodes: [], notes: Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, text: '' })),
      zones: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, label: 'F', kind: 'system', nodes: [] })),
    })
    expect(c.notes).toHaveLength(20)
    expect(c.zones).toHaveLength(8)
  })
  it('coerces unknown link kinds to sync unless lenient (the digest keeps what is stored)', () => {
    expect(normalizeCanvas(raw).links[0].kind).toBe('sync')
    expect(normalizeCanvas(raw, { lenientLinks: true }).links[0].kind).toBe('request')
  })
})

describe('removeNode prunes frames', () => {
  it('drops the id from its frame and keeps the frame', () => {
    const c: KitCanvas = { ...addNode(emptyCanvas(), 'sql').canvas, zones: [{ id: 'frame-1', label: 'F', kind: 'system', nodes: ['sql-1'] }] }
    expect(removeNode(c, 'sql-1').zones).toEqual([{ id: 'frame-1', label: 'F', kind: 'system', nodes: [] }])
  })
})

describe('nodeView and toEngineJson', () => {
  it('draws a custom box as its glyph with the description as sub, keeping label', () => {
    const c = normalizeCanvas({ nodes: [{ id: 'custom-1', kind: 'custom', label: 'Render engine', x: 1, y: 1, sub: 'Composites tiles', glyph: 'gpu' }] })
    expect(toEngineJson(c).nodes[0]).toEqual({ id: 'custom-1', kind: 'gpu', label: 'Render engine', x: 1, y: 1, sub: 'Composites tiles' })
  })
  it('derives a linked table block from the schema (name and field lines)', () => {
    let { notes, id } = addTable(emptyNotes(), 'layers')
    notes = { ...notes, schema: [{ ...notes.schema[0], cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'doc_id', type: 'uuid', key: 'FK' }] }] }
    const c = normalizeCanvas({ nodes: [{ id: 'table-1', kind: 'table', label: 'old name', x: 1, y: 1, schemaId: id }] })
    expect(nodeView(c.nodes[0], notes)).toEqual({ label: 'layers', kind: 'table', sub: undefined, fields: ['id uuid PK', 'doc_id uuid FK'] })
    expect(toEngineJson(c, notes).nodes[0]).toMatchObject({ label: 'layers', kind: 'table', fields: ['id uuid PK', 'doc_id uuid FK'] })
  })
  it('a table whose schema entry is gone stays a plain table node', () => {
    const c = normalizeCanvas({ nodes: [{ id: 'table-1', kind: 'table', label: 'layers', x: 1, y: 1, schemaId: 's9' }] })
    expect(toEngineJson(c, emptyNotes()).nodes[0]).toEqual({ id: 'table-1', kind: 'table', label: 'layers', x: 1, y: 1 })
  })
  it('passes frames without ids and never includes stickies', () => {
    const c = normalizeCanvas({ nodes: [{ id: 'sql-1', kind: 'sql', label: 'S', x: 0, y: 0 }], notes: [{ id: 'n1', x: 0, y: 0, text: 'hi' }], zones: [{ id: 'f1', label: 'W', kind: 'vpc', nodes: ['sql-1'] }] })
    const e = toEngineJson(c)
    expect(e.zones).toEqual([{ label: 'W', kind: 'vpc', nodes: ['sql-1'] }])
    expect(e).not.toHaveProperty('notes')
  })
})

describe('setNodeLabel', () => {
  it('keeps typed spaces, caps at 40, and ignores an empty label', () => {
    const c = addCustom(emptyCanvas()).canvas
    expect(setNodeLabel(c, 'custom-1', 'Render ').nodes[0].label).toBe('Render ')
    expect(setNodeLabel(c, 'custom-1', 'x'.repeat(60)).nodes[0].label).toHaveLength(40)
    expect(setNodeLabel(c, 'custom-1', '')).toBe(c)
  })
})

describe('custom box', () => {
  it('adds custom-1, custom-2 with a default glyph and no description', () => {
    const a = addCustom(emptyCanvas())
    const b = addCustom(a.canvas)
    expect([a.id, b.id]).toEqual(['custom-1', 'custom-2'])
    expect(a.canvas.nodes[0]).toMatchObject({ kind: 'custom', label: 'Custom 1', glyph: 'process' })
    expect(a.canvas.nodes[0].sub).toBeUndefined()
  })
  it('caps the description at 80 and removes it when emptied; glyph must be a kit kind', () => {
    const c = addCustom(emptyCanvas()).canvas
    expect(setSub(c, 'custom-1', 'x'.repeat(90)).nodes[0].sub).toHaveLength(80)
    expect(setSub(setSub(c, 'custom-1', 'hi'), 'custom-1', '').nodes[0].sub).toBeUndefined()
    expect(setGlyph(c, 'custom-1', 'gpu').nodes[0].glyph).toBe('gpu')
    expect(setGlyph(c, 'custom-1', 'teapot')).toBe(c)
  })
  it('ignores description and glyph on a kit node', () => {
    const c = addNode(emptyCanvas(), 'sql').canvas
    expect(setSub(c, 'sql-1', 'x')).toBe(c)
    expect(setGlyph(c, 'sql-1', 'gpu')).toBe(c)
  })
})

describe('schema table block', () => {
  it('creates the node and the schema table together, linked, label = table name', () => {
    const r = addTableBlock(emptyCanvas(), emptyNotes())
    expect(r.nodeId).toBe('table-1')
    expect(r.notes.schema).toHaveLength(1)
    expect(r.canvas.nodes[0]).toMatchObject({ kind: 'table', schemaId: r.notes.schema[0].id, label: r.notes.schema[0].name })
  })
  it('does nothing at 12 tables', () => {
    let notes = emptyNotes(); let canvas = emptyCanvas()
    for (let i = 0; i < 12; i++) { const r = addTableBlock(canvas, notes); canvas = r.canvas; notes = r.notes }
    const over = addTableBlock(canvas, notes)
    expect(over.nodeId).toBeNull()
    expect(over.canvas).toBe(canvas)
  })
  it('rename from the block renames the table; rename in the editor flows to the block (DESIGN-28)', () => {
    const r = addTableBlock(emptyCanvas(), emptyNotes())
    const viaBlock = renameTableNode(r.canvas, r.notes, 'table-1', 'layers')
    expect(viaBlock.notes.schema[0].name).toBe('layers')
    expect(viaBlock.canvas.nodes[0].label).toBe('layers')
    const edited = renameTable(r.notes, r.notes.schema[0].id, 'tiles')
    expect(syncTableNodes(r.canvas, edited).nodes[0].label).toBe('tiles')
  })
  it('deleting the schema table keeps the block as a plain table node (DESIGN-29)', () => {
    const r = addTableBlock(emptyCanvas(), emptyNotes())
    const gone = removeTable(r.notes, r.notes.schema[0].id)
    const c = syncTableNodes(r.canvas, gone)
    expect(c.nodes[0]).toEqual({ id: 'table-1', kind: 'table', label: r.canvas.nodes[0].label, x: r.canvas.nodes[0].x, y: r.canvas.nodes[0].y })
  })
  it('deleting the block keeps the schema table (DESIGN-30)', () => {
    const r = addTableBlock(emptyCanvas(), emptyNotes())
    expect(removeNode(r.canvas, 'table-1').nodes).toEqual([])
    expect(r.notes.schema).toHaveLength(1)
  })
  it('syncTableNodes returns the same object when nothing changes; a plain table can be linked and unlinked', () => {
    const r = addTableBlock(emptyCanvas(), emptyNotes())
    expect(syncTableNodes(r.canvas, r.notes)).toBe(r.canvas)
    const plain = addNode(emptyCanvas(), 'table').canvas
    const linked = setSchemaLink(plain, 'table-1', r.notes.schema[0].id, r.notes)
    expect(linked.nodes[0]).toMatchObject({ schemaId: r.notes.schema[0].id, label: r.notes.schema[0].name })
    expect(setSchemaLink(linked, 'table-1', null, r.notes).nodes[0].schemaId).toBeUndefined()
  })
  it('a stale link never re-attaches: removing the highest table id, syncing, then adding reuses the id but not the block', () => {
    const a = addTableBlock(emptyCanvas(), emptyNotes())
    const b = addTableBlock(a.canvas, a.notes)
    const lastId = b.notes.schema[1].id
    const gone = removeTable(b.notes, lastId)
    const canvas = syncTableNodes(b.canvas, gone)
    expect(canvas.nodes[1].schemaId).toBeUndefined()
    const again = addTable(gone)
    expect(again.id).toBe(lastId)
    expect(syncTableNodes(canvas, again.notes).nodes[1].schemaId).toBeUndefined()
    expect(syncTableNodes(canvas, again.notes)).toBe(canvas)
  })
  it('setSchemaLink to an unknown table leaves the node alone; renaming a plain table block just relabels it', () => {
    const plain = addNode(emptyCanvas(), 'table').canvas
    expect(setSchemaLink(plain, 'table-1', 'nope', emptyNotes())).toBe(plain)
    const r = renameTableNode(plain, emptyNotes(), 'table-1', 'orders')
    expect(r.canvas.nodes[0].label).toBe('orders')
  })
})

describe('stickies', () => {
  it('adds up to 20, edits to 280, moves by cells never below 0, removes', () => {
    let c = emptyCanvas()
    for (let i = 0; i < 20; i++) c = addSticky(c).canvas
    expect(c.notes).toHaveLength(20)
    const over = addSticky(c)
    expect(over.id).toBeNull()
    expect(over.canvas).toBe(c)
    const one = addSticky(emptyCanvas())
    expect(editSticky(one.canvas, one.id!, 'z'.repeat(400)).notes[0].text).toHaveLength(280)
    expect(moveSticky(one.canvas, one.id!, -99, -99).notes[0]).toMatchObject({ x: 0, y: 0 })
    const x0 = one.canvas.notes[0].x
    expect(moveSticky(one.canvas, one.id!, 4, 0).notes[0].x).toBe(x0 + 4)
    expect(removeSticky(one.canvas, one.id!).notes).toEqual([])
  })
})

describe('frames', () => {
  const two = () => addNode(addNode(emptyCanvas(), 'gateway').canvas, 'sql').canvas
  it('addFrame makes an empty frame, up to 8', () => {
    let c = two()
    const a = addFrame(c)
    expect(a.canvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: [] }])
    c = a.canvas
    for (let i = 1; i < 8; i++) c = addFrame(c).canvas
    expect(addFrame(c).id).toBeNull()
  })
  it('a node is in one frame: setFrame moves it, null removes it', () => {
    let c = addFrame(addFrame(two()).canvas).canvas
    c = setFrame(c, 'gateway-1', 'frame-1')
    expect(c.zones[0].nodes).toEqual(['gateway-1'])
    c = setFrame(c, 'gateway-1', 'frame-2')
    expect(c.zones.map(z => z.nodes)).toEqual([[], ['gateway-1']])
    expect(frameOf(c, 'gateway-1')?.id).toBe('frame-2')
    expect(setFrame(c, 'gateway-1', null).zones.map(z => z.nodes)).toEqual([[], []])
  })
  it('G groups the node into a new frame; Shift+G deletes its frame and keeps the nodes', () => {
    let c = two()
    const g = groupNode(c, 'gateway-1')
    expect(g.canvas.zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: ['gateway-1'] }])
    c = setFrame(g.canvas, 'sql-1', 'frame-1')
    const u = ungroupNode(c, 'gateway-1')
    expect(u.zones).toEqual([])
    expect(u.nodes.map(n => n.id)).toEqual(['gateway-1', 'sql-1'])
    expect(ungroupNode(two(), 'gateway-1').zones).toEqual([])
  })
  it('removeFrame keeps the nodes; rename and kind are validated', () => {
    const c = groupNode(two(), 'sql-1').canvas
    expect(renameFrame(c, 'frame-1', 'Write path ').zones[0].label).toBe('Write path ')
    expect(setFrameKind(c, 'frame-1', 'vpc').zones[0].kind).toBe('vpc')
    expect(setFrameKind(c, 'frame-1', 'nope')).toBe(c)
    const gone = removeFrame(c, 'frame-1')
    expect(gone.zones).toEqual([])
    expect(gone.nodes).toHaveLength(2)
  })
})

describe('groupNodes (G with several selected blocks)', () => {
  const three = () => {
    let c = addNode(emptyCanvas(), 'gateway').canvas
    c = addNode(c, 'sql').canvas
    return addNode(c, 'cache').canvas
  }
  it('puts every given block in ONE new frame, taken out of any frame they were in', () => {
    const c0 = groupNode(three(), 'gateway-1').canvas
    const g = groupNodes(c0, ['gateway-1', 'sql-1'])
    expect(g.id).toBe('frame-2')
    expect(g.canvas.zones.map(z => z.nodes)).toEqual([[], ['gateway-1', 'sql-1']])
  })
  it('ignores unknown and repeated ids; with none left nothing changes', () => {
    const c = three()
    expect(groupNodes(c, ['ghost', 'sql-1', 'sql-1']).canvas.zones[0].nodes).toEqual(['sql-1'])
    const none = groupNodes(c, ['ghost'])
    expect(none).toEqual({ canvas: c, id: null })
    expect(groupNodes(c, [])).toEqual({ canvas: c, id: null })
  })
})
