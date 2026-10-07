import { describe, expect, it, vi } from 'vitest'
import { QUOTA_MESSAGE, isQuotaError, safeWrite } from '../../src/data/safeWrite'

describe('safeWrite', () => {
  it('returns the value on success', async () => {
    const onError = vi.fn()
    expect(await safeWrite(async () => 7, onError)).toBe(7)
    expect(onError).not.toHaveBeenCalled()
  })
  it('reports quota errors and swallows them', async () => {
    const onError = vi.fn()
    const r = await safeWrite(async () => { throw new DOMException('full', 'QuotaExceededError') }, onError)
    expect(r).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(QUOTA_MESSAGE)
  })
  it('recognises Dexie-wrapped quota errors', () => {
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true)
    expect(isQuotaError(new Error('x'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
  it('rethrows other errors', async () => {
    await expect(safeWrite(async () => { throw new Error('boom') }, () => {})).rejects.toThrow('boom')
  })
})
