import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Settings } from '../../src/screens/Settings'
import { patchSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

async function setup(labsRoot?: string) {
  setNow(() => new Date('2026-11-04T10:00:00+05:30').getTime())
  const d = await seededDb()
  if (labsRoot !== undefined) await patchSettings(d, { labsRoot })
  renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
  return d
}

describe('Settings: the labs folder (LAB-58, LAB-59)', () => {
  it('shows ~/labs as the placeholder when nothing is stored, and writes nothing on load', async () => {
    const d = await setup()
    const input = (await screen.findByTestId('settings-labs-root')) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('~/labs')
    expect(screen.getByTestId('settings-labs-root-help').textContent).toMatch(/where|folder inside this folder|~\/labs/)
    expect(await d.settings.get('main')).not.toHaveProperty('labsRoot')
  })

  it('stores the trimmed value when the field loses focus, then clears it to absent', async () => {
    const d = await setup()
    const input = (await screen.findByTestId('settings-labs-root')) as HTMLInputElement
    fireEvent.change(input, { target: { value: ' ~/my-labs ' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await d.settings.get('main'))?.labsRoot).toBe('~/my-labs'))
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    await waitFor(async () => expect(await d.settings.get('main')).not.toHaveProperty('labsRoot'))
  })

  it('shows a stored value, and an invalid one is stored as typed (the server judges it at set up)', async () => {
    const d = await setup('~/other')
    const input = (await screen.findByTestId('settings-labs-root')) as HTMLInputElement
    expect(input.value).toBe('~/other')
    fireEvent.change(input, { target: { value: '/tmp/x' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await d.settings.get('main'))?.labsRoot).toBe('/tmp/x'))
  })
})
