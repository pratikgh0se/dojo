import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useShippedBanks } from '../../src/content/banks/useShippedBanks'

describe('useShippedBanks', () => {
  it('starts null (loading) and resolves to the shipped banks via a dynamic import', async () => {
    const { result } = renderHook(() => useShippedBanks())
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(Object.keys(result.current!).sort()).toEqual(
      ['blind75', 'codeforces', 'hellointerview', 'neetcode150', 'striver'].sort(),
    )
    expect(result.current!.blind75!.bank).toBe('blind75')
  })

  it('a second hook instance gets the cached value without waiting', async () => {
    const first = renderHook(() => useShippedBanks())
    await waitFor(() => expect(first.result.current).not.toBeNull())
    const second = renderHook(() => useShippedBanks())
    expect(second.result.current).not.toBeNull()
  })
})
