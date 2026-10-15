export const FORMS = ['BASE', 'KINDLE', 'SURGE', 'TEMPEST', 'PRIMAL', 'ZENITH', 'AZURE', 'VOID', 'SOVEREIGN'] as const
/** The level (LV = floor(xp / 10)) each form starts at. Fixed: the plan growing or shrinking never moves a form. */
export const FORM_LV = [0, 10, 40, 100, 180, 300, 450, 650, 900]

/** TODAY-53: powerup while a reward plays (1.8 s after a Done), idle the rest of the time. */
export type PomPose = 'idle' | 'powerup'

export interface FormInfo {
  index: number
  name: string
  nextName: string | null
  /** XP still to earn for the next form, 0 at the last */
  toNext: number
  /** lit segments of the 12-cube meter: floor(12 x (xp - first level XP) / (next form XP - first level XP)), 0 to 11 (12 at the last form) */
  segOn: number
  /** XP at the shown form's first level and at the next form's, the meter's bounds; both 0 at the last form */
  fromXp: number
  untilXp: number
}

const xpAt = (i: number) => FORM_LV[i] * 10

function computedForm(xp: number): number {
  let i = 0
  while (i < FORMS.length - 1 && xp >= xpAt(i + 1)) i++
  return i
}

/** The form to show: the larger of the one the XP earns and `formMax`, the highest form ever reached (settings.pomFormMax). */
export function formOf(xp: number, formMax = 0): FormInfo {
  const index = Math.max(computedForm(xp), Math.min(formMax, FORMS.length - 1))
  if (index === FORMS.length - 1) return { index, name: FORMS[index], nextName: null, toNext: 0, segOn: 12, fromXp: 0, untilXp: 0 }
  const lo = xpAt(index)
  const hi = xpAt(index + 1)
  // progress within the shown form's range: whole segments only, so a full meter means the next form is reached
  const segOn = Math.max(0, Math.min(11, Math.floor((12 * (xp - lo)) / (hi - lo))))
  return { index, name: FORMS[index], nextName: FORMS[index + 1], toNext: Math.max(0, hi - xp), segOn, fromXp: lo, untilXp: hi }
}

/** The form to store as the new maximum, or null when nothing is to be written (not above the stored one). */
export function formToStore(xp: number, stored: number | undefined): number | null {
  const computed = computedForm(xp)
  return computed > (stored ?? 0) ? computed : null
}
