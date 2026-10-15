import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Shell } from '../../src/app/Shell'
import { patchSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('the shell does not move tickets between sprints', () => {
  it('opening the app in a later sprint leaves every ticket where it was', async () => {
    setNow(() => new Date('2026-12-01T10:00:00+05:30').getTime()) // sprint 5 of a plan that started 2026-09-07
    const d = await seededDb(flatPlanV2, '2026-09-07')
    await patchSettings(d, { trackedFrom: 1 }) // with tracking recorded the old roll-over would move sprint 1's open cards
    const before = await d.tickets.orderBy('id').toArray()
    renderWithApp(<Shell />, { db: d, plan: flatPlanV2, route: '/settings' })
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(await d.events.filter(e => (e.t as string) === 'rolled').count()).toBe(0)
  })
})
