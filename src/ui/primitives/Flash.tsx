import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const FlashCtx = createContext<() => void>(() => {})

export function FlashProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false)
  const fire = useCallback(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.dataset.flashes = String(Number(root.dataset.flashes ?? '0') + 1)
    setOn(true)
    window.setTimeout(() => setOn(false), 120)
  }, [])
  return (
    <FlashCtx.Provider value={fire}>
      {children}
      {on && <div className="sr-flash" data-testid="flash" aria-hidden="true" />}
    </FlashCtx.Provider>
  )
}

export const useFlash = (): (() => void) => useContext(FlashCtx)
