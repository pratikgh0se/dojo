import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { downloadText } from '../../src/lib/downloadText'
import { CubeMark } from '../../src/screens/ai/CubeMark'
import { Dialog } from '../../src/screens/ai/Dialog'
import { focusRegion, Region } from '../../src/screens/ai/Region'
import { StepLoader } from '../../src/screens/ai/StepLoader'

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

describe('Region, CubeMark, StepLoader', () => {
  it('Region is a named region that focusRegion focuses', () => {
    render(<Region id="ai-cubes" title="Learn → build → prove" testId="ai-cube-ladder"><p>x</p></Region>)
    const r = screen.getByRole('region', { name: 'Learn → build → prove' })
    expect(r).toHaveAttribute('data-testid', 'ai-cube-ladder')
    focusRegion('ai-cubes')
    expect(document.activeElement).toBe(r)
    focusRegion('missing')
  })

  it('CubeMark is a named img with data-state, or hidden when unnamed', () => {
    render(<><CubeMark state="partial" name="Stage 00 learn: partial (1/3)" testId="c1" /><CubeMark state="full" testId="c2" /></>)
    expect(screen.getByRole('img', { name: 'Stage 00 learn: partial (1/3)' })).toHaveAttribute('data-state', 'partial')
    expect(screen.getByTestId('c2')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('c2')).toHaveAttribute('data-state', 'full')
  })

  it('StepLoader is a status named by its label with three blocks', () => {
    render(<StepLoader label="Grading…" testId="grade-loading" />)
    const s = screen.getByRole('status', { name: 'Grading…' })
    expect(s).toHaveAttribute('data-testid', 'grade-loading')
    expect(s.querySelectorAll('i')).toHaveLength(3)
  })
})

describe('downloadText', () => {
  it('downloads a named text blob through a temporary link', () => {
    const blobs: Blob[] = []
    const clicked: { href: string; download: string }[] = []
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return 'blob:dojo/1' }), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download })
    })
    downloadText('dojo-measures.md', '# Measures\n')
    expect(blobs[0].size).toBe(11)
    expect(blobs[0].type).toBe('text/markdown;charset=utf-8')
    expect(clicked).toEqual([{ href: 'blob:dojo/1', download: 'dojo-measures.md' }])
    expect(document.querySelector('a[download]')).toBeNull()
    click.mockRestore()
  })
})
