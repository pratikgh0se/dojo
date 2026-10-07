import { afterEach, describe, expect, it, vi } from 'vitest'
import { playChime } from '../../src/lib/chime'

afterEach(() => vi.unstubAllGlobals())

describe('playChime', () => {
  it('returns false and never throws when there is no audio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(playChime()).toBe(false)
  })
  it('plays two soft notes when audio exists', () => {
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn().mockReturnThis(), start: vi.fn(), stop: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis() }
    class Ctx {
      state = 'running'
      currentTime = 0
      destination = {}
      createOscillator() { return osc }
      createGain() { return gain }
    }
    vi.stubGlobal('AudioContext', Ctx)
    expect(playChime()).toBe(true)
    expect(osc.start).toHaveBeenCalledTimes(2)
  })
  it('a throwing audio context is swallowed', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked') } })
    // the shared context may already exist from the previous test; either way it must not throw
    expect(() => playChime()).not.toThrow()
  })
})

describe('primeChime', () => {
  it('creates and resumes the context so a later chime can sound', async () => {
    const { primeChime } = await import('../../src/lib/chime')
    const resume = vi.fn().mockResolvedValue(undefined)
    let made = 0
    class Ctx { state = 'suspended'; constructor() { made++ } resume() { return resume() } }
    vi.stubGlobal('AudioContext', Ctx)
    vi.resetModules()
    const fresh = await import('../../src/lib/chime')
    expect(fresh.primeChime()).toBe(true)
    expect(made).toBe(1)
    expect(resume).toHaveBeenCalled()
    expect(primeChime).toBeTypeOf('function')
  })
})
