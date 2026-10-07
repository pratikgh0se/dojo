import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastTone = 'ok' | 'warn' | 'danger' | 'help'
export const TOAST_MS = 1400
export const MAX_TOASTS = 3
type Push = (text: string, tone?: ToastTone) => void

const ToastCtx = createContext<Push>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; text: string; tone: ToastTone }>>([])
  const seq = useRef(0)
  const push = useCallback<Push>((text, tone = 'ok') => {
    const id = ++seq.current
    // F7 / F6.7: the Read-only toast is always the warn tone, whichever caller raised it
    const t: ToastTone = /^Read-only\b/.test(text) ? 'warn' : tone
    // shell-today-board M1: never more than 3 visible; the oldest is dropped first
    setItems(xs => [...xs, { id, text, tone: t }].slice(-MAX_TOASTS))
    window.setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), TOAST_MS)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* a portal on <body>, marked as a live region: an open modal dialog makes the app root inert but
          leaves this alone, so a toast raised behind a dialog is still announced (and seen) */}
      {createPortal(
      <div className="sr-toasts" role="status" aria-live="polite" data-live-region>
        {items.map(i => (
          <div key={i.id} className={`sr-toast tone-${i.tone}`} data-tone={i.tone} data-testid="toast">{i.text}</div>
        ))}
      </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = (): Push => useContext(ToastCtx)
