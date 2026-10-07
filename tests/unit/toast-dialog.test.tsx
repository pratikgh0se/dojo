import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dialog } from '../../src/screens/ai/Dialog'
import { ToastProvider, useToast } from '../../src/ui/primitives'

function Push() {
  const toast = useToast()
  return <button onClick={() => toast('Saved it')}>push</button>
}

describe('toasts and modal dialogs', () => {
  it('a toast raised behind an open dialog is outside the inert app root: still live', async () => {
    render(<ToastProvider><Push /><Dialog title="D" onClose={() => {}}><p>x</p></Dialog></ToastProvider>)
    const btn = document.querySelector('button') as HTMLButtonElement
    act(() => btn.click())
    const toast = await screen.findByTestId('toast')
    const region = toast.closest('[data-live-region]') as HTMLElement
    expect(region).not.toBeNull()
    expect(region.inert).toBe(false)
    expect(region.parentElement).toBe(document.body)
    expect((document.body.firstElementChild as HTMLElement).inert).toBe(true) // the app root behind the dialog
  })

  it('shell-today-board A4: a dialog under a nested confirm is inert; it comes back when the confirm closes', () => {
    const { rerender } = render(<Dialog title="Outer" onClose={() => {}}><input aria-label="field" /><Dialog title="Inner" role="alertdialog" onClose={() => {}}><button>Keep</button></Dialog></Dialog>)
    const outer = screen.getByRole('dialog', { name: 'Outer', hidden: true }).closest('.p-backdrop') as HTMLElement
    const inner = screen.getByRole('alertdialog', { name: 'Inner' }).closest('.p-backdrop') as HTMLElement
    expect(outer.inert).toBe(true)
    expect(inner.inert).toBe(false)
    rerender(<Dialog title="Outer" onClose={() => {}}><input aria-label="field" /></Dialog>)
    expect(outer.inert).toBe(false)
  })

  it('M1: never more than 3 toasts; the oldest goes first', async () => {
    function Many() {
      const toast = useToast()
      return <button onClick={() => ['t1', 't2', 't3', 't4'].forEach(t => toast(t))}>many</button>
    }
    render(<ToastProvider><Many /></ToastProvider>)
    act(() => screen.getByRole('button', { name: 'many' }).click())
    const items = await screen.findAllByTestId('toast')
    expect(items.map(i => i.textContent)).toEqual(['t2', 't3', 't4'])
  })
})
