import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlanJson } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Overview } from '../../src/screens/Overview'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { stagePlan } from '../helpers/stagePlan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const S1 = ist('2026-09-08T10:00:00') // start 2026-09-07

async function setup(plan: PlanJson, at = S1) {
  setNow(() => at)
  const d = await seededDb(plan)
  renderWithApp(<Overview />, { db: d, plan, route: '/overview', path: '/overview' })
  await screen.findByTestId('timeline-checkpoint')
}

describe('Overview screen', () => {
  it('draws phase and design bands, the checkpoint and NOW', async () => {
    await setup({ ...smallPlan, phases: [{ n: 'Foundations', months: [1], note: 'n' }] })
    expect(screen.getByTestId('band-phase-0')).toHaveAttribute('data-from', '1')
    expect(screen.getByTestId('band-phase-0')).toHaveAttribute('data-to', '4')
    expect(screen.getByTestId('band-design-0')).toHaveAttribute('data-from', '2')
    expect(screen.queryByTestId('band-stage-0')).toBeNull()
    expect(screen.getByTestId('timeline-now')).toBeInTheDocument()
  })

  it('draws stage bands from plan data', async () => {
    await setup(stagePlan())
    expect(screen.getByTestId('band-stage-0')).toHaveAttribute('data-to', '2')
    expect(screen.getByTestId('band-stage-1')).toHaveAttribute('data-from', '3')
  })

  it('has no NOW marker before the start date', async () => {
    await setup(smallPlan, ist('2026-09-01T10:00:00'))
    expect(screen.queryByTestId('timeline-now')).toBeNull()
  })

  it('renders the ported prose sections', async () => {
    await setup(smallPlan)
    for (const name of [
      'What this plan covers, so nothing else needs to', 'Rules of the road',
      'What "understanding everything" means here', 'Deliberately out of scope',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })
})
