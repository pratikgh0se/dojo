import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AutosaveStatus, relativeSaved } from '../../src/screens/designSession/AutosaveStatus'

describe('relativeSaved', () => {
  it('reads just now, seconds, minutes', () => {
    expect(relativeSaved(1000, 2000)).toBe('just now')
    expect(relativeSaved(0, 10_000)).toBe('10 seconds ago')
    expect(relativeSaved(0, 130_000)).toBe('2 minutes ago')
  })
})

describe('AutosaveStatus (DESIGN-15)', () => {
  it('says Autosave on before any write, then Autosaved <relative time>', () => {
    const { rerender } = render(<AutosaveStatus savedAt={null} />)
    expect(screen.getByTestId('session-autosave')).toHaveTextContent('Autosave on')
    rerender(<AutosaveStatus savedAt={Date.now()} />)
    expect(screen.getByTestId('session-autosave')).toHaveTextContent(/^Autosaved just now$/)
  })
})
