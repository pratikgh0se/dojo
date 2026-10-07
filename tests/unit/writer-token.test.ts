import { afterEach, describe, expect, it, vi } from 'vitest'

// Addendum 3: the launcher opens /#writer=<token>; the app keeps it and removes it from the URL.
afterEach(() => { history.replaceState(null, '', '/') })

describe('writer token capture', () => {
  it('moves #writer=<token> into storage and strips it from the URL, keeping the path', async () => {
    history.replaceState(null, '', '/today#writer=tok_123-abc')
    localStorage.removeItem('dojo.writer')
    vi.resetModules()
    const w = await import('../../src/data/writer')
    expect(w.writerToken()).toBe('tok_123-abc')
    expect(localStorage.getItem('dojo.writer')).toBe('tok_123-abc')
    expect(location.hash).toBe('')
    expect(location.pathname).toBe('/today')
    expect(w.writerHeaders()).toEqual({ 'X-Dojo-Writer': 'tok_123-abc' })
  })

  it('without a token there is no header', async () => {
    localStorage.removeItem('dojo.writer')
    vi.resetModules()
    const w = await import('../../src/data/writer')
    expect(w.writerToken()).toBeNull()
    expect(w.writerHeaders()).toEqual({})
  })
})

describe('G4 #6: a malformed fragment is still stripped', () => {
  it('#writer=%E0%A4 (bad percent-encoding) leaves the URL clean and stores nothing', async () => {
    history.replaceState(null, '', '/today#writer=%E0%A4')
    localStorage.removeItem('dojo.writer')
    vi.resetModules()
    const w = await import('../../src/data/writer')
    expect(location.hash).toBe('')
    expect(location.pathname).toBe('/today')
    expect(w.writerToken()).toBeNull()
  })
})
