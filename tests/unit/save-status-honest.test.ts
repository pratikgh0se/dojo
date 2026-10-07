import { afterEach, describe, expect, it } from 'vitest'
import { safeWrite } from '../../src/data/safeWrite'
import { getSaveState, registerSyncControls, setSaveState, syncControls, syncControlsDefaults } from '../../src/data/sync/status'

// "Saved" must not show while a write is still on its way: a tick and an immediate "is it Saved?"
// check (a person glancing, or a black-box test) must never see the previous "Saved".
afterEach(() => { setSaveState('off'); registerSyncControls(syncControlsDefaults) })

describe('the save status during a write', () => {
  it('turns to "Saving…" the moment a write starts, and the loop settles it once the write lands', async () => {
    setSaveState('saved')
    let flushed = 0
    registerSyncControls({ ...syncControlsDefaults, flush: async () => { flushed++; setSaveState('saved'); return true } })
    let release: () => void = () => {}
    const p = safeWrite(() => new Promise<void>(r => { release = r }), () => {})
    expect(getSaveState()).toBe('saving') // synchronously, before the write commits
    release()
    await p
    await new Promise(r => setTimeout(r, 0))
    expect(flushed).toBe(1)
    expect(getSaveState()).toBe('saved')
  })

  it('leaves "Not saved to disk" (offline / read-only) and "off" alone', async () => {
    for (const st of ['offline', 'off'] as const) {
      setSaveState(st)
      await safeWrite(async () => {}, () => {})
      expect(getSaveState()).toBe(st)
    }
    expect(syncControls.flush).toBeTypeOf('function')
  })
})
