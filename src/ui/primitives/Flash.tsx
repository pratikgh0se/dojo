import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

const FlashCtx = createContext<() => void>(() => {})

export function FlashProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false)
  const timers = useRef(new Set<number>())
  // Cancel pending 120 ms timers on unmount; otherwise they can fire after the window is gone (jsdom teardown).
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((id) => window.clearTimeout(id))
      pending.clear()
    }
  }, [])
  const fire = useCallback(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.dataset.flashes = String(Number(root.dataset.flashes ?? '0') + 1)
    setOn(true)
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      setOn(false)
    }, 120)
    timers.current.add(id)
  }, [])
  return (
    <FlashCtx.Provider value={fire}>
      {children}
      {on && <div className="sr-flash" data-testid="flash" aria-hidden="true" />}
    </FlashCtx.Provider>
  )
}

export const useFlash = (): (() => void) => useContext(FlashCtx)
