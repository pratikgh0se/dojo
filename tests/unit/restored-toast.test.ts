import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveRestoredToast, PAGE_ID, RESTORED_KEY, takeRestoredToast } from '../../src/lib/restoredToast'

describe('the line a restore leaves for the page that comes back (consume once)', () => {
  beforeEach(() => sessionStorage.removeItem(RESTORED_KEY))

  it('is not taken by the page that left it, however often that page remounts', () => {
    leaveRestoredToast('Restored x')
    expect(takeRestoredToast()).toBeNull()
    expect(takeRestoredToast()).toBeNull()
    expect(sessionStorage.getItem(RESTORED_KEY)).not.toBeNull()
  })

  it('is taken once by a later page, and then gone', async () => {
    leaveRestoredToast('Restored x')
    vi.resetModules()
    const later = await import('../../src/lib/restoredToast')
    expect(later.PAGE_ID).not.toBe(PAGE_ID)
    expect(later.takeRestoredToast()).toBe('Restored x')
    expect(later.takeRestoredToast()).toBeNull()
    expect(sessionStorage.getItem(RESTORED_KEY)).toBeNull()
  })

  it('says nothing when there is no line, or the stored line is not one of ours', () => {
    expect(takeRestoredToast()).toBeNull()
    sessionStorage.setItem(RESTORED_KEY, 'plain text from an older build')
    expect(takeRestoredToast()).toBeNull()
  })
})
