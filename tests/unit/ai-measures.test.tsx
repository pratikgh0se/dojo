import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import type { ArtifactRecord } from '../../src/rules/artifacts'
import { addUserArtifact, ist, OCT14, projectDb, REPO, renderAi } from '../helpers/projects'

const cardOf = (title: string) =>
  screen.getAllByTestId('board-card').find(c => within(c).getByTestId('board-card-open').textContent === title) as HTMLElement

function add(form: HTMLElement, choice: string, value: string, unit = '', name = '') {
  fireEvent.change(within(form).getByLabelText('Measure'), { target: { value: choice } })
  if (name) fireEvent.change(within(form).getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(within(form).getByLabelText('Value'), { target: { value } })
  fireEvent.change(within(form).getByLabelText('Unit'), { target: { value: unit } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add measure' }))
}
const items = (dlg: HTMLElement) => within(within(dlg).getByTestId('measure-list')).queryAllByRole('listitem').map(li => li.textContent)

async function openA() {
  const d = await projectDb()
  const id = await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
  await renderAi({ db: d, route: `/ai?artifact=${id}` })
  const dlg = await screen.findByRole('dialog', { name: 'Artifact · micrograd engine' })
  return { d, id, dlg, form: within(dlg).getByTestId('measure-form') }
}

describe('Measures section (C-PROJECTS §2.5, scenarios 16, 17, 20)', () => {
  it('records loss, tokens/sec and eval score with the sprint; the chip shows the latest', async () => {
    const { dlg, form } = await openA()
    expect(within(form).getByLabelText('Measure')).toHaveValue('loss')
    expect([...(within(form).getByLabelText('Measure') as HTMLSelectElement).options].map(o => o.value))
      .toEqual(['loss', 'tokens/sec', 'eval score', 'p95 latency', 'recall@5', 'other'])
    add(form, 'loss', '1.98')
    await waitFor(() => expect(items(dlg)).toEqual(['loss 1.98 · S1']))
    add(form, 'tokens/sec', '412', 'tok/s')
    add(form, 'eval score', '0.82')
    await waitFor(() => expect(items(dlg)).toEqual(['loss 1.98 · S1', 'tokens/sec 412 tok/s · S1', 'eval score 0.82 · S1']))
    expect(within(cardOf('micrograd engine')).getByTestId('measure-chip')).toHaveTextContent('eval score 0.82')
    setNow(() => ist('2026-10-20T10:00:00'))
    add(form, 'loss', '1.41')
    await waitFor(() => expect(items(dlg)[3]).toBe('loss 1.41 · S2'))
    expect(within(cardOf('micrograd engine')).getByTestId('measure-chip')).toHaveTextContent('loss 1.41')
  })

  it('needs a number, and a name for other', async () => {
    const { d, id, dlg, form } = await openA()
    fireEvent.click(within(form).getByRole('button', { name: 'Add measure' }))
    expect(within(form).getByText('Enter a number.')).toBeInTheDocument()
    expect(within(form).queryByLabelText('Name')).toBeNull()
    fireEvent.change(within(form).getByLabelText('Measure'), { target: { value: 'other' } })
    fireEvent.change(within(form).getByLabelText('Value'), { target: { value: '12' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add measure' }))
    expect(within(form).getByText('Name the measure.')).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'perplexity' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add measure' }))
    await waitFor(() => expect(items(dlg)).toEqual(['perplexity 12 · S1']))
    add(form, 'loss', '0')
    await waitFor(() => expect(items(dlg)[1]).toBe('loss 0 · S1'))
    expect(((await d.artifacts.get(id)) as ArtifactRecord).measures).toHaveLength(2)
  })

  it('Remove drops one measure and never moves the card (scenario 20)', async () => {
    const d = await projectDb()
    await d.artifacts.update('art-stage-00', {
      repo: REPO, commit: 'c0ffee1', status: 'measured', measures: [{ name: 'tokens/sec', value: 38, unit: '', at: OCT14, sprint: 1 }],
    })
    await renderAi({ db: d, route: '/ai?artifact=art-stage-00' })
    const dlg = await screen.findByRole('dialog', { name: 'Artifact · Stage 00 · Setup + math by picture' })
    const remove = within(within(dlg).getByTestId('measure-list')).getByRole('button', { name: 'Remove tokens/sec 38' })
    expect(remove.textContent).toBe('')
    fireEvent.click(remove)
    await waitFor(() => expect(items(dlg)).toEqual([]))
    expect(((await d.artifacts.get('art-stage-00')) as ArtifactRecord).status).toBe('measured')
    expect(cardOf('Stage 00 · Setup + math by picture')).toHaveAttribute('data-status', 'measured')
  })

  it('a new, unsaved artifact has no measures section', async () => {
    await renderAi()
    fireEvent.click(screen.getByRole('button', { name: 'Add artifact' }))
    expect(within(screen.getByRole('dialog', { name: 'New artifact' })).queryByTestId('measure-form')).toBeNull()
  })
})
