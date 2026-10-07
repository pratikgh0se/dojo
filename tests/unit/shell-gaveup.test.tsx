import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Shell } from '../../src/app/Shell'
import { loadGaveUp, saveGaveUp, type GaveUp } from '../../src/lib/cycle'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const g: GaveUp = {
  // `at` is today so Do's same-day check keeps the record on its own route
  ticketId: 'p200', cycleId: 'cyc1', attemptStart: 1, sessionId: 's1', at: Date.now(), elapsedMs: 0, netAtStart: 0, redoId: 'r1', redoDue: 3,
  redoStage: null, redoSession: false, countsTowardRedo: true, failedRedo: false,
}

describe('Shell and the given-up state', () => {
  it('clears it once the location is not /do/<that ticket>', async () => {
    saveGaveUp(g)
    renderWithApp(<Shell />, { db: await seededDb(), plan: smallPlan, route: '/settings' })
    await waitFor(() => expect(loadGaveUp()).toBeNull())
  })

  it('keeps it on that ticket\'s Do route (a reload stays given up, H-24)', async () => {
    saveGaveUp(g)
    renderWithApp(<Shell />, { db: await seededDb(), plan: smallPlan, route: '/do/p200' })
    await new Promise(r => setTimeout(r, 50))
    expect(loadGaveUp()).toEqual(g)
  })
})
