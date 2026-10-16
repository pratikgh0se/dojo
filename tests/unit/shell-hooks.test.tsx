import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { useGlobalKeys } from '../../src/app/useGlobalKeys'
import { useRailLabels } from '../../src/app/useRailLabels'
import { getSettings, patchSettings, type DojoDB } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

const { go, ro } = vi.hoisted(() => ({ go: vi.fn(), ro: { on: false } }))
// navigation is the router's own, immediate (R18): the hook calls useNavigate() and never waits on a write
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => go }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

beforeEach(() => { go.mockClear(); ro.on = false })
const added: HTMLElement[] = []
const add = <T extends HTMLElement>(el: T): T => { document.body.appendChild(el); added.push(el); return el }
afterEach(() => { while (added.length) added.pop()!.remove() })

describe('useGlobalKeys', () => {
  const setup = (over: Partial<Parameters<typeof useGlobalKeys>[0]> = {}) => {
    const onPalette = vi.fn(); const onShortcuts = vi.fn()
    const r = renderHook(() => useGlobalKeys({ overlayOpen: false, onPalette, onShortcuts, ...over }))
    return { onPalette, onShortcuts, ...r }
  }
  it('goes to a destination on 1 to 6 and opens shortcuts on ? from the page body', () => {
    const { onShortcuts } = setup()
    for (const [k, to] of [['1', '/'], ['2', '/path'], ['3', '/board'], ['4', '/journal'], ['5', '/skills'], ['6', '/review']] as const) {
      fireEvent.keyDown(document.body, { key: k })
      expect(go).toHaveBeenLastCalledWith(to)
    }
    fireEvent.keyDown(document.body, { key: '?' })
    expect(onShortcuts).toHaveBeenCalledTimes(1)
    for (const k of ['7', '8', '9', '0']) fireEvent.keyDown(document.body, { key: k })
    expect(go).toHaveBeenCalledTimes(6)
  })
  it('"/" on /path focuses a search box that is already drawn even before Path has registered its own handler (UAT A J11.8)', () => {
    setup()
    window.history.pushState({}, '', '/path')
    try {
      const box = add(document.createElement('input'))
      box.setAttribute('data-testid', 'path-search')
      fireEvent.keyDown(document.body, { key: '/' })
      expect(document.activeElement).toBe(box)
    } finally { window.history.pushState({}, '', '/') }
  })
  it('stays out of text fields, the canvas, [data-no-global-keys] zones and modified presses', () => {
    const { onShortcuts } = setup()
    const box = add(document.createElement('input'))
    const canvas = add(document.createElement('div')); canvas.setAttribute('data-testid', 'kit-canvas')
    const zone = document.createElement('div'); zone.setAttribute('data-no-global-keys', ''); const inside = document.createElement('span'); zone.appendChild(inside); add(zone)
    for (const t of [box, canvas, inside]) { fireEvent.keyDown(t, { key: '2' }); fireEvent.keyDown(t, { key: '?' }) }
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) fireEvent.keyDown(document.body, { key: '3', ...mod })
    expect(go).not.toHaveBeenCalled()
    expect(onShortcuts).not.toHaveBeenCalled()
  })
  it('ignores a key another handler already took', () => {
    setup()
    const stop = (e: KeyboardEvent) => e.preventDefault()
    document.body.addEventListener('keydown', stop)
    fireEvent.keyDown(document.body, { key: '2' })
    document.body.removeEventListener('keydown', stop)
    expect(go).not.toHaveBeenCalled()
  })
  it('opens the palette on Ctrl+K and Cmd+K, also inside a text field', () => {
    const { onPalette } = setup()
    const box = add(document.createElement('textarea'))
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(onPalette).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document.body, { key: 'k' })
    expect(onPalette).toHaveBeenCalledTimes(2)
  })
  it('does nothing with the digits and ? while an overlay is open, but still takes Ctrl+K', () => {
    const { onPalette, onShortcuts } = setup({ overlayOpen: true })
    fireEvent.keyDown(document.body, { key: '2' })
    fireEvent.keyDown(document.body, { key: '?' })
    expect(go).not.toHaveBeenCalled()
    expect(onShortcuts).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(onPalette).toHaveBeenCalledTimes(1)
  })
  it('stops listening when unmounted', () => {
    const { unmount } = setup()
    unmount()
    fireEvent.keyDown(document.body, { key: '2' })
    expect(go).not.toHaveBeenCalled()
  })
})

describe('useRailLabels', () => {
  async function boot(settings: Record<string, unknown>) {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, ...settings })
    const wrapper = ({ children }: { children: ReactNode }) => <AppProviders db={d} plan={flatPlanV2} planV2={null}>{children}</AppProviders>
    return { d, wrapper }
  }
  const stored = async (d: DojoDB) => (await getSettings(d)).navLabels

  it('shows the labels for the whole first page load and stores hover at once (SHELL-08, SHELL-09)', async () => {
    const { d, wrapper } = await boot({})
    const { result, unmount } = renderHook(() => useRailLabels(), { wrapper })
    await waitFor(() => expect(result.current.expanded).toBe(true))
    await waitFor(async () => expect(await stored(d)).toBe('hover'))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(result.current.expanded).toBe(true)
    unmount()
    const again = renderHook(() => useRailLabels(), { wrapper })
    await waitFor(async () => expect(await stored(d)).toBe('hover'))
    await waitFor(() => expect(again.result.current.expanded).toBe(false))
  })
  it('treats a stored intro like a fresh install', async () => {
    const { d, wrapper } = await boot({ navLabels: 'intro' })
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await waitFor(() => expect(result.current.expanded).toBe(true))
    await waitFor(async () => expect(await stored(d)).toBe('hover'))
    expect(result.current.expanded).toBe(true)
  })
  it('keeps the rail collapsed from hover, and writes nothing', async () => {
    const { d, wrapper } = await boot({ navLabels: 'hover' })
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(result.current.expanded).toBe(false)
    expect(await stored(d)).toBe('hover')
  })
  it('follows the Settings switch at once, and off gives the collapsed rail', async () => {
    const { d, wrapper } = await boot({ navLabels: 'hover' })
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    await act(async () => { await patchSettings(d, { navLabels: 'always' }) })
    await waitFor(() => expect(result.current.expanded).toBe(true))
    await act(async () => { await patchSettings(d, { navLabels: 'hover' }) })
    await waitFor(() => expect(result.current.expanded).toBe(false))
  })
  it('switching always off during the first page load also collapses the rail', async () => {
    const { d, wrapper } = await boot({})
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await waitFor(() => expect(result.current.expanded).toBe(true))
    await act(async () => { await patchSettings(d, { navLabels: 'always' }) })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) }) // the hook must see `always` before it is switched off (two writes in one tick collapse into one change)
    await act(async () => { await patchSettings(d, { navLabels: 'hover' }) })
    await waitFor(() => expect(result.current.expanded).toBe(false))
  })
  it('shows no labels before onboarding is done', async () => {
    const { d, wrapper } = await boot({ startDate: '' })
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(result.current.expanded).toBe(false)
    expect(await stored(d)).toBeUndefined()
  })
  it('never writes in a read-only browser, but still shows the labels this load', async () => {
    ro.on = true
    const { d, wrapper } = await boot({})
    const { result } = renderHook(() => useRailLabels(), { wrapper })
    await waitFor(() => expect(result.current.expanded).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(await stored(d)).toBeUndefined()
  })
})
