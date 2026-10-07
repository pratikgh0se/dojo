import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { OCT14, REPO, renderAi } from '../helpers/projects'

const nn = (i: number) => String(i).padStart(2, '0')

describe('R1 Evidence and R2 Learn → build → prove (C-PROJECTS §2.1, §2.2)', () => {
  it('fresh profile: evidence 0/12 · 0/12 · 0, 12 rows with the checkpoint between 07 and 08, 36 empty cubes', async () => {
    await renderAi()
    expect(screen.getByText('Stages at 3 cubes')).toBeInTheDocument()
    expect(screen.getByTestId('ai-evidence-stages')).toHaveTextContent('0/12')
    expect(screen.getByText('Artifacts measured')).toBeInTheDocument()
    expect(screen.getByTestId('ai-evidence-measured')).toHaveTextContent('0/12')
    expect(screen.getByText('Blank tests passed')).toBeInTheDocument()
    expect(screen.getByTestId('ai-evidence-blank')).toHaveTextContent('0')
    const table = screen.getByRole('table', { name: 'Stage cubes' })
    expect(within(table).getAllByRole('row').map(r => r.getAttribute('data-testid'))).toEqual([
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => `ai-cube-row-${nn(i)}`), 'ai-cube-checkpoint',
      ...[8, 9, 10, 11].map(i => `ai-cube-row-${nn(i)}`),
    ])
    expect(screen.getByTestId('ai-cube-checkpoint')).toHaveTextContent('Checkpoint · S38')
    expect(table.querySelectorAll('[role="img"][data-state="empty"]')).toHaveLength(36)
    expect(screen.getByTestId('ai-cube-row-00')).toHaveTextContent('Stage 00 · Setup + math by picture')
    expect(screen.getByRole('img', { name: 'Stage 00 learn: empty (0/1)' })).toHaveAttribute('data-testid', 'ai-cube-00-learn')
    expect(screen.getByTestId('ai-cube-row-00')).toHaveAttribute('data-complete', 'false')
  })

  it('sits above the existing Stage ladder, Evidence first', async () => {
    await renderAi()
    const evidence = screen.getByRole('region', { name: 'Evidence' })
    const cubes = screen.getByRole('region', { name: 'Learn → build → prove' })
    const ladder = screen.getByRole('heading', { name: 'Stage ladder' })
    expect(evidence.compareDocumentPosition(cubes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cubes.compareDocumentPosition(ladder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('learn from watch, rebuild fills nothing, build needs a commit, prove needs a grade (scenarios 22–25)', async () => {
    const d = await renderAi({ route: '/ai?stage=0' })
    fireEvent.click(screen.getByRole('button', { name: 'Watch · S1' }))
    await waitFor(() => expect(screen.getByTestId('ai-cube-00-learn')).toHaveAttribute('data-state', 'full'))
    expect(screen.getByTestId('ai-cube-00-learn')).toHaveAccessibleName('Stage 00 learn: full (1/1)')
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild · S1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rebuild · S1' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByTestId('ai-cube-00-build')).toHaveAttribute('data-state', 'empty')
    expect(screen.getByTestId('ai-cube-00-prove')).toHaveAttribute('data-state', 'empty')
    fireEvent.click(screen.getByRole('button', { name: 'Build · S1' }))
    await waitFor(() => expect(screen.getByTestId('ai-cube-00-build')).toHaveAccessibleName('Stage 00 build: partial (1/1) — needs a commit'))
    await d.artifacts.update('art-stage-00', { repo: REPO, commit: 'c0ffee1' })
    await waitFor(() => expect(screen.getByTestId('ai-cube-00-build')).toHaveAttribute('data-state', 'full'))
    fireEvent.click(screen.getByRole('button', { name: 'Teachback · S1' }))
    await waitFor(() => expect(screen.getByTestId('ai-cube-00-prove')).toHaveAccessibleName('Stage 00 prove: partial (1/1) — needs a grade or blank test'))
    await d.artifacts.update('art-stage-00', { grade: 4, commitFound: true })
    await waitFor(() => expect(screen.getByTestId('ai-cube-row-00')).toHaveAttribute('data-complete', 'true'))
    expect(screen.getByTestId('ai-evidence-stages')).toHaveTextContent('1/12')
    fireEvent.click(screen.getByRole('button', { name: 'Watch · S1' }))
    await waitFor(() => expect(screen.getByTestId('ai-cube-00-learn')).toHaveAttribute('data-state', 'empty'))
    expect(screen.getByTestId('ai-evidence-stages')).toHaveTextContent('0/12')
  })

  it('a multi-sprint stage fills partially: Watch · S2 gives Stage 01 learn (1/3)', async () => {
    await renderAi({ route: '/ai?stage=1' })
    fireEvent.click(screen.getByRole('button', { name: 'Watch · S2' }))
    await waitFor(() => expect(screen.getByTestId('ai-cube-01-learn')).toHaveAccessibleName('Stage 01 learn: partial (1/3)'))
  })

  it('the row header button opens the stage detail', async () => {
    await renderAi()
    fireEvent.click(within(screen.getByTestId('ai-cube-row-03')).getByRole('button', { name: 'Stage 03 · GPT' }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?stage=3')
    fireEvent.click(screen.getByTestId('ai-cube-row-05'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?stage=5')
  })

  it('the stages tile focuses the cube ladder region', async () => {
    await renderAi()
    fireEvent.click(screen.getByTestId('ai-evidence-stages'))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Learn → build → prove' }))
  })
})

describe('Blank-editor test (C-PROJECTS §2.8)', () => {
  it('Start needs text; the countdown starts at 25:00 on the app clock; Solved counts and is proof', async () => {
    const d = await renderAi()
    fireEvent.click(screen.getByRole('button', { name: 'Blank test · Stage 00' }))
    const dlg = screen.getByRole('dialog', { name: 'Blank test · Stage 00' })
    expect(dlg).toHaveAttribute('data-testid', 'ai-blank-dialog')
    expect(within(dlg).getByText('No video, no agent, blank file.')).toBeInTheDocument()
    expect(within(dlg).getByTestId('ai-blank-start')).toBeDisabled()
    expect(within(dlg).getByTestId('ai-blank-solved')).toBeDisabled()
    fireEvent.change(within(dlg).getByLabelText('What will you rebuild?'), { target: { value: 'forward pass by hand' } })
    fireEvent.click(within(dlg).getByTestId('ai-blank-start'))
    expect(within(dlg).getByTestId('ai-blank-timer')).toHaveTextContent('25:00')
    expect(document.activeElement).toBe(within(dlg).getByTestId('ai-blank-solved'))
    setNow(() => OCT14 + 60_000)
    await waitFor(() => expect(within(dlg).getByTestId('ai-blank-timer')).toHaveTextContent('24:00'), { timeout: 2500 })
    fireEvent.click(within(dlg).getByTestId('ai-blank-solved'))
    await waitFor(() => expect(screen.getByTestId('ai-evidence-blank')).toHaveTextContent('1'))
    expect(await d.blankTests.toArray()).toMatchObject([{ stage: 0, piece: 'forward pass by hand', at: OCT14, minutes: 1, outcome: 'solved' }])
    expect(screen.getByTestId('ai-cube-00-prove')).toHaveAttribute('data-state', 'partial')
    expect(within(dlg).getByTestId('ai-blank-solved')).toHaveAttribute('aria-disabled', 'true')
  })

  it('cu-final row 26: the countdown stops at the verdict and does not run on', async () => {
    await renderAi()
    fireEvent.click(screen.getByRole('button', { name: 'Blank test · Stage 00' }))
    const dlg = screen.getByRole('dialog', { name: 'Blank test · Stage 00' })
    fireEvent.change(within(dlg).getByLabelText('What will you rebuild?'), { target: { value: 'forward pass by hand' } })
    fireEvent.click(within(dlg).getByTestId('ai-blank-start'))
    setNow(() => OCT14 + 60_000)
    await waitFor(() => expect(within(dlg).getByTestId('ai-blank-timer')).toHaveTextContent('24:00'), { timeout: 2500 })
    fireEvent.click(within(dlg).getByTestId('ai-blank-solved'))
    await waitFor(() => expect(within(dlg).getByTestId('ai-blank-outcome')).toBeInTheDocument())
    setNow(() => OCT14 + 10 * 60_000)
    await new Promise(r => setTimeout(r, 1300))
    expect(within(dlg).getByTestId('ai-blank-timer')).toHaveTextContent('24:00')
  })

  it("shows Time's up at 00:00", async () => {
    await renderAi()
    fireEvent.click(screen.getByRole('button', { name: 'Blank test · Stage 02' }))
    const dlg = screen.getByRole('dialog', { name: 'Blank test · Stage 02' })
    fireEvent.change(within(dlg).getByLabelText('What will you rebuild?'), { target: { value: 'bigram model' } })
    fireEvent.click(within(dlg).getByTestId('ai-blank-start'))
    setNow(() => OCT14 + 25 * 60_000)
    await waitFor(() => expect(within(dlg).getByTestId('ai-blank-timer')).toHaveTextContent("Time's up"), { timeout: 2500 })
  })

  it('Not yet shows Redo due +10 days in the dialog and the row; Esc returns focus (scenario 27)', async () => {
    await renderAi()
    const opener = screen.getByRole('button', { name: 'Blank test · Stage 01' })
    opener.focus()
    fireEvent.click(opener)
    const dlg = screen.getByRole('dialog', { name: 'Blank test · Stage 01' })
    fireEvent.change(within(dlg).getByLabelText('What will you rebuild?'), { target: { value: 'micrograd backward pass' } })
    fireEvent.click(within(dlg).getByTestId('ai-blank-start'))
    fireEvent.click(within(dlg).getByTestId('ai-blank-notyet'))
    await waitFor(() => expect(within(dlg).getByTestId('ai-blank-redo-due')).toHaveTextContent('Redo due 24 Oct 2026'))
    await waitFor(() => expect(within(screen.getByTestId('ai-cube-row-01')).getByTestId('ai-blank-redo-due')).toHaveTextContent('Redo due 24 Oct 2026'))
    expect(screen.getByTestId('ai-evidence-blank')).toHaveTextContent('0')
    expect(screen.getByTestId('ai-cube-01-prove')).toHaveAttribute('data-state', 'empty')
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Blank test · Stage 01' }))
  })

  it('closing before an outcome records nothing', async () => {
    const d = await renderAi()
    fireEvent.click(screen.getByRole('button', { name: 'Blank test · Stage 03' }))
    const dlg = screen.getByRole('dialog', { name: 'Blank test · Stage 03' })
    fireEvent.change(within(dlg).getByLabelText('What will you rebuild?'), { target: { value: 'attention head' } })
    fireEvent.click(within(dlg).getByTestId('ai-blank-start'))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await d.blankTests.count()).toBe(0)
  })
})
