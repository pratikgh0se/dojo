import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import type { DesignSession } from '../../src/data/types'
import type { PlanDesignRef } from '../../src/rules/designs'
import { PartnerCard } from '../../src/screens/designSession/partner/PartnerCard'

const ITEM = { id: 'd-method', title: 'Design a photo editor', difficulty: 'M', deepDives: ['dive a', 'dive b', 'dive c', 'dive d'], refs: [], tier: 1, tierName: '', tierLabel: '', tierShort: '', order: 0 } as PlanDesignRef
const SESSION = { ...(legacy as unknown as DesignSession), mode: 'human-partner', phase: 'drawing', partner: {}, notes: { reqFn: 'Edits by many people', reqNfr: '', assumptions: '', api: '', dataModel: '', tradeoffs: '', open: '', schema: [] } } as DesignSession
const tid = (id: string) => screen.getByTestId(id)
const card = (over: Partial<DesignSession> = {}, props: { readOnly?: boolean; accent?: boolean; onSave?: () => Promise<void> } = {}) =>
  render(<PartnerCard item={ITEM} session={{ ...SESSION, ...over }} readOnly={props.readOnly} accent={props.accent} onSave={props.onSave ?? (async () => {})} />)

describe('contents (DESIGN-58, 59, 62)', () => {
  it('shows the prompt, an opening line, six follow-ups (four dives then two generic) each with an asked box', () => {
    card()
    expect(tid('partner-prompt')).toHaveTextContent('Design a photo editor')
    expect(tid('partner-opener')).toHaveTextContent('Design a photo editor')
    for (let n = 1; n <= 6; n++) {
      expect(tid(`partner-question-${n}`)).toBeInTheDocument()
      expect(tid(`partner-asked-${n}`)).toHaveAttribute('type', 'checkbox')
    }
    expect(tid('partner-question-5')).toHaveAttribute('data-generic', 'true')
    expect(tid('partner-question-6')).toHaveAttribute('data-generic', 'true')
    expect(tid('partner-question-4')).not.toHaveAttribute('data-generic')
    expect(tid('partner-question-1')).toHaveTextContent('dive a')
    fireEvent.click(tid('partner-asked-1')); fireEvent.click(tid('partner-asked-3'))
    expect(screen.getByText('2 of 6 asked')).toBeInTheDocument()
  })
  it('the digest is read-only text with the design and the notes, and the card has no canvas', () => {
    card()
    const digest = tid('partner-digest')
    expect(digest.tagName).toBe('PRE')
    expect(digest).toHaveTextContent('Gateway 1 -sync-> Service 1')
    expect(digest).toHaveTextContent('Edits by many people')
    expect(digest.querySelector('input, textarea, [contenteditable]')).toBeNull()
    expect(screen.queryByTestId('kit-canvas')).toBeNull()
  })
  it('says no banned word', () => {
    card()
    expect(document.body.textContent).not.toMatch(/interview/i)
  })
})

describe('scoring sheet (DESIGN-63 to 65)', () => {
  it('five rubric rows of five options and four dive rows of three, with a total out of 20', () => {
    card()
    for (let n = 1; n <= 5; n++) {
      expect(within(tid(`partner-score-${n}`)).getAllByRole('radio')).toHaveLength(5)
      for (let v = 0; v <= 4; v++) expect(tid(`partner-score-${n}-${v}`)).toBeInTheDocument()
    }
    for (let n = 1; n <= 4; n++) {
      expect(within(tid(`partner-score-dive-${n}`)).getAllByRole('radio')).toHaveLength(3)
      for (let v = 0; v <= 2; v++) expect(tid(`partner-score-dive-${n}-${v}`)).toBeInTheDocument()
    }
    expect(tid('partner-total')).toHaveTextContent('0 of 20')
    fireEvent.click(tid('partner-score-1-3')); fireEvent.click(tid('partner-score-2-4'))
    expect(tid('partner-total')).toHaveTextContent('7 of 20')
  })
  it('SAVE · SCORES is the one accent; it hands over the name and the scores with null for unchosen rows, then says Saved', async () => {
    const onSave = vi.fn(async () => {})
    card({}, { onSave })
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(tid('partner-save')).toHaveTextContent(/^SAVE · SCORES$/)
    fireEvent.change(tid('partner-name'), { target: { value: 'Sam' } })
    for (const [n, v] of [[1, 3], [2, 2], [3, 4]]) fireEvent.click(tid(`partner-score-${n}-${v}`))
    fireEvent.click(tid('partner-score-dive-1-2'))
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(tid('partner-status')).toHaveTextContent('Saved'))
    expect(onSave).toHaveBeenCalledWith({ name: 'Sam', scores: { perItem: [3, 2, 4, null, null], deepDives: [2, null, null, null] } })
  })
  it('with accent={false} (the inline card) partner-save is a normal control and carries no accent', () => {
    card({}, { accent: false })
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
    expect(tid('partner-save')).not.toHaveClass('sr-btn-accent')
    expect(tid('partner-save')).toHaveTextContent(/^SAVE · SCORES$/)
  })
  it('a failed save says so and can be retried', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined)
    card({}, { onSave })
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(tid('partner-status')).toHaveTextContent('Could not save'))
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(tid('partner-status')).toHaveTextContent('Saved'))
  })
  it('an edit made while a save is in flight is not reported as Saved', async () => {
    let finish: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>(res => { finish = res }))
    card({}, { onSave })
    fireEvent.click(tid('partner-score-1-3'))
    fireEvent.click(tid('partner-save'))
    expect(tid('partner-status')).toHaveTextContent('Saving…')
    fireEvent.click(tid('partner-score-2-4'))
    expect(tid('partner-status')).toHaveTextContent('Unsaved changes')
    finish()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    await Promise.resolve(); await Promise.resolve()
    expect(tid('partner-status')).toHaveTextContent('Unsaved changes')
    expect(tid('partner-save')).not.toBeDisabled()
  })
  it('the dive rows show the session\'s stored dives, the same ones the scores are prefilled onto', () => {
    card({ deepDives: [
      { q: 'stored one', answered: null }, { q: 'stored two', answered: null }, { q: 'stored three', answered: null }, { q: 'stored four', answered: null },
    ] })
    expect(tid('partner-score-dive-1')).toHaveTextContent('stored one')
    expect(tid('partner-score-dive-4')).toHaveTextContent('stored four')
    expect(tid('partner-score-dive-1')).not.toHaveTextContent('dive a')
    expect(tid('partner-question-1')).toHaveTextContent('dive a')
  })
  it('falls back to the plan\'s dives when the session stored none', () => {
    card({ deepDives: [] })
    expect(tid('partner-score-dive-1')).toHaveTextContent('dive a')
  })
  it('starts from what is stored', () => {
    card({ partner: { name: 'Sam', scores: { perItem: [3, null, null, null, 2], deepDives: [null, 1, null, null] } } })
    expect(tid('partner-score-1-3')).toBeChecked()
    expect(tid('partner-score-dive-2-1')).toBeChecked()
    expect(tid('partner-name')).toHaveValue('Sam')
    expect(tid('partner-total')).toHaveTextContent('5 of 20')
  })
})

describe('when it cannot be scored (Review Focus 3)', () => {
  it('a finished session is read-only with a sentence', () => {
    card({ phase: 'done' })
    expect(tid('partner-save')).toBeDisabled()
    expect(tid('partner-score-1-2')).toBeDisabled()
    expect(screen.getByText('This session is finished.')).toBeInTheDocument()
  })
  it('a read-only browser shows the card but scores nothing', () => {
    card({}, { readOnly: true })
    expect(tid('partner-save')).toBeDisabled()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })
})
