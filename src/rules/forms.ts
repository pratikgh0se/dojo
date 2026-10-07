export const FORMS = ['BASE', 'KINDLE', 'SURGE', 'TEMPEST', 'PRIMAL', 'ZENITH', 'AZURE', 'VOID', 'SOVEREIGN'] as const
export const FORM_THRESHOLDS = [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]

export interface FormInfo {
  index: number
  name: string
  nextName: string | null
  share: number
  toNext: number
  segOn: number
}

const EPS = 1e-9

export function formOf(xp: number, possible: number): FormInfo {
  const share = possible > 0 ? xp / possible : 0
  let index = 0
  while (index < FORMS.length - 1 && share + EPS >= FORM_THRESHOLDS[index + 1]) index++
  if (index === FORMS.length - 1) {
    return { index, name: FORMS[index], nextName: null, share, toNext: 0, segOn: 12 }
  }
  const lo = FORM_THRESHOLDS[index] * possible
  const hi = FORM_THRESHOLDS[index + 1] * possible
  const toNext = Math.max(0, Math.ceil(hi - xp - EPS))
  const segOn = Math.max(0, Math.min(12, Math.round((12 * (xp - lo)) / Math.max(1, hi - lo))))
  return { index, name: FORMS[index], nextName: FORMS[index + 1], share, toNext, segOn }
}
