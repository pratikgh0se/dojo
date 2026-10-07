import { describe, expect, it } from 'vitest'
import { exportDiagramPng } from '../../src/lib/exportPng'

describe('exportDiagramPng', () => {
  it('reports failure instead of throwing where canvas is unavailable (jsdom)', async () => {
    await expect(exportDiagramPng(null, 'x.png')).resolves.toBe(false)
    const host = document.createElement('sr-diagram')
    host.attachShadow({ mode: 'open' }).innerHTML = '<svg viewBox="0 0 300 200"></svg>'
    await expect(exportDiagramPng(host, 'x.png')).resolves.toBe(false)
  })
})
