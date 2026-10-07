import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const framePng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
const downloadBlob = vi.fn()
vi.mock('../../src/lib/snapshot', async orig => ({ ...(await orig<typeof import('../../src/lib/snapshot')>()), framePng, downloadBlob }))
const { AlgoPlayer } = await import('../../src/ui/algo/AlgoPlayer')

describe('Snapshot (labs contract §4.7, D-11)', () => {
  beforeAll(installAlgoEngines)

  it('downloads the current frame as dojo-<key>-step-<k>-of-<n>.png with the caption baked in', async () => {
    const d = await seededDb()
    renderWithApp(<AlgoPlayer walkKey="binarySearch" />, { db: d, plan: smallPlan })
    await screen.findByRole('region', { name: 'Player: Binary search' })
    fireEvent.click(screen.getByRole('button', { name: 'Last step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'dojo-binary-search-step-22-of-22.png'))
    expect(framePng).toHaveBeenCalledWith(expect.any(HTMLElement), { title: 'Binary search', caption: expect.stringContaining('12'), counter: 'STEP 22 / 22' })
  })
})
