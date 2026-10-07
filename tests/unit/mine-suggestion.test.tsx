import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MineDraft } from '../../src/data/bankActions'
import { MineSuggestion } from '../../src/screens/banks/MineSuggestion'

const draft: MineDraft = {
  key: 'x', name: 'Two Sum', url: null, pattern: null, difficulty: 'E', source: 'Text', input: 'Two Sum', ticketId: 'x',
}

describe('MineSuggestion accessible field names', () => {
  it('gives Title, Pattern and Difficulty explicit aria-labels (BankControls convention), not the wrapping label text', () => {
    render(<MineSuggestion mode="add" initial={draft} note="Suggested" onCancel={() => {}} />)
    const title = screen.getByTestId('mine-title')
    const pattern = screen.getByTestId('mine-pattern')
    const difficulty = screen.getByTestId('mine-difficulty')
    expect(title.getAttribute('aria-label')).toBe('Title')
    expect(pattern.getAttribute('aria-label')).toBe('Pattern')
    expect(difficulty.getAttribute('aria-label')).toBe('Difficulty')
    // Same fields must still be reachable by role + exact accessible name.
    expect(screen.getByRole('textbox', { name: 'Title' })).toBe(title)
    expect(screen.getByRole('combobox', { name: 'Pattern' })).toBe(pattern)
    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toBe(difficulty)
  })
})
