import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** README-dashboard "XP, levels, forms": Pom's pose is powerup for 1.8 s after a tick. */
export const POWERUP_MS = 1800

/** `fire(ms, false)` is a power-up that granted no XP (a timer end): it plays, but `onFire` is not told. */
interface PowerUp { active: boolean; fire: (ms?: number, grantsXp?: boolean) => void }
const Ctx = createContext<PowerUp>({ active: false, fire: () => {} })

/** `onFire` runs after every XP-granting power-up, also under reduced motion where nothing is drawn. */
export function PowerUpProvider({ children, onFire }: { children: ReactNode; onFire?: () => void }) {
  const [active, setActive] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const fire = useCallback((ms: number = POWERUP_MS, grantsXp = true) => {
    if (grantsXp) onFire?.()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    window.clearTimeout(timer.current)
    const root = document.documentElement
    root.dataset.powerups = String(Number(root.dataset.powerups ?? '0') + 1)
    setActive(true)
    timer.current = window.setTimeout(() => setActive(false), ms)
  }, [onFire])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const value = useMemo(() => ({ active, fire }), [active, fire])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePowerUp = (): PowerUp => useContext(Ctx)
