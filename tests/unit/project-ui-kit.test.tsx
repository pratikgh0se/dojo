import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../src/screens/ai/Dialog'

function Harness({ nested = false }: { nested?: boolean }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Dialog title="Artifact · x" testId="dlg" onClose={() => setOpen(false)}>
          <input aria-label="First" />
          <button type="button" disabled={busy} onClick={() => setBusy(true)}>Run</button>
          <button type="button" onClick={() => setConfirm(true)}>Last</button>
          {nested && confirm && (
            <Dialog role="alertdialog" title="Delete this artifact?" onClose={() => setConfirm(false)}
              initialFocus={() => screen.getByRole('button', { name: 'Keep' })}>
              <button type="button">Delete</button>
              <button type="button" onClick={() => setConfirm(false)}>Keep</button>
            </Dialog>
          )}
        </Dialog>
      )}
    </>
  )
}

function openHarness(nested = false) {
  render(<Harness nested={nested} />)
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, dialog: screen.getByRole('dialog', { name: 'Artifact · x' }) }
}

describe('Dialog', () => {
  it('is a named modal that focuses its first control', () => {
    const { dialog } = openHarness()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-testid', 'dlg')
    expect(document.activeElement).toBe(screen.getByLabelText('First'))
  })

  it('traps Tab and Shift+Tab at the edges', () => {
    openHarness()
    const first = screen.getByLabelText('First')
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Esc and returns focus to the opener', () => {
    const { opener, dialog } = openHarness()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps shortcut keys from reaching window listeners (Review Focus #2)', () => {
    const seen: string[] = []
    const onKey = (e: KeyboardEvent) => seen.push(e.key)
    window.addEventListener('keydown', onKey)
    openHarness()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Last' }), { key: '2' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Last' }), { key: 'm' })
    window.removeEventListener('keydown', onKey)
    expect(seen).toEqual([])
  })

  it('steps focus back into the dialog when its focused control goes real-disabled (chain P task 7)', async () => {
    openHarness()
    const run = screen.getByRole('button', { name: 'Run' })
    run.focus()
    expect(document.activeElement).toBe(run)
    fireEvent.click(run)
    expect(run).toBeDisabled()
    // A real `disabled` attribute means the browser itself blurs the control straight to <body>,
    // outside the dialog's own subtree (Escape's keydown handler would never fire from there);
    // the dialog watches for exactly this and steps focus back to its first control.
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('First')))
  })

  it('Esc in a nested alertdialog closes only the alertdialog', () => {
    openHarness(true)
    fireEvent.click(screen.getByRole('button', { name: 'Last' }))
    const alert = screen.getByRole('alertdialog', { name: 'Delete this artifact?' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }))
    fireEvent.keyDown(alert, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Artifact · x' })).toBeInTheDocument()
  })
})
