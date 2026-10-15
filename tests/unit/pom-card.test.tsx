import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { getSettings } from '../../src/data/db'
import { DebugPom } from '../../src/screens/DebugPom'
import { PomCard } from '../../src/screens/today/PomCard'
import { FORMUP_MS, FORMUP_REDUCED_MS } from '../../src/ui/PomReward'
import { usePowerUp } from '../../src/ui/primitives'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

afterEach(() => { vi.useRealTimers(); delete (window as { matchMedia?: unknown }).matchMedia })

const stage = () => document.querySelector('pom-stage')!
const reduced = () => { window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia }

function Fire({ xp = true }: { xp?: boolean }) {
  const { fire } = usePowerUp()
  return <button onClick={() => fire(undefined, xp)}>fire</button>
}
function renderApp(db: ReturnType<typeof freshDb>, ui: React.ReactElement) {
  return render(<AppProviders db={db} plan={flatPlanV2}>{ui}</AppProviders>)
}

describe('PomCard (TODAY-50)', () => {
  it('shows BASE at 0 XP: stage, name, LV, next form and a meter over XP 0 to 100', () => {
    renderApp(freshDb(), <PomCard xp={0} formMax={undefined} />)
    expect(stage().getAttribute('data-testid')).toBe('today-pom-stage')
    expect(stage().getAttribute('data-form')).toBe('0')
    expect(stage().getAttribute('data-pose')).toBe('idle')
    expect(screen.getByTestId('form-name').textContent).toBe('POM · BASE')
    expect(screen.getByTestId('level')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('level').textContent).toBe('LV 0')
    expect(screen.getByTestId('form-next').textContent).toBe('to KINDLE · 100 XP')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemin', '0')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
  })
  it('395 XP is KINDLE, 5 XP from SURGE; the meter spans 100 to 400', () => {
    renderApp(freshDb(), <PomCard xp={395} formMax={undefined} />)
    expect(screen.getByTestId('form-name').textContent).toBe('POM · KINDLE')
    expect(screen.getByTestId('form-next').textContent).toBe('to SURGE · 5 XP')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemin', '100')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '400')
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '395')
  })
  it('lights the meter by progress inside the form: 11 of 12 at 395 XP, none at the form start, 6 half way', () => {
    const lit = () => document.querySelectorAll('.pom-cube[data-on="true"]').length
    const { unmount } = renderApp(freshDb(), <PomCard xp={395} formMax={undefined} />)
    expect(document.querySelectorAll('.pom-cube')).toHaveLength(12)
    expect(lit()).toBe(11)
    unmount()
    renderApp(freshDb(), <PomCard xp={100} formMax={undefined} />)
    expect(lit()).toBe(0)
  })
  it('the stored maximum wins over a lower LV, and SOVEREIGN is final: no meter', () => {
    renderApp(freshDb(), <PomCard xp={395} formMax={8} />)
    expect(stage().getAttribute('data-form')).toBe('8')
    expect(screen.getByTestId('form-name').textContent).toBe('POM · SOVEREIGN')
    expect(screen.getByTestId('form-next').textContent).toMatch(/sovereign · final form/i)
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByTestId('level').textContent).toBe('LV 39')
  })
  it('holds no control, link or accent', () => {
    renderApp(freshDb(), <PomCard xp={50} formMax={undefined} />)
    const card = screen.getByTestId('today-pom')
    expect(card.querySelectorAll('button, a, input, select, [tabindex]')).toHaveLength(0)
    expect(card.hasAttribute('data-accent')).toBe(false)
  })
  it('is in the power-up pose while a reward plays (1.8 s), then idle', () => {
    vi.useFakeTimers()
    renderApp(freshDb(), <><PomCard xp={0} formMax={undefined} /><Fire /></>)
    fireEvent.click(screen.getByText('fire'))
    expect(stage().getAttribute('data-pose')).toBe('powerup')
    act(() => { vi.advanceTimersByTime(1799) })
    expect(stage().getAttribute('data-pose')).toBe('powerup')
    act(() => { vi.advanceTimersByTime(1) })
    expect(stage().getAttribute('data-pose')).toBe('idle')
  })
})

describe('the form-up reward (TODAY-52, TODAY-54, TODAY-55)', () => {
  const edge = async (extra: { pomFormMax?: number } = {}) => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'a', status: 'done', xp: 395 })) // LV 39, KINDLE: one XP action from SURGE
    if (extra.pomFormMax !== undefined) await d.settings.put({ id: 'main', startDate: '', planVersion: '', aiProviders: {}, possibleXp: 0, ...extra })
    return d
  }

  /** The XP action itself: the layer has read the shown form on mount; the Done then adds 20 XP (LV 41), then the power-up fires. */
  const done = async (d: Awaited<ReturnType<typeof edge>>) => {
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    await d.tickets.put(mkTicket({ id: 'b', status: 'done', xp: 20 }))
    fireEvent.click(screen.getByText('fire'))
  }

  it('an XP action that lifts the form stores it and plays one celebration naming it', async () => {
    const d = await edge()
    renderApp(d, <Fire />)
    expect(screen.queryByTestId('pom-formup')).toBeNull()
    await done(d)
    const el = await screen.findByTestId('pom-formup')
    expect(el).toHaveAttribute('data-motion', 'animated')
    expect(el.textContent).toMatch(/SURGE/)
    expect(el.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
    expect((await getSettings(d)).pomFormMax).toBe(2)
    // a second action in the same form plays nothing more
    await act(async () => { fireEvent.click(screen.getByText('fire')); await new Promise(r => setTimeout(r, 50)) })
    expect((await getSettings(d)).pomFormMax).toBe(2)
  })
  it('FX-IDLE-like: a Done that keeps LV inside KINDLE stores form 1 and plays no celebration, then or later', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'a', status: 'done', xp: 320 }))
    renderApp(d, <Fire />)
    await done(d)
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    expect(screen.queryByTestId('pom-formup')).toBeNull()
    expect((await getSettings(d)).pomFormMax).toBe(1)
  })
  it('stays 2.5 s on screen, then goes', async () => {
    const d = await edge()
    renderApp(d, <Fire />)
    const delays = vi.spyOn(window, 'setTimeout')
    await done(d)
    await screen.findByTestId('pom-formup')
    expect(delays.mock.calls.map(c => c[1])).toContain(FORMUP_MS)
    expect(FORMUP_MS).toBe(2500)
    delays.mockRestore()
    await waitFor(() => expect(screen.queryByTestId('pom-formup')).toBeNull(), { timeout: 4000 })
  })
  it('reduced motion: a static notice for 2 s, same text, and no power-up pose', async () => {
    reduced()
    const d = await edge()
    renderApp(d, <><PomCard xp={415} formMax={undefined} /><Fire /></>)
    const delays = vi.spyOn(window, 'setTimeout')
    await done(d)
    const el = await screen.findByTestId('pom-formup')
    expect(el).toHaveAttribute('data-motion', 'static')
    expect(el.textContent).toMatch(/SURGE/)
    expect(stage().getAttribute('data-pose')).toBe('idle')
    expect(delays.mock.calls.map(c => c[1])).toContain(FORMUP_REDUCED_MS)
    expect(FORMUP_REDUCED_MS).toBe(2000)
    delays.mockRestore()
  })
  it('nothing is stored or played when the stored form is already at or above the form for the LV', async () => {
    const d = await edge({ pomFormMax: 8 })
    renderApp(d, <Fire />)
    fireEvent.click(screen.getByText('fire'))
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('pom-formup')).toBeNull()
    expect((await getSettings(d)).pomFormMax).toBe(8)
  })
  it('a power-up that grants no XP (a timer end) writes nothing; mounting writes nothing', async () => {
    const d = await edge()
    renderApp(d, <Fire xp={false} />)
    await new Promise(r => setTimeout(r, 50))
    expect(await d.settings.get('main')).toBeUndefined()
    fireEvent.click(screen.getByText('fire'))
    await new Promise(r => setTimeout(r, 50))
    expect(await d.settings.get('main')).toBeUndefined()
    expect(screen.queryByTestId('pom-formup')).toBeNull()
  })
})

describe('Debug · Pom (SET-09 to SET-11)', () => {
  it('previews a form on its own stage and plays the celebration for it, writing nothing', async () => {
    const d = freshDb()
    renderApp(d, <DebugPom />)
    const sel = screen.getByTestId('settings-debug-pom-form') as HTMLSelectElement
    expect([...sel.options].map(o => [o.value, o.text])).toEqual(['BASE', 'KINDLE', 'SURGE', 'TEMPEST', 'PRIMAL', 'ZENITH', 'AZURE', 'VOID', 'SOVEREIGN'].map((n, i) => [String(i), n]))
    expect(sel.value).toBe('0')
    expect(screen.getByTestId('settings-debug-pom-stage')).toHaveAttribute('data-form', '0')
    fireEvent.change(sel, { target: { value: '3' } })
    expect(screen.getByTestId('settings-debug-pom-stage')).toHaveAttribute('data-form', '3')
    fireEvent.click(screen.getByTestId('settings-debug-pom-play'))
    expect(within(screen.getByTestId('pom-formup')).getByText('TEMPEST')).toBeInTheDocument()
    expect(screen.getByTestId('settings-debug-pom-play').textContent).toBe('Play form-up')
    await new Promise(r => setTimeout(r, 30))
    expect(await d.settings.get('main')).toBeUndefined()
  })
  it('maps a level to its form, and shows nothing for a negative number, a fraction or an empty input', () => {
    renderApp(freshDb(), <DebugPom />)
    const input = screen.getByTestId('settings-debug-pom-level')
    const result = screen.getByTestId('settings-debug-pom-result')
    const lv = [0, 9, 10, 39, 40, 99, 100, 179, 180, 299, 300, 449, 450, 649, 650, 899, 900, 5000]
    const want = ['BASE', 'BASE', 'KINDLE', 'KINDLE', 'SURGE', 'SURGE', 'TEMPEST', 'TEMPEST', 'PRIMAL', 'PRIMAL', 'ZENITH', 'ZENITH', 'AZURE', 'AZURE', 'VOID', 'VOID', 'SOVEREIGN', 'SOVEREIGN']
    lv.forEach((n, i) => {
      fireEvent.change(input, { target: { value: String(n) } })
      expect(result.textContent, `LV ${n}`).toBe(want[i])
    })
    for (const bad of ['-1', '1.5', '']) {
      fireEvent.change(input, { target: { value: bad } })
      expect(result.textContent, `"${bad}"`).toBe('')
    }
  })
})
