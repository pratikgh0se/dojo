import { screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { AlgoPlayer } from '../../src/ui/algo/AlgoPlayer'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

describe('AlgoPlayer keyboard focus (Controller addendum 2, prototype "THE PLAYER")', () => {
  beforeAll(installAlgoEngines)

  it('removes the engine element\'s own tab stop: the wrapper section already owns arrow-key/Space control', async () => {
    const d = await seededDb()
    renderWithApp(<AlgoPlayer walkKey="bfs" />, { db: d, plan: smallPlan })
    const host = await screen.findByRole('group')
    // algo.js's own connectedCallback sets `this.tabIndex = 0`; the wrapper must undo that once it upgrades.
    await waitFor(() => expect(host).toHaveAttribute('tabindex', '-1'))
  })
})
