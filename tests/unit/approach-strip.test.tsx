import { fireEvent, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { ApproachStrip } from '../../src/ui/algo/ApproachStrip'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// UAT cu-4 P3-1: a chip with no library picture said so, but the player opened before it stayed on screen under that
// note and its chip stayed pressed.
describe('ApproachStrip', () => {
  beforeAll(installAlgoEngines)

  it('a chip with no library picture closes the player that was open and releases its chip', async () => {
    const d = await seededDb()
    renderWithApp(<ApproachStrip problemId="p322" />, { db: d, plan: smallPlan })
    const tab = screen.getByRole('button', { name: /^Tabulation/ })
    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-pressed', 'true')
    await screen.findByRole('region', { name: /^Player: / })

    fireEvent.click(screen.getByRole('button', { name: /^Brute recursion/ }))
    expect(screen.getByText('No library picture for this approach yet.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Player: / })).toBeNull()
    expect(tab).toHaveAttribute('aria-pressed', 'false')

    // the note goes with the player: it does not outlive Close player
    fireEvent.click(tab)
    fireEvent.click(screen.getByRole('button', { name: /^Brute recursion/ }))
    expect(screen.getByText('No library picture for this approach yet.')).toBeInTheDocument()
    fireEvent.click(tab)
    expect(screen.queryByText('No library picture for this approach yet.')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Close player' }))
    expect(screen.queryByText('No library picture for this approach yet.')).toBeNull()
    fireEvent.click(tab)

    // and a chip with a picture opens it again, taking the note away
    fireEvent.click(tab)
    expect(screen.queryByText('No library picture for this approach yet.')).toBeNull()
    expect(tab).toHaveAttribute('aria-pressed', 'true')
  })
})
