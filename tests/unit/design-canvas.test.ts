import { describe, expect, it } from 'vitest'
import {
  addLink, addNode, countText, emptyCanvas, freeCell, kindTitle, linkName, moveNode, nodeName, normalizeCanvas,
  removeLink, removeNode, renameNode, setLinkKind, type KitCanvas,
} from '../../src/rules/designCanvas'

const addAll = (kinds: string[], c: KitCanvas = emptyCanvas()) => kinds.reduce((acc, k) => addNode(acc, k).canvas, c)

describe('addNode (C-DESIGN §3, D-12, D-13)', () => {
  it('numbers per kind and labels <Kind> <n>', () => {
    const c = addAll(['gateway', 'service', 'gateway', 'lb', 'sql'])
    expect(c.nodes.map(n => [n.id, n.label])).toEqual([
      ['gateway-1', 'Gateway 1'], ['service-1', 'Service 1'], ['gateway-2', 'Gateway 2'], ['lb-1', 'Lb 1'], ['sql-1', 'Sql 1'],
    ])
    expect(kindTitle('nosql')).toBe('Nosql')
  })

  it('click-adds into distinct free slots starting at (1, 1)', () => {
    const c = addAll(['gateway', 'service', 'cache', 'sql', 'queue'])
    expect(c.nodes.map(n => [n.x, n.y])).toEqual([[1, 1], [8, 1], [15, 1], [22, 1], [1, 6]])
  })

  it('skips a slot occupied by a moved node', () => {
    const lb = addNode(emptyCanvas(), 'lb').canvas
    const moved = moveNode(moveNode(lb, 'lb-1', 2, 0), 'lb-1', 0, 1)
    expect(moved.nodes[0]).toMatchObject({ x: 3, y: 2 })
    expect(freeCell(moved)).toEqual({ x: 15, y: 1 })
  })

  it('drops at an explicit cell', () => {
    const r = addNode(emptyCanvas(), 'queue', { x: 10, y: 10 })
    expect(r.id).toBe('queue-1')
    expect(r.canvas.nodes[0]).toMatchObject({ x: 10, y: 10 })
  })

  it('rejects an unknown kind', () => {
    expect(() => addNode(emptyCanvas(), 'teapot')).toThrow('unknown kind teapot')
  })

  it('continues numbering after the highest existing id', () => {
    const c = removeNode(addAll(['service', 'service']), 'service-1')
    expect(addNode(c, 'service').id).toBe('service-3')
  })
})

describe('edits', () => {
  it('moves by cells and never below 0', () => {
    const c = addAll(['cache'])
    expect(moveNode(c, 'cache-1', 2, 1).nodes[0]).toMatchObject({ x: 3, y: 2 })
    expect(moveNode(c, 'cache-1', -5, -5).nodes[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('renames with trimming and ignores blank or unchanged labels', () => {
    const c = addAll(['sql'])
    expect(renameNode(c, 'sql-1', '  Redis counters ').nodes[0].label).toBe('Redis counters')
    expect(renameNode(c, 'sql-1', '   ')).toBe(c)
    expect(renameNode(c, 'sql-1', 'Sql 1')).toBe(c)
  })

  it('links default to sync and refuse self, duplicate and missing ends (D-14)', () => {
    const c = addAll(['gateway', 'service'])
    const a = addLink(c, 'gateway-1', 'service-1')
    expect(a.added).toBe(true)
    expect(a.canvas.links).toEqual([{ from: 'gateway-1', to: 'service-1', kind: 'sync' }])
    expect(addLink(a.canvas, 'gateway-1', 'service-1').added).toBe(false)
    expect(addLink(a.canvas, 'gateway-1', 'gateway-1').added).toBe(false)
    expect(addLink(a.canvas, 'gateway-1', 'nope-1').added).toBe(false)
    expect(addLink(a.canvas, 'service-1', 'gateway-1').added).toBe(true)
  })

  it('changes a link kind only to one of the 13 kinds (D-15)', () => {
    const c = addLink(addAll(['gateway', 'service']), 'gateway-1', 'service-1').canvas
    expect(setLinkKind(c, 'gateway-1', 'service-1', 'async').links[0].kind).toBe('async')
    expect(setLinkKind(c, 'gateway-1', 'service-1', 'teleport')).toBe(c)
  })

  it('removing a node removes its links (D-18.6, D-19)', () => {
    let c = addAll(['lb', 'service', 'sql'])
    c = addLink(c, 'lb-1', 'service-1').canvas
    c = addLink(c, 'service-1', 'sql-1').canvas
    c = removeNode(c, 'service-1')
    expect(c.nodes.map(n => n.id)).toEqual(['lb-1', 'sql-1'])
    expect(c.links).toEqual([])
    expect(countText(c)).toBe('2 nodes · 0 links')
  })

  it('removes a single link', () => {
    const c = addLink(addAll(['lb', 'service']), 'lb-1', 'service-1').canvas
    expect(removeLink(c, 'lb-1', 'service-1').links).toEqual([])
  })
})

describe('names and counts (C-DESIGN §2)', () => {
  it('uses fixed plural counts', () => {
    expect(countText(emptyCanvas())).toBe('0 nodes · 0 links')
    expect(countText(addAll(['lb']))).toBe('1 nodes · 0 links')
  })

  it('names nodes and links', () => {
    const c = setLinkKind(addLink(addAll(['gateway', 'service']), 'gateway-1', 'service-1').canvas, 'gateway-1', 'service-1', 'async')
    expect(nodeName(c.nodes[0])).toBe('Gateway 1 · gateway')
    expect(linkName(c, c.links[0])).toBe('Gateway 1 to Service 1 · async')
  })
})

describe('normalizeCanvas (Review Focus #4)', () => {
  it('keeps a valid canvas as is', () => {
    const c = addLink(addAll(['gateway', 'service']), 'gateway-1', 'service-1').canvas
    expect(normalizeCanvas(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  it('repairs odd stored JSON', () => {
    const raw = {
      layout: 'layered',
      nodes: [
        { id: 'a', kind: 'service', label: 'A', x: 2.6, y: -3 },
        { id: 'a', kind: 'service', label: 'dup' },
        { id: 'b', kind: 'teapot', label: 'B' },
        { id: 'c', kind: 'sql', label: '', x: 'x' },
      ],
      links: [
        { from: 'a', to: 'c', kind: 'bogus' },
        { from: 'a', to: 'c', kind: 'write' },
        { from: 'a', to: 'b' },
        { from: 'c', to: 'c' },
      ],
    }
    expect(normalizeCanvas(raw)).toEqual({
      layout: 'manual',
      nodes: [{ id: 'a', kind: 'service', label: 'A', x: 3, y: 0 }, { id: 'c', kind: 'sql', label: 'c', x: 0, y: 0 }],
      links: [{ from: 'a', to: 'c', kind: 'sync' }],
      zones: [],
      flows: [],
    })
    expect(normalizeCanvas(null)).toEqual(emptyCanvas())
  })
})
