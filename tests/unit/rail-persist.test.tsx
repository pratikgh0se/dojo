// Leftover 1 (NAV-42): toggle the rail and reload inside the Dexie write window. The click leaves a marker in localStorage at once; a
// boot that finds it shows that state on first paint and finishes the write.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RAIL_PENDING_KEY, useRailLabels } from '../../src/app/useRailLabels'
import { useSettings } from '../../src/data/hooks'
import type { DojoDB } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { appPlans } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const stall = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/settingsActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/settingsActions')>()
  return { ...real, saveNavLabels: (...a: Parameters<typeof real.saveNavLabels>) => (stall.on ? new Promise<void>(() => {}) : real.saveNavLabels(...a)) }
})
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

function Rail() {
  const r = useRailLabels()
  const s = useSettings()
  return <button data-testid="t" data-stored={s?.navLabels ?? ''} aria-expanded={r.expanded} onClick={r.toggle}>{r.expanded ? 'expanded' : 'collapsed'}</button>
}
async function mount(d: DojoDB = freshDb(), navLabels: 'always' | 'hover' = 'always') {
  if (!(await d.settings.get('main'))) await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, navLabels })
  renderWithApp(<Rail />, { db: d, ...appPlans({}) })
  await waitFor(() => expect(screen.getByTestId('t')).toHaveAttribute('data-stored', navLabels))
  return d
}
afterEach(() => { cleanup(); stall.on = false; ro.on = false; window.localStorage.clear() })

describe('the rail toggle is persisted synchronously (leftover 1)', () => {
  it('leaves the marker at the click, before the Dexie write has settled', async () => {
    stall.on = true
    await mount()
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('expanded'))
    fireEvent.click(screen.getByTestId('t'))
    expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBe('hover') // synchronous: no await between the click and this read
    expect(screen.getByTestId('t')).toHaveTextContent('collapsed')
  })

  it('a reload inside the window shows the toggled state on the first load, then finishes the write', async () => {
    stall.on = true
    const d = await mount()
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('expanded'))
    fireEvent.click(screen.getByTestId('t'))
    cleanup() // "reload": the stalled write is lost, the setting still says always
    expect((await d.settings.get('main'))!.navLabels).toBe('always')
    await mount(d) // the write still stalls: the rail must already follow the marker, not the stored value
    expect(screen.getByTestId('t')).toHaveAttribute('data-stored', 'always')
    expect(screen.getByTestId('t')).toHaveTextContent('collapsed')
    cleanup()
    stall.on = false
    await mount(d)
    await waitFor(async () => expect((await d.settings.get('main'))!.navLabels).toBe('hover'))
    await waitFor(() => expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBeNull())
    expect(screen.getByTestId('t')).toHaveTextContent('collapsed')
  })

  it('works in the other direction too (collapsed, toggle, reload)', async () => {
    stall.on = true
    const d = await mount(freshDb(), 'hover')
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('collapsed'))
    fireEvent.click(screen.getByTestId('t'))
    expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBe('always')
    cleanup()
    await mount(d, 'hover')
    expect(screen.getByTestId('t')).toHaveTextContent('expanded')
    cleanup()
    stall.on = false
    await mount(d, 'hover')
    await waitFor(async () => expect((await d.settings.get('main'))!.navLabels).toBe('always'))
  })

  it('clears the marker when the write lands, and a read-only browser never writes one', async () => {
    await mount()
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('expanded'))
    fireEvent.click(screen.getByTestId('t'))
    await waitFor(() => expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBeNull())
    window.localStorage.clear()
    ro.on = true
    fireEvent.click(screen.getByTestId('t'))
    expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBeNull()
  })

  it('a read-only browser ignores a marker it finds and leaves it for the writer', async () => {
    window.localStorage.setItem(RAIL_PENDING_KEY, 'hover')
    ro.on = true
    await mount()
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('expanded'))
    expect(window.localStorage.getItem(RAIL_PENDING_KEY)).toBe('hover')
  })
})
