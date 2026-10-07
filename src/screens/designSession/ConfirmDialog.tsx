import { useRef } from 'react'
import { Dialog } from '../ai/Dialog'
import { Button } from '../../ui/primitives'

/**
 * shell-today-board A4/A5: a confirm in the shared house Dialog (F6.6): modal, Tab trapped, the background
 * inert, Esc cancels, focus returns to the opener. The action comes first (accent, or danger when it destroys),
 * then the quiet safe choice, which takes focus first.
 */
export function ConfirmDialog({
  title, confirmLabel, cancelLabel, onConfirm, onCancel, tone = 'accent',
}: { title: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; tone?: 'accent' | 'danger' }) {
  const safe = useRef<HTMLButtonElement>(null)
  return (
    <Dialog title={title} onClose={onCancel} initialFocus={() => safe.current}>
      <div className="p-actions">
        <Button variant={tone} onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="quiet" ref={safe} onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </Dialog>
  )
}
