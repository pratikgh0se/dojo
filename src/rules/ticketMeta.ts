import type { Kind, Lane, Ticket } from '../data/types'
import type { GlyphName } from '../ui/glyphData'

export const KIND_GLYPH: Record<Kind, GlyphName> = {
  watch: 'play', read: 'doc', problem: 'code', build: 'terminal', design: 'branch',
  writeup: 'edit', task: 'flag', ritual: 'calendar', stage: 'block',
}
export const KIND_LABEL: Record<Kind, string> = {
  watch: 'Watch', read: 'Read', problem: 'Problem', build: 'Build', design: 'Design',
  writeup: 'Write-up', task: 'Task', ritual: 'Ritual', stage: 'Stage',
}
/** README "Lane tag": a bank ticket shows as DSA. */
export const LANE_LABEL: Record<Lane, string> = {
  path: 'AI', dsa: 'DSA', design: 'Design', career: 'Career', ritual: 'Ritual', bank: 'DSA',
}

export { laneOf } from './lanes'
/** The lane every view shows and puts in `data-lane` (`bank` reads as `dsa`). */
export { tagLane } from './queue'

/** Rulings R2: a ticket's title is shown verbatim everywhere; kept as an identity so call sites need no change. */
export const plainTitle = (t: Pick<Ticket, 'kind' | 'title'>): string => t.title

export const minutesLabel = (min: number): string => `${Math.round(min)} min`

/** `START · REVIEW`, `RESUME · 12:40`: one place keeps the GLOBAL-03 `VERB · OBJECT` shape. */
export const verbWord = (verb: string, object: string): string => `${verb.toUpperCase()} · ${object.toUpperCase()}`

/** `START · WATCH`, `DONE · BUILD`: the verb says what the click does, the object what it is about. */
export const verbObject = (verb: 'START' | 'RESUME' | 'DONE' | 'OPEN' | 'REDO', kind: Kind): string => verbWord(verb, KIND_LABEL[kind])
