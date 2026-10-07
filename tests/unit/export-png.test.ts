import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportDiagramPng } from '../../src/lib/exportPng'

describe('exportDiagramPng', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports failure instead of throwing where canvas is unavailable (jsdom)', async () => {
    // jsdom does not implement canvas; stub it to the "unavailable" answer so the
    // deliberate failure path runs without jsdom's "Not implemented" stack trace.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(exportDiagramPng(null, 'x.png')).resolves.toBe(false)
    const host = document.createElement('sr-diagram')
    host.attachShadow({ mode: 'open' }).innerHTML = '<svg viewBox="0 0 300 200"></svg>'
    await expect(exportDiagramPng(host, 'x.png')).resolves.toBe(false)
  })
})
