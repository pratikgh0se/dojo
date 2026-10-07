// I9: the specs (and the one test from each) that the `real` project runs against dojo-server, built
// with disk sync on: Today, Board, Do/ladder, Designs, Banks and one labs spec. One test per file,
// because the server lives for the whole file, so a second test in it would start from the first
// one's data (every one of these begins by onboarding).
export const REAL_SUBSET: Record<string, string> = {
  'today-parity.spec.ts': 'tick from This sprint: flash, +10 xp · Saved, Pom powerup → training, Carrot 6/6 → 5/6',
  'm2.spec.ts': 'M2: drag to Done, Slide sprint, Shift plan, Undo twice',
  'ladder.spec.ts': 'H-01…H-09 climb the ladder on p200, reload keeps the cycle, Give up unlocks Solution',
  'design-session.spec.ts': 'D-9 timer survives reload; a session left open locks on load',
  'banks.spec.ts': 'bank tick: XP but no plan progress, Board Done chip, reload, untick (S-21–S-25)',
  'labs.spec.ts': 'S12/S13/S15: own input, stepping, captions, play to the end marks seen',
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const REAL_FILES = Object.keys(REAL_SUBSET).map(f => `**/e2e/${f}`)
export const REAL_GREP = new RegExp(Object.values(REAL_SUBSET).map(t => `(^|\\s)${escape(t)}$`).join('|'))
