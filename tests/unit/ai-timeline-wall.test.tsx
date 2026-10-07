import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addMeasure, moveArtifact } from '../../src/data/projectActions'
import { setNow } from '../../src/lib/clock'
import { addUserArtifact, ist, OCT14, projectDb, REPO, renderAi } from '../helpers/projects'

const dl = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/downloadText', () => ({ downloadText: dl }))

const OCT20 = ist('2026-10-20T10:00:00')
const dataRows = (table: HTMLElement) =>
  within(table).getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell').map(c => c.textContent))

async function measuredA() {
  const d = await projectDb(OCT14)
  const id = await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
  await addMeasure(d, id, { choice: 'loss', name: '', value: '1.98', unit: '' }, OCT14, '2026-10-05')
  await addMeasure(d, id, { choice: 'tokens/sec', name: '', value: '412', unit: 'tok/s' }, OCT14, '2026-10-05')
  await addMeasure(d, id, { choice: 'eval score', name: '', value: '0.82', unit: '' }, OCT14, '2026-10-05')
  await moveArtifact(d, id, 'measured', OCT14)
  await addMeasure(d, id, { choice: 'loss', name: '', value: '1.41', unit: '' }, OCT20, '2026-10-05')
  return d
}

describe('regions in order (C-PROJECTS §2, scenario 1)', () => {
  it('R1–R6 in order, all above the Stage ladder', async () => {
    await renderAi()
    const named = screen.getAllByRole('region').filter(r => r.hasAttribute('aria-labelledby'))
    expect(named.map(r => r.getAttribute('data-testid'))).toEqual(['ai-evidence', 'ai-cube-ladder', 'board-learn', 'board-build', 'ai-timeline', 'measure-wall'])
    const ladder = screen.getByRole('heading', { name: 'Stage ladder' })
    expect(named[5].compareDocumentPosition(ladder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('R5 Artifact timeline (C-PROJECTS §2.9)', () => {
  it('fresh S1: one row, 12 not started, with the accent Measured series', async () => {
    await renderAi()
    const table = screen.getByRole('table', { name: 'Artifact timeline data' })
    expect(table).toHaveAttribute('data-testid', 'ai-timeline-table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Sprint', 'Not started', 'Building', 'Runs', 'Measured', 'Written up'])
    expect(dataRows(table)).toEqual([['S1', '12', '0', '0', '0', '0']])
  })

  it('S1 and S2 both show the artifact Measured (scenario 18)', async () => {
    await renderAi({ db: await measuredA(), at: OCT20 })
    expect(dataRows(screen.getByTestId('ai-timeline-table'))).toEqual([
      ['S1', '12', '0', '0', '1', '0'],
      ['S2', '12', '0', '0', '1', '0'],
    ])
    expect(screen.getByTestId('ai-timeline').querySelector('rect[data-series="measured"]')).toHaveClass('ct-accent')
  })

  it('recomputes immediately when an artifact is added, with no reload (bug: stale until reload)', async () => {
    await renderAi()
    expect(dataRows(screen.getByTestId('ai-timeline-table'))).toEqual([['S1', '12', '0', '0', '0', '0']])
    // The app clock's polled "now" (useNow) only ticks on its own interval; advance the
    // underlying clock without waiting for that tick, the way real time passes between polls.
    setNow(() => OCT14 + 5_000)
    fireEvent.click(screen.getByRole('button', { name: 'Add artifact' }))
    const dlg = screen.getByRole('dialog', { name: 'New artifact' })
    fireEvent.change(within(dlg).getByLabelText('Title'), { target: { value: 'micrograd engine' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(dataRows(screen.getByTestId('ai-timeline-table'))).toEqual([['S1', '13', '0', '0', '0', '0']]))
  })

  it('recomputes immediately when a status changes, with no reload (bug: stale until reload)', async () => {
    const d = await projectDb()
    const id = await addUserArtifact(d, { title: 'micrograd engine', stage: 1, repo: REPO, commit: 'a1b2c3d' })
    await renderAi({ db: d })
    expect(dataRows(screen.getByTestId('ai-timeline-table'))).toEqual([['S1', '13', '0', '0', '0', '0']])
    setNow(() => OCT14 + 5_000)
    await moveArtifact(d, id, 'building', OCT14 + 5_000)
    await waitFor(() => expect(dataRows(screen.getByTestId('ai-timeline-table'))).toEqual([['S1', '12', '1', '0', '0', '0']]))
  })

  it('before the start date: "Starts 5 Oct 2026" and no table', async () => {
    const at = ist('2026-10-01T10:00:00')
    await renderAi({ at, db: await projectDb(at) })
    expect(screen.getByTestId('ai-timeline')).toHaveTextContent('Starts 5 Oct 2026')
    expect(screen.queryByTestId('ai-timeline-table')).toBeNull()
  })
})

describe('R6 Measures wall (C-PROJECTS §2.10)', () => {
  it('empty: dashes and the empty-state line', async () => {
    await renderAi()
    expect(screen.getByText('First loss')).toBeInTheDocument()
    expect(screen.getByTestId('measure-first-loss')).toHaveTextContent('—')
    expect(screen.getByTestId('measure-wall')).toHaveTextContent('No measures yet — add one on an artifact.')
    expect(screen.queryByTestId('measure-table')).toBeNull()
  })

  it('firsts are first, the table is chronological, export is the exact Markdown (scenarios 17, 19)', async () => {
    await renderAi({ db: await measuredA(), at: OCT20 })
    expect(screen.getByTestId('measure-first-loss')).toHaveTextContent('1.98 · S1 · micrograd engine')
    expect(screen.getByTestId('measure-first-tps')).toHaveTextContent('412 tok/s · S1 · micrograd engine')
    expect(screen.getByTestId('measure-first-eval')).toHaveTextContent('0.82 · S1 · micrograd engine')
    const table = screen.getByRole('table', { name: 'Measures' })
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Sprint', 'Stage', 'Artifact', 'Measure', 'Value', 'Unit'])
    expect(dataRows(table)).toEqual([
      ['S1', '01', 'micrograd engine', 'loss', '1.98', ''],
      ['S1', '01', 'micrograd engine', 'tokens/sec', '412', 'tok/s'],
      ['S1', '01', 'micrograd engine', 'eval score', '0.82', ''],
      ['S2', '01', 'micrograd engine', 'loss', '1.41', ''],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }))
    expect(dl).toHaveBeenCalledWith('dojo-measures.md', [
      '# Measures',
      '',
      '| Sprint | Stage | Artifact | Measure | Value | Unit |',
      '|---|---|---|---|---|---|',
      '| S1 | 01 | micrograd engine | loss | 1.98 |  |',
      '| S1 | 01 | micrograd engine | tokens/sec | 412 | tok/s |',
      '| S1 | 01 | micrograd engine | eval score | 0.82 |  |',
      '| S2 | 01 | micrograd engine | loss | 1.41 |  |',
    ].join('\n') + '\n')
  })
})
