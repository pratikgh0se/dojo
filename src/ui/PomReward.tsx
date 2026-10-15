import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDb } from '../data/dbContext'
import { recordFormUp, shownForm } from '../data/pomActions'
import { FORMS } from '../rules/forms'
import { PowerUpProvider, useFlash } from './primitives'
import './pomReward.css'

/** A form increase is celebrated for 2.5 s; with reduced motion it is a static notice for 2 s. */
export const FORMUP_MS = 2500
export const FORMUP_REDUCED_MS = 2000

const PlayCtx = createContext<(form: number) => void>(() => {})

/** Plays the celebration for a form. It never reads or writes data: the Settings debug panel uses it as it is. */
export const usePlayFormUp = () => useContext(PlayCtx)

/**
 * The reward layer: the power-up, and the one celebration when an XP-granting action lifts Pom to a new form.
 * The form is stored (settings.pomFormMax) by that action, so a reload never plays it again.
 */
export function PomRewardProvider({ children }: { children: ReactNode }) {
  const d = useDb()
  const flash = useFlash()
  const [shown, setShown] = useState<{ form: number; reduced: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const play = useCallback((form: number) => {
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.clearTimeout(timer.current)
    if (!reduced) flash()
    setShown({ form, reduced })
    timer.current = window.setTimeout(() => setShown(null), reduced ? FORMUP_REDUCED_MS : FORMUP_MS)
  }, [flash])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // never rejects: a refused or failed write (read-only browser, full storage) only means no celebration
  // `form` is the form shown before the next XP action; a chain keeps two quick actions in order. It starts from the
  // data when the layer mounts and moves only when an action ends, so nothing else (a timer, a re-render) can celebrate.
  const form = useRef<Promise<number>>(Promise.resolve(0))
  useEffect(() => { form.current = shownForm(d).catch(() => 0) }, [d])
  const onFire = useCallback(() => {
    form.current = form.current.then(async before => {
      try {
        const up = await recordFormUp(d, before)
        if (up) play(up.to)
        return up ? up.to : before
      } catch { return before }
    })
  }, [d, play])
  const value = useMemo(() => play, [play])
  return (
    <PlayCtx.Provider value={value}>
      <PowerUpProvider onFire={onFire}>{children}</PowerUpProvider>
      {shown && createPortal(
        <div className="pom-formup" role="status" data-testid="pom-formup" data-form={shown.form} data-motion={shown.reduced ? 'static' : 'animated'}>
          <span className="pom-formup-cap">Pom · new form</span>
          <span className="pom-formup-name">{FORMS[shown.form]}</span>
        </div>,
        document.body,
      )}
    </PlayCtx.Provider>
  )
}
