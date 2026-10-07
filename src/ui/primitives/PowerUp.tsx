import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** README-dashboard "XP, levels, forms": Pom's pose is powerup for 1.8 s after a tick. */
export const POWERUP_MS = 1800

interface PowerUp { active: boolean; fire: (ms?: number) => void }
const Ctx = createContext<PowerUp>({ active: false, fire: () => {} })

export function PowerUpProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const fire = useCallback((ms: number = POWERUP_MS) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    window.clearTimeout(timer.current)
    const root = document.documentElement
    root.dataset.powerups = String(Number(root.dataset.powerups ?? '0') + 1)
    setActive(true)
    timer.current = window.setTimeout(() => setActive(false), ms)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const value = useMemo(() => ({ active, fire }), [active, fire])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePowerUp = (): PowerUp => useContext(Ctx)
