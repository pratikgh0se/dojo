// I9: the specs (and the one test from each) that the `real` project runs against dojo-server, built
// with disk sync on: Today start to Done (through the ticket view), Path reorder, Review grade, Do/ladder, Designs, Banks and one labs spec.
// Every title below exists after the R1 triage (`--project=real --list` names only these). One test per file,
// because the server lives for the whole file, so a second test in it would start from the first
// one's data (every one of these begins by onboarding).
export const REAL_SUBSET: Record<string, string> = {
  'today-flow.spec.ts': 'R1 Today: Start opens the quest ticket, Done finishes it, and the ticket, its XP and one session are stored',
  'path-reorder.spec.ts': 'R1 Path: Alt+ArrowUp moves a DSA row up within its lane, writes only its orderOverride, and the order survives a reload',
  'review-grade.spec.ts': 'R1 Review: a due check card is answered first, revealed and graded Got it; the badge, the queue and the data agree',
  'ladder.spec.ts': 'H-01…H-09 climb the ladder on p200, reload keeps the cycle, Give up unlocks Solution',
  'design-session.spec.ts': 'D-9 timer survives reload; a session left open locks on load',
  'banks.spec.ts': 'Mine and Codeforces import survive reload (S-33, S-35, S-38, S-40, S-41)',
  'feat-f1.spec.ts': 'the pulse: input, Log, Enter, persists, Edit overwrites the same row, no XP',
  'scope2-w6.spec.ts': 'BANK-08 to BANK-14, BANK-25 answer first, grade, regrade, Add to Review; BANK-15 the Review card',
  'labs.spec.ts': 'S12/S13/S15: own input, stepping, captions, play to the end marks seen',
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const REAL_FILES = Object.keys(REAL_SUBSET).map(f => `**/e2e/${f}`)
export const REAL_GREP = new RegExp(Object.values(REAL_SUBSET).map(t => `(^|\\s)${escape(t)}$`).join('|'))
