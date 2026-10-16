/** W5: the Floor session is up to this many due Review cards, then one Journal line. */
export const FLOOR_CARDS = 5
export const WELCOME_LINE = 'Welcome back. A short one is plenty today.'

/** The session's cards: the snapshot taken when it opened, in order, minus cards no longer due (graded) and cards set aside (Missed it, Skip). */
export function floorQueue<C extends { id: string }>(cards: readonly C[], ids: readonly string[], aside: readonly string[]): C[] {
  return ids.flatMap(id => (aside.includes(id) ? [] : cards.filter(c => c.id === id)))
}
