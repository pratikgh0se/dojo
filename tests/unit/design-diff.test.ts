import { describe, expect, it } from 'vitest'
import { diffDiagrams } from '../../src/rules/designDiff'

/** C-DESIGN §7, the fixed fake `diagram` output. */
const REF = {
  layout: 'layered',
  nodes: [
    { id: 'client', kind: 'browser', label: 'Client' }, { id: 'gw', kind: 'gateway', label: 'Gateway' },
    { id: 'svc', kind: 'service', label: 'Service' }, { id: 'store', kind: 'nosql', label: 'Counters' },
  ],
  links: [{ from: 'client', to: 'gw', kind: 'sync' }, { from: 'gw', to: 'svc', kind: 'sync' }, { from: 'svc', to: 'store', kind: 'write' }],
}

/** Data set S1 (C-DESIGN D-31). */
const S1 = {
  nodes: [
    { id: 'gateway-1', kind: 'gateway', label: 'Gateway 1' }, { id: 'service-1', kind: 'service', label: 'Service 1' },
    { id: 'cache-1', kind: 'cache', label: 'Cache 1' }, { id: 'sql-1', kind: 'sql', label: 'Sql 1' },
  ],
  links: [
    { from: 'gateway-1', to: 'service-1', kind: 'async' }, { from: 'service-1', to: 'cache-1', kind: 'sync' },
    { from: 'service-1', to: 'sql-1', kind: 'write' },
  ],
}

describe('diffDiagrams (D-40)', () => {
  it('matches S1 against the fake reference', () => {
    expect(diffDiagrams(S1, REF)).toEqual({
      mine: ['cache (Cache 1)', 'sql (Sql 1)'],
      ref: ['browser (Client)', 'nosql (Counters)'],
      links: ['gateway → service: yours async, reference sync'],
    })
  })

  it('matches nodes as a multiset of kinds', () => {
    const two = { nodes: [{ id: 'a', kind: 'service', label: 'A' }, { id: 'b', kind: 'service', label: 'B' }] }
    const one = { nodes: [{ id: 'x', kind: 'service', label: 'X' }] }
    expect(diffDiagrams(two, one)).toEqual({ mine: ['service (B)'], ref: [], links: [] })
  })

  it('compares link kinds per kind pair and ignores pairs on one side only', () => {
    const mine = { nodes: [{ id: 'a', kind: 'service' }, { id: 'b', kind: 'queue' }], links: [{ from: 'a', to: 'b' }] }
    const ref = { nodes: [{ id: 'x', kind: 'service' }, { id: 'y', kind: 'queue' }], links: [{ from: 'x', to: 'y', kind: 'async' }, { from: 'y', to: 'x', kind: 'async' }] }
    expect(diffDiagrams(mine, ref).links).toEqual(['service → queue: yours sync, reference async'])
  })

  it('is empty for identical diagrams and skips links to missing nodes', () => {
    expect(diffDiagrams(REF, REF)).toEqual({ mine: [], ref: [], links: [] })
    const broken = { ...S1, links: [...S1.links, { from: 'ghost', to: 'sql-1', kind: 'read' }] }
    expect(diffDiagrams(broken, REF).links).toEqual(['gateway → service: yours async, reference sync'])
  })
})
