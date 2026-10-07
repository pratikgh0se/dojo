import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { TwoUp } from '../../src/ui/algo/TwoUp'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

function Harness({ left, right }: { left: string; right: string }) {
  const [r, setR] = useState(right)
  return <TwoUp left={left} right={r} onRight={setR} onClose={() => {}} />
}
const two = () => within(screen.getByRole('region', { name: 'Two-up' }))
const counters = () => screen.getAllByTestId('lab-step-counter').map(c => c.textContent)
const shared = () => screen.getByTestId('lab-two-up-counter').textContent

async function mount(left: string, right: string) {
  const d = await seededDb()
  renderWithApp(<Harness left={left} right={right} />, { db: d, plan: smallPlan })
  await waitFor(() => expect(screen.getAllByTestId('lab-player')).toHaveLength(2))
  return d
}

describe('Two-up (labs contract §4.5, D-9)', () => {
  beforeAll(installAlgoEngines)

  it('one shared bar moves both; the shorter holds its last frame; same input, no note (S27)', async () => {
    await mount('dijkstra', 'bellmanFord')
    await waitFor(() => expect(shared()).toBe('STEP 0 / 54'))
    expect(counters()).toEqual(['STEP 0 / 51', 'STEP 0 / 54'])
    expect(screen.queryByTestId('lab-two-up-note')).toBeNull()
    for (let i = 0; i < 3; i++) fireEvent.click(two().getAllByRole('button', { name: 'Step forward' })[0])
    expect(counters()).toEqual(['STEP 3 / 51', 'STEP 3 / 54'])
    fireEvent.click(two().getByRole('button', { name: 'Last step' }))
    expect(shared()).toBe('STEP 54 / 54')
    expect(counters()).toEqual(['STEP 51 / 51', 'STEP 54 / 54'])
    expect(two().getByRole('button', { name: 'Predict' })).toBeDisabled()
    expect(two().getAllByRole('button', { name: 'Snapshot' })).toHaveLength(2)
  })

  it('the header own input applies to both players (S28)', async () => {
    await mount('dijkstra', 'bellmanFord')
    await waitFor(() => expect(shared()).toBe('STEP 0 / 54'))
    fireEvent.click(two().getByRole('button', { name: 'Own input' }))
    const form = screen.getByRole('form', { name: "Own input: Dijkstra's shortest paths" })
    fireEvent.change(within(form).getByLabelText('Edges'), { target: { value: 'A-B:1, A-C:4, B-C:2, C-D:1' } })
    fireEvent.change(within(form).getByLabelText('Start node'), { target: { value: 'A' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Trace' }))
    await waitFor(() => expect(counters()).toEqual(['STEP 0 / 31', 'STEP 0 / 31']))
    fireEvent.click(two().getByRole('button', { name: 'Last step' }))
    expect(screen.getAllByTestId('lab-caption')[0]).toHaveTextContent('Shortest-path tree in arcane.')
  })

  it('fixed pairs have Own input disabled; different shapes get the note (S29, S30)', async () => {
    await mount('memo', 'tab')
    expect(two().getByRole('button', { name: 'Own input' })).toBeDisabled()
    fireEvent.change(two().getByRole('combobox', { name: 'Compare with' }), { target: { value: 'heapPush' } })
    expect(screen.getByTestId('lab-two-up-note')).toHaveTextContent('Different inputs: these walkthroughs take different input shapes.')
    expect(within(two().getByRole('combobox', { name: 'Compare with' })).getAllByRole('option')).toHaveLength(45)
  })
})
