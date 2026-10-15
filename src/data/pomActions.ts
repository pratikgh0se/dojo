import { getSettings, patchSettings, type DojoDB } from './db'
import { formOf, formToStore } from '../rules/forms'
import { headerXp } from '../rules/xp'

/** The form the learner sees right now: the larger of the one the XP earns and `settings.pomFormMax`. Read only. */
export async function shownForm(d: DojoDB): Promise<number> {
  return formOf(headerXp(await d.tickets.toArray()), (await getSettings(d)).pomFormMax).index
}

/**
 * Called by an action that just granted XP. `before` is the form shown before that action (`shownForm`).
 * Stores the earned form when it is above `settings.pomFormMax` (TODAY-52), and reports the step only when the SHOWN form
 * rose above `before`, so the caller celebrates it once (TODAY-54). A first XP action on a state whose LV already earns
 * KINDLE (nothing stored) writes the form but reports nothing. Never called on load.
 */
export async function recordFormUp(d: DojoDB, before: number): Promise<{ from: number; to: number } | null> {
  return d.transaction('rw', d.tickets, d.settings, async () => {
    const stored = (await getSettings(d)).pomFormMax
    const xp = headerXp(await d.tickets.toArray())
    const write = formToStore(xp, stored)
    if (write !== null) await patchSettings(d, { pomFormMax: write })
    const to = formOf(xp, write ?? stored).index
    return to > before ? { from: before, to } : null
  })
}
