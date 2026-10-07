import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AlgoJson } from '../../src/rules/algoJson'
import { AlgoPlayer } from '../../src/ui/algo/AlgoPlayer'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const counter = () => screen.getByTestId('lab-step-counter').textContent
const runs = async (d: Awaited<ReturnType<typeof seededDb>>) => (await d.atlasRuns.toArray()).map(r => [r.key, r.kind, r.asked, r.correct].filter(x => x !== undefined))

async function mount(ui: JSX.Element) {
  const d = await seededDb()
  renderWithApp(ui, { db: d, plan: smallPlan })
  await screen.findByRole('region', { name: /^Player: / })
  return d
}
async function trace(fields: Record<string, string>) {
  if (!screen.queryByRole('form', { name: /^Own input: / })) fireEvent.click(btn('Own input'))
  const form = screen.getByRole('form', { name: /^Own input: / })
  for (const [label, value] of Object.entries(fields)) fireEvent.change(within(form).getByLabelText(label), { target: { value } })
  fireEvent.click(within(form).getByRole('button', { name: 'Trace' }))
}

describe('AlgoPlayer (labs contract §4)', () => {
  beforeAll(installAlgoEngines)

  it('exposes the player in the light DOM: region, title, complexity, counter, caption, active code line (§4.1)', async () => {
    await mount(<AlgoPlayer walkKey="binarySearch" />)
    const p = screen.getByRole('region', { name: 'Player: Binary search' })
    expect(p).toHaveAttribute('data-walkthrough', 'binarySearch')
    expect(p).toHaveAttribute('data-steps', '22')
    expect(screen.getByTestId('lab-complexity')).toHaveTextContent('O(log n) · O(1)')
    expect(counter()).toBe('STEP 0 / 22')
    expect(screen.getByTestId('lab-caption')).toHaveTextContent('Press PLAY or step with the arrow keys.')
    fireEvent.click(btn('Step forward'))
    expect(counter()).toBe('STEP 1 / 22')
    expect(p).toHaveAttribute('data-step', '1')
    expect(screen.getByTestId('lab-code').querySelector('[aria-current="step"]')).not.toBeNull()
    expect(screen.getByTestId('lab-code')).toHaveClass('sc') // triage A5: the code list scrolls with the house scrollbar
    expect(screen.getByRole('combobox', { name: 'Speed' })).toHaveValue('1')
    expect(within(screen.getByRole('combobox', { name: 'Speed' })).getAllByRole('option').map(o => o.textContent)).toEqual(['0.5×', '1×', '2×', '4×'])
  })

  it('traces his own input, steps, and counts Last step as not seen (S12, S16)', async () => {
    const d = await mount(<AlgoPlayer walkKey="binarySearch" />)
    await trace({ Values: '1,3,5,7,9', Target: '7' })
    await waitFor(() => expect(counter()).toBe('STEP 0 / 13'))
    fireEvent.click(btn('Step forward'))
    fireEvent.click(btn('Step forward'))
    expect(screen.getByTestId('lab-caption')).toHaveTextContent('Search for 7 between lo and hi.')
    fireEvent.click(btn('Last step'))
    expect(counter()).toBe('STEP 13 / 13')
    expect(screen.getByTestId('lab-caption')).toHaveTextContent('Found 7 at index 3.')
    expect(btn('Step forward')).toBeDisabled()
    expect(btn('Replay')).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 20))
    expect(await runs(d)).toEqual([])
    fireEvent.click(btn('First step'))
    expect(btn('Step back')).toBeDisabled()
    for (let i = 0; i < 13; i++) fireEvent.click(btn('Step forward'))
    await waitFor(async () => expect(await runs(d)).toEqual([['binarySearch', 'seen']]))
  })

  it('keys: → ← step, Space toggles play, the page does not scroll (S14)', async () => {
    await mount(<AlgoPlayer walkKey="binarySearch" />)
    const p = screen.getByRole('region', { name: 'Player: Binary search' })
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) expect(fireEvent.keyDown(p, { key })).toBe(false)
    expect(counter()).toBe('STEP 2 / 22')
    fireEvent.keyDown(p, { key: ' ' })
    expect(btn('Pause')).toBeInTheDocument()
    fireEvent.keyDown(p, { key: ' ' })
    expect(btn('Play')).toBeInTheDocument()
  })

  it('shows validation errors without re-running (S32)', async () => {
    await mount(<AlgoPlayer walkKey="binarySearch" />)
    await trace({ Values: '9,7,5' })
    expect(screen.getByRole('alert')).toHaveTextContent('Needs a sorted array (ascending).')
    expect(screen.getByTestId('lab-own-input-error')).toBeInTheDocument()
    expect(screen.getByLabelText('Values')).toHaveAttribute('aria-invalid', 'true')
    expect(counter()).toBe('STEP 0 / 22')
  })

  it('remembers own input until Reset to default (S33)', async () => {
    const d = await seededDb()
    const first = renderWithApp(<AlgoPlayer walkKey="binarySearch" />, { db: d, plan: smallPlan })
    await screen.findByRole('region', { name: 'Player: Binary search' })
    await trace({ Values: '1,3,5,7,9', Target: '7' })
    await waitFor(() => expect(counter()).toBe('STEP 0 / 13'))
    first.unmount()
    renderWithApp(<AlgoPlayer walkKey="binarySearch" openInput />, { db: d, plan: smallPlan })
    await waitFor(() => expect(counter()).toBe('STEP 0 / 13'))
    expect(screen.getByLabelText('Values')).toHaveValue('1,3,5,7,9')
    fireEvent.click(btn('Reset to default'))
    expect(screen.getByLabelText('Values')).toHaveValue('1, 3, 4, 7, 9, 12, 15, 18, 21')
    expect(screen.getByLabelText('Target')).toHaveValue('12')
    await waitFor(() => expect(counter()).toBe('STEP 0 / 22'))
  })

  it('fixed examples have Own input disabled with a description (S34)', async () => {
    await mount(<AlgoPlayer walkKey="dsu" />)
    expect(btn('Own input')).toBeDisabled()
    expect(btn('Own input')).toHaveAccessibleDescription('Fixed example: no own input.')
  })

  it('predict: asks at each question, locks the controls, scores and records a pass (S21)', async () => {
    const d = await mount(<AlgoPlayer walkKey="bubbleSort" />)
    await trace({ Values: '3,1,2' })
    await waitFor(() => expect(counter()).toBe('STEP 0 / 8'))
    fireEvent.click(btn('Predict'))
    expect(btn('Predict')).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.getByRole('region', { name: 'Predict' })
    fireEvent.click(btn('Step forward'))
    expect(within(panel).getByRole('heading', { name: 'What happens next?' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Compare a[0] = 3 with a[1] = 1')
    expect(btn('Step forward')).toBeDisabled()
    expect(btn('Last step')).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Left bigger' })).toHaveAttribute('data-answer', 'correct')
    expect(within(panel).getByRole('button', { name: 'Equal' })).not.toHaveAttribute('data-answer')
    fireEvent.click(within(panel).getByRole('button', { name: 'Left bigger' }))
    expect(within(panel).getByRole('button', { name: 'Left bigger' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('lab-predict-feedback')).toHaveTextContent('Right.')
    expect(counter()).toBe('STEP 1 / 8')
    expect(screen.getByTestId('lab-predict-score')).toHaveTextContent('1 / 1 of 6')
    for (const answer of ['Left bigger', 'Mark done', 'Right bigger', 'Mark done', 'Mark done']) {
      fireEvent.click(btn('Step forward'))
      fireEvent.click(within(panel).getByRole('button', { name: answer }))
    }
    expect(counter()).toBe('STEP 8 / 8')
    expect(screen.getByTestId('lab-predict-result')).toHaveTextContent('6 / 6 · 100% Predicted')
    await waitFor(async () => expect(await runs(d)).toEqual(expect.arrayContaining([['bubbleSort', 'seen'], ['bubbleSort', 'predict', 6, 6]])))
  })

  it('predict: a wrong answer names the right one (S19)', async () => {
    await mount(<AlgoPlayer walkKey="bubbleSort" startPredict />)
    fireEvent.click(btn('Step forward'))
    fireEvent.click(within(screen.getByRole('region', { name: 'Predict' })).getByRole('button', { name: 'Equal' }))
    expect(screen.getByTestId('lab-predict-feedback')).toHaveTextContent('Wrong — Left bigger.')
    expect(screen.getByTestId('lab-predict-score')).toHaveTextContent('0 / 1 of 21')
  })

  it('says so when a walkthrough has nothing to predict (S24)', async () => {
    await mount(<AlgoPlayer walkKey="majority" startPredict />)
    expect(screen.getByTestId('lab-predict')).toHaveTextContent('No predictions in this walkthrough')
  })

  it('plays explicit JSON (the generated-picture seam) and records nothing', async () => {
    const json: AlgoJson = { title: 'gen', structures: { a: { type: 'array', values: [1, 2] } }, steps: [{ op: 'mark', s: 'a', i: 0, state: 'done' }] }
    const d = await mount(<AlgoPlayer json={json} />)
    fireEvent.click(btn('Step forward'))
    expect(counter()).toBe('STEP 1 / 1')
    await new Promise(r => setTimeout(r, 20))
    expect(await d.atlasRuns.count()).toBe(0)
  })

  it('shows an error for an unknown walkthrough', async () => {
    const d = await seededDb()
    renderWithApp(<AlgoPlayer walkKey="nope" />, { db: d, plan: smallPlan })
    expect(await screen.findByRole('alert')).toHaveTextContent('No walkthrough "nope"')
  })
})
