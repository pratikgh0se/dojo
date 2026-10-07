import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const load = vi.fn<() => Promise<void>>()
vi.mock('../../src/lib/engines', () => ({ loadAlgoEngines: () => load() }))
const { AlgoPlayer } = await import('../../src/ui/algo/AlgoPlayer')

describe('AlgoPlayer when the engine script fails (offline, 404)', () => {
  it('says so and retries on demand', async () => {
    load.mockRejectedValueOnce(new Error('engine algo failed to load')).mockReturnValue(new Promise(() => {}))
    const d = await seededDb()
    renderWithApp(<AlgoPlayer walkKey="bfs" />, { db: d, plan: smallPlan })
    expect(await screen.findByRole('alert')).toHaveTextContent('The algorithm engine did not load.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Loading the player…')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
