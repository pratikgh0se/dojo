import { describe, expect, it } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import type { DesignSession } from '../../src/data/types'
import { CLIPPED, designDigest, DIGEST_MAX, NOT_WRITTEN } from '../../src/rules/designDigest'

const base = legacy as unknown as DesignSession
const withNotes = (notes: object, canvas: object = base.canvas): DesignSession => ({ ...base, canvas: canvas as DesignSession['canvas'], notes: notes as DesignSession['notes'] })

describe('designDigest', () => {
  it('writes nodes with kind and label, links as a -kind-> b, and says not written for empty sections (DESIGN-59)', () => {
    const d = designDigest(base)
    expect(d).toContain('Gateway 1 [gateway]')
    expect(d).toContain('Gateway 1 -sync-> Service 1')
    expect(d).toContain('Service 1 -write-> Sql 1')
    for (const head of ['DIAGRAM', 'CANVAS NOTES', 'REQUIREMENTS - FUNCTIONAL', 'REQUIREMENTS - NON-FUNCTIONAL', 'ASSUMPTIONS AND ESTIMATES', 'API', 'DATA MODEL', 'TRADE-OFFS', 'OPEN QUESTIONS']) expect(d).toContain(head)
    expect(d).toContain(`API\n${NOT_WRITTEN}`)
  })
  it('keeps a stored link kind the app would not draw', () => {
    const canvas = { nodes: [{ id: 'c', kind: 'browser', label: 'Client', x: 0, y: 0 }, { id: 'g', kind: 'gateway', label: 'API gateway', x: 8, y: 0 }], links: [{ from: 'c', to: 'g', kind: 'request' }] }
    expect(designDigest(withNotes({}, canvas))).toContain('Client -request-> API gateway')
  })
  it('includes typed sections, stickies, frames, custom boxes and the schema as DDL-like lines', () => {
    const canvas = {
      nodes: [{ id: 'custom-1', kind: 'custom', label: 'Render engine', x: 1, y: 1, sub: 'Composites tiles', glyph: 'gpu' }, { id: 'table-1', kind: 'table', label: 'layers', x: 8, y: 1, schemaId: 's1' }],
      links: [], notes: [{ id: 'n1', x: 0, y: 0, text: 'Edits are small diffs' }], zones: [{ id: 'f1', label: 'Write path', kind: 'vpc', nodes: ['custom-1', 'table-1'] }],
    }
    const d = designDigest(withNotes({ api: 'POST /photos', assumptions: 'RPS 20000', schema: [{ id: 's1', name: 'layers', cols: [{ name: 'doc_id', type: 'uuid', key: 'FK', note: 'owner' }] }] }, canvas))
    expect(d).toContain('Render engine [custom, drawn as gpu] - Composites tiles')
    expect(d).toContain('Write path (vpc): Render engine, layers')
    expect(d).toContain('Edits are small diffs')
    expect(d).toContain('POST /photos')
    expect(d).toContain('RPS 20000')
    expect(d).toContain('TABLE layers\n  doc_id uuid FK -- owner')
  })
  it('a session with no diagram reads DIAGRAM not written', () => {
    expect(designDigest({ ...base, canvas: { layout: 'manual', nodes: [], links: [] } as never })).toContain(`DIAGRAM\n${NOT_WRITTEN}`)
  })
  it('clips deterministically to max, keeps every heading, and ends with [clipped]', () => {
    const big = 'x'.repeat(2000)
    const s = withNotes({ reqFn: big, reqNfr: big, assumptions: big, api: big, dataModel: big, tradeoffs: big, open: big })
    const a = designDigest(s)
    expect(a.length).toBeLessThanOrEqual(DIGEST_MAX)
    expect(a.endsWith(CLIPPED)).toBe(true)
    expect(designDigest(s)).toBe(a)
    for (const head of ['REQUIREMENTS - FUNCTIONAL', 'API', 'TRADE-OFFS', 'OPEN QUESTIONS']) expect(a).toContain(head)
    expect(designDigest(s, 3000).length).toBeLessThanOrEqual(3000)
    expect(designDigest(base).endsWith(CLIPPED)).toBe(false)
  })
})
