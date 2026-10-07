import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { OCT14, REPO, renderAi } from '../helpers/projects'

const cardsIn = (col: string) => within(screen.getByTestId(`board-learn-col-${col}`)).queryAllByTestId('board-learn-card')

describe('R3 Learn board (C-PROJECTS §2.3)', () => {
  it('four named lists; a fresh profile has all 12 stages Queued in order', async () => {
    await renderAi()
    const region = screen.getByRole('region', { name: 'Learn board' })
    expect(region).toHaveAttribute('data-testid', 'board-learn')
    expect(within(region).getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['Queued', 'Watched', 'Built', 'Proven'])
    expect(cardsIn('queued').map(c => c.getAttribute('data-stage'))).toEqual(['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'])
    expect(cardsIn('queued')[0]).toHaveTextContent('Stage 00 · Setup + math by picture')
    expect(cardsIn('queued')[0].querySelectorAll('[data-state]')).toHaveLength(3)
    expect(within(cardsIn('queued')[0]).queryAllByRole('img')).toHaveLength(0)
  })

  it('moves a card as its cubes fill, and back', async () => {
    const d = await renderAi()
    await moveTicket(d, 'stage-00-setup-w1-watch', 'done', OCT14)
    await waitFor(() => expect(cardsIn('watched').map(c => c.getAttribute('data-stage'))).toEqual(['00']))
    await moveTicket(d, 'stage-00-setup-w1-build', 'done', OCT14)
    await d.artifacts.update('art-stage-00', { repo: REPO, commit: 'c0ffee1' })
    await waitFor(() => expect(cardsIn('built').map(c => c.getAttribute('data-stage'))).toEqual(['00']))
    await moveTicket(d, 'stage-00-setup-w1-teachback', 'done', OCT14)
    await d.artifacts.update('art-stage-00', { grade: 4 })
    await waitFor(() => expect(cardsIn('proven').map(c => c.getAttribute('data-stage'))).toEqual(['00']))
    await moveTicket(d, 'stage-00-setup-w1-watch', 'todo', OCT14)
    await waitFor(() => expect(cardsIn('queued')).toHaveLength(12))
  })
})
