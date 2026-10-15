import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getSettings } from '../../src/data/db'
import { Settings } from '../../src/screens/Settings'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => true }))

describe('Settings in a read-only browser', () => {
  it('disables every write control and writes nothing', async () => {
    const d = await seededDb()
    renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
    await screen.findByTestId('settings-pace')
    const ids = [...Array.from({ length: 7 }, (_, i) => `settings-budget-${i}`), 'settings-session-minutes', 'settings-career-lane', 'settings-nav-labels']
    for (const id of ids) expect(screen.getByTestId(id)).toBeDisabled()
    expect(screen.getByLabelText('Start date')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save start date' })).toBeDisabled()
    const before = await getSettings(d)
    fireEvent.change(screen.getByTestId('settings-budget-1'), { target: { value: '120' } })
    fireEvent.change(screen.getByTestId('settings-session-minutes'), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('settings-career-lane'))
    fireEvent.click(screen.getByTestId('settings-nav-labels'))
    await new Promise(r => setTimeout(r, 50))
    const after = await getSettings(d)
    expect(after.laneBudgets).toBeUndefined()
    expect(after.sessionMinutes).toBe(before.sessionMinutes)
    expect(after.careerLane).toBe(before.careerLane)
    expect(after.navLabels).toBe(before.navLabels)
    expect(after.startDate).toBe(before.startDate)
  })
})
