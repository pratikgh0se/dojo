import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NOT_WRITER_MESSAGE, setRejectedCount, setSaveState } from '../../src/data/sync/status'
import { SaveStatus } from '../../src/ui/SaveStatus'

afterEach(() => { setSaveState('off'); setRejectedCount(0) })
const show = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SaveStatus /></MemoryRouter>)

describe('SaveStatus', () => {
  it('renders nothing while disk sync is off', () => {
    show()
    expect(screen.queryByTestId('save-status')).toBeNull()
  })

  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['offline', 'Not saved to disk'],
  ] as const)('%s reads "%s"', (state, text) => {
    show()
    act(() => setSaveState(state))
    expect(screen.getByTestId('save-status')).toHaveTextContent(new RegExp(`^${text}$`))
  })

  it('C2: offline shows why (e.g. a failed import) in its tooltip, keeping the label', () => {
    show()
    act(() => setSaveState('offline', 'Not saved to disk: saving to disk failed (HTTP 413)'))
    expect(screen.getByTestId('save-status')).toHaveTextContent(/^Not saved to disk$/)
    expect(screen.getByTestId('save-status').getAttribute('title')).toContain('HTTP 413')
  })

  it('offline links to the help on how to start Dojo', () => {
    show()
    act(() => setSaveState('offline'))
    expect(screen.getByTestId('save-status')).toHaveAttribute('href', '/settings#disk')
    expect(screen.getByTestId('save-status').getAttribute('title')).toMatch(/Dock/)
  })
})

describe('I2: rejected changes in the save status', () => {
  it.each([[1, "1 change couldn't be saved"], [3, "3 changes couldn't be saved"]])('%i parked -> "%s", linking to Settings', (count, text) => {
    show()
    act(() => { setSaveState('saved'); setRejectedCount(count) })
    expect(screen.getByTestId('save-status')).toHaveTextContent(/^Saved$/)
    const link = screen.getByTestId('save-rejected')
    expect(link).toHaveTextContent(text)
    expect(link).toHaveAttribute('href', '/settings#unsaved')
  })

  it('shows nothing extra when no change is parked', () => {
    show()
    act(() => setSaveState('saved'))
    expect(screen.queryByTestId('save-rejected')).toBeNull()
  })
})

describe('G4 #1: not the writer', () => {
  it('the header says to reopen Dojo from the Dojo app, next to "Not saved to disk"', () => {
    show()
    act(() => setSaveState('offline', NOT_WRITER_MESSAGE))
    expect(screen.getByTestId('save-status')).toHaveTextContent(/^Not saved to disk$/)
    expect(screen.getByTestId('save-status').getAttribute('title')).toContain('Reopen Dojo from the Dojo app')
    expect(screen.getByTestId('save-hint')).toHaveTextContent('Reopen Dojo from the Dojo app')
  })
})
