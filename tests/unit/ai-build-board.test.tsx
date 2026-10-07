import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addMeasure, moveArtifact } from '../../src/data/projectActions'
import { addUserArtifact, OCT14, REPO, renderAi } from '../helpers/projects'

const col = (slug: string) => screen.getByTestId(`board-col-${slug}`)
const titlesIn = (slug: string) => within(col(slug)).queryAllByTestId('board-card-open').map(b => b.textContent)
const cardOf = (title: string) =>
  screen.getAllByTestId('board-card').find(c => within(c).getByTestId('board-card-open').textContent === title) as HTMLElement
const openOf = (title: string) => within(cardOf(title)).getByTestId('board-card-open')

function drag(card: HTMLElement, to: HTMLElement) {
  const id = card.getAttribute('data-artifact-id') as string
  const dataTransfer = { setData: vi.fn(), getData: () => id }
  fireEvent.dragStart(card, { dataTransfer })
  fireEvent.dragOver(to, { dataTransfer })
  fireEvent.drop(to, { dataTransfer })
}

describe('R4 Build board (C-PROJECTS §2.4)', () => {
  it('seed: 12 cards Not started in stage order, the other columns empty with counts', async () => {
    await renderAi()
    const region = screen.getByRole('region', { name: 'Build board' })
    expect(region).toHaveAttribute('data-testid', 'board-build')
    expect(within(region).getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['Not started', 'Building', 'Runs', 'Measured', 'Written up'])
    expect(titlesIn('not-started')).toHaveLength(12)
    expect(titlesIn('not-started')[0]).toBe('Stage 00 · Setup + math by picture')
    expect(titlesIn('not-started')[11]).toBe('Stage 11 · Research')
    expect(screen.getByRole('heading', { name: 'Not started · 12' })).toBeInTheDocument()
    for (const n of ['Building', 'Runs', 'Measured', 'Written up']) expect(screen.getByRole('heading', { name: `${n} · 0` })).toBeInTheDocument()
    const first = cardOf('Stage 00 · Setup + math by picture')
    expect(first).toHaveAttribute('data-artifact-id', 'art-stage-00')
    expect(first).toHaveAttribute('data-status', 'not-started')
    expect(first).toHaveAttribute('data-stage', '00')
    expect(first).toHaveTextContent('ST 00')
    expect(screen.getByTestId('artifact-add')).toHaveAccessibleName('Add artifact')
  })

  it('a user card sorts by stage then creation, with a repo icon and no measure chip (scenario 4)', async () => {
    const d = await renderAi()
    await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' }, OCT14 + 1000)
    await waitFor(() => expect(titlesIn('not-started').slice(1, 4)).toEqual(['Stage 01 · micrograd', 'micrograd engine', 'Stage 02 · makemore']))
    const a = cardOf('micrograd engine')
    expect(a).toHaveAttribute('data-stage', '01')
    expect(within(a).getByRole('img', { name: 'repo' })).toBeInTheDocument()
    expect(within(a).queryByTestId('measure-chip')).toBeNull()
    expect(screen.getByTestId('ai-evidence-measured')).toHaveTextContent('0/13')
  })

  it('drag forward with no gate moves and announces (scenario 8)', async () => {
    const d = await renderAi()
    await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
    await waitFor(() => expect(cardOf('micrograd engine')).toBeTruthy())
    drag(cardOf('micrograd engine'), col('building'))
    await waitFor(() => expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'building'))
    expect(screen.getByRole('heading', { name: 'Not started · 12' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Building · 1' })).toBeInTheDocument()
    expect(screen.getByTestId('board-live')).toHaveTextContent('micrograd engine moved to Building.')
  })

  it('a failed gate leaves the card and shows the first failing gate (scenario 9)', async () => {
    await renderAi()
    drag(cardOf('Stage 00 · Setup + math by picture'), col('runs'))
    const alert = await screen.findByTestId('board-gate-alert')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Runs needs a repo URL and a commit.')
    expect(cardOf('Stage 00 · Setup + math by picture')).toHaveAttribute('data-status', 'not-started')
  })

  it('Shift+Arrow moves one column, keeps focus, gates and backward moves (scenarios 10, 11, 13)', async () => {
    const d = await renderAi()
    const id = await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
    await moveArtifact(d, id, 'building', OCT14)
    await waitFor(() => expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'building'))
    openOf('micrograd engine').focus()
    fireEvent.keyDown(openOf('micrograd engine'), { key: 'ArrowRight', shiftKey: true })
    await waitFor(() => expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'runs'))
    await waitFor(() => expect(document.activeElement).toBe(openOf('micrograd engine')))
    expect(screen.getByTestId('board-live')).toHaveTextContent('micrograd engine moved to Runs.')
    fireEvent.keyDown(openOf('micrograd engine'), { key: 'ArrowRight', shiftKey: true })
    expect(await screen.findByTestId('board-gate-alert')).toHaveTextContent('Measured needs at least one measure.')
    expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'runs')
    expect(document.activeElement).toBe(openOf('micrograd engine'))
    fireEvent.keyDown(openOf('micrograd engine'), { key: 'ArrowLeft', shiftKey: true })
    await waitFor(() => expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'building'))
    await waitFor(() => expect(document.activeElement).toBe(openOf('micrograd engine')))
    fireEvent.keyDown(openOf('micrograd engine'), { key: 'ArrowLeft', shiftKey: true })
    await waitFor(() => expect(cardOf('micrograd engine')).toHaveAttribute('data-status', 'not-started'))
    expect(screen.queryByTestId('board-gate-alert')).toBeNull()
    expect(await d.artifacts.get(id)).toMatchObject({ repo: REPO, commit: 'a1b2c3d' })
  })

  it('skips columns when every gate passes (scenario 12)', async () => {
    const d = await renderAi()
    const id = await addUserArtifact(d, { title: 'value class', stage: 1, repo: REPO, commit: 'b4c5d6e7' })
    await addMeasure(d, id, { choice: 'loss', name: '', value: '2.5', unit: '' }, OCT14, '2026-10-05')
    await waitFor(() => expect(cardOf('value class')).toBeTruthy())
    drag(cardOf('value class'), col('measured'))
    await waitFor(() => expect(cardOf('value class')).toHaveAttribute('data-status', 'measured'))
  })

  it('shows the latest measure chip, the grade chip and DONE', async () => {
    const d = await renderAi()
    await d.artifacts.update('art-stage-00', {
      repo: REPO, commit: 'c0ffee1', commitFound: true, grade: 4,
      measures: [{ name: 'loss', value: 1.98, unit: '', at: OCT14, sprint: 1 }, { name: 'p95 latency', value: 240, unit: 'ms', at: OCT14, sprint: 1 }],
    })
    const card = cardOf('Stage 00 · Setup + math by picture')
    await waitFor(() => expect(within(card).getByTestId('measure-chip')).toHaveTextContent('p95 latency 240 ms'))
    expect(within(card).getByTestId('grade-chip')).toHaveTextContent('4/5')
    expect(within(card).getByTestId('artifact-done-badge')).toHaveTextContent('DONE')
  })

  it('the open button puts ?artifact=<id> in the URL; the measured tile focuses the Build board', async () => {
    await renderAi()
    fireEvent.click(openOf('Stage 02 · makemore'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?artifact=art-stage-02')
    fireEvent.click(screen.getByTestId('ai-evidence-measured'))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Build board' }))
  })
})
