import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DRAFT_OUTCOME_KEY, getDraftStore, patchDraftJob, registerInline, reloadDraftJob, setDraftJob } from '../../src/data/draftJob'
import { DraftIndicator } from '../../src/ui/DraftIndicator'

// UAT J7: the "Drafting 1 of 14" line vanished when you left the Board, with no completion message.
describe('Draft briefs: the global indicator', () => {
  const busy = { sprint: 1, busy: true, text: 'Drafting 3 of 14: Tokenizers', summary: null, failure: null, seen: false }

  it('shows the run while the Board is not showing it, and hides while it is', () => {
    render(<DraftIndicator />)
    expect(screen.queryByTestId('draft-indicator')).toBeNull()
    act(() => setDraftJob(busy))
    expect(screen.getByTestId('draft-indicator')).toHaveTextContent('Sprint 1 · Drafting 3 of 14: Tokenizers')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    let off = () => {}
    act(() => { off = registerInline(1) })
    expect(screen.queryByTestId('draft-indicator')).toBeNull()
    act(() => off())
    act(() => { off = registerInline(2) })
    expect(screen.getByTestId('draft-indicator')).toBeInTheDocument()
    act(() => off())
  })

  it('ends with a completion line until dismissed', () => {
    render(<DraftIndicator />)
    act(() => setDraftJob(busy))
    act(() => patchDraftJob({ busy: false, text: 'Done', summary: 'Drafted 14 briefs for Sprint 1' }))
    expect(screen.getByTestId('draft-indicator')).toHaveTextContent('Drafted 14 briefs for Sprint 1')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('draft-indicator')).toBeNull()
  })

  it('an ended run seen on the Board does not come back elsewhere', () => {
    render(<DraftIndicator />)
    act(() => setDraftJob({ ...busy, busy: false, text: 'Done', summary: 'Drafted 14 briefs for Sprint 1' }))
    let off = () => {}
    act(() => { off = registerInline(1) })
    act(() => off())
    expect(screen.queryByTestId('draft-indicator')).toBeNull()
  })

  it('UAT r3 P2: an ended run outlives a reload until a new run starts; a running one is never saved', () => {
    act(() => setDraftJob(busy))
    expect(localStorage.getItem(DRAFT_OUTCOME_KEY)).toBeNull()
    act(() => patchDraftJob({ busy: false, text: 'Failed', summary: 's' }))
    act(() => reloadDraftJob())
    expect(getDraftStore().job).toMatchObject({ sprint: 1, busy: false, text: 'Failed', summary: 's' })
    act(() => setDraftJob(busy)) // a new run replaces it
    act(() => reloadDraftJob())
    expect(getDraftStore().job).toBeNull()
    localStorage.setItem(DRAFT_OUTCOME_KEY, '{not json')
    act(() => reloadDraftJob())
    expect(getDraftStore().job).toBeNull()
  })
})
