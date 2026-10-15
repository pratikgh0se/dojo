import { describe, expect, it, vi } from 'vitest'
import { openPartnerWindow, partnerUrl, partnerWindowState } from '../../src/screens/designSession/partner/openPartnerWindow'

describe('openPartnerWindow (A2)', () => {
  it('builds <origin>/#/partner/<id>', () => expect(partnerUrl('http://127.0.0.1:8787', 'ds-1')).toBe('http://127.0.0.1:8787/#/partner/ds-1'))
  it('opens a named window and remembers it', () => {
    const opener = vi.fn(() => ({}) as Window)
    expect(openPartnerWindow('ds-1', opener)).toBe('opened')
    expect(opener).toHaveBeenCalledWith(`${window.location.origin}/#/partner/ds-1`, 'dojo-partner-ds-1', expect.stringContaining('width='))
    expect(partnerWindowState('ds-1')).toBe('opened')
  })
  it('a blocked window (null) and a throwing opener both read as blocked', () => {
    expect(openPartnerWindow('ds-2', () => null)).toBe('blocked')
    expect(openPartnerWindow('ds-3', () => { throw new Error('no') })).toBe('blocked')
    expect(partnerWindowState('ds-2')).toBe('blocked')
    expect(partnerWindowState('ds-never')).toBeNull()
  })
  it('the default opener reads window.open when called, not at import', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openPartnerWindow('ds-4')).toBe('blocked')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
