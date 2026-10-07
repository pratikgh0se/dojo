import type { DojoEvent, StoredEvent, Ticket } from '../data/types'

export const UNDO_DEPTH = 20

export type SlideEvent = Extract<DojoEvent, { t: 'slide' }>
export type SlideSprintEvent = Extract<DojoEvent, { t: 'slide_sprint' }>
export type ShiftPlanEvent = Extract<DojoEvent, { t: 'shift_plan' }>
/** UAT J7: "Move to sprint…" (and an accepted rebalance) can be undone too. */
export type MovedEvent = Extract<DojoEvent, { t: 'moved' }>
/** UAT r3 J7: a Board column move (drag, Shift+arrow, d) is undoable as well. */
export type ColumnEvent = Extract<DojoEvent, { t: 'column' }>
/** Ruling 20 S6: a split is undoable while none of its parts has been started. */
export type SplitEvent = Extract<DojoEvent, { t: 'split' }>
export type SlideLikeEvent = (SlideEvent | SlideSprintEvent | ShiftPlanEvent | MovedEvent | ColumnEvent | SplitEvent) & { seq?: number; appSession?: string }

export type SlideReason = 'done' | 'backwards' | 'same'
export const SLIDE_MESSAGES: Record<SlideReason, string> = {
  done: 'Done tickets never slide',
  backwards: "Can't slide back past the current sprint",
  same: '',
}

export type SlideResult = { ok: true; ticket: Ticket; event: SlideEvent } | { ok: false; reason: SlideReason }

const byOrder = (a: Ticket, b: Ticket) => a.order - b.order

export function slideTicket(
  t: Ticket,
  to: number,
  now: number,
  current: number,
  reason: 'manual' | 'sprint' | 'plan' = 'manual',
): SlideResult {
  if (t.status === 'done') return { ok: false, reason: 'done' }
  if (to === t.sprint) return { ok: false, reason: 'same' }
  if (to < current) return { ok: false, reason: 'backwards' }
  // Pulling a ticket to an EARLIER sprint than it currently sits in (still >= current)
  // is not a "slide" in the debt sense — don't push onto slidFrom, so it doesn't render
  // in the "Slid in" column.
  const slidFrom = to > t.sprint ? [...t.slidFrom, t.sprint] : t.slidFrom
  return {
    ok: true,
    ticket: { ...t, sprint: to, slidFrom, status: 'todo' },
    event: { t: 'slide', id: t.id, at: now, from: t.sprint, to, reason },
  }
}

function slideTarget(sprint: number, current: number): number {
  return Math.max(sprint + 1, current)
}

function unfinishedIn(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets.filter(t => !t.archived && t.sprint === sprint && t.status !== 'done')
}

export function nextSlideTarget(t: Ticket, current: number): number {
  return slideTarget(t.sprint, current)
}

export function slideSprint(
  tickets: Ticket[],
  sprint: number,
  now: number,
  current: number,
): { tickets: Ticket[]; event: SlideSprintEvent } {
  const to = slideTarget(sprint, current)
  const moved = unfinishedIn(tickets, sprint)
    .sort(byOrder)
    .map(t => ({ ...t, sprint: to, slidFrom: [...t.slidFrom, sprint], status: 'todo' as const }))
  return { tickets: moved, event: { t: 'slide_sprint', at: now, sprint, to, count: moved.length, ids: moved.map(t => t.id) } }
}

export function slideSprintPreview(tickets: Ticket[], sprint: number, current: number): { count: number; to: number; resultingSize: number } {
  const to = slideTarget(sprint, current)
  const count = unfinishedIn(tickets, sprint).length
  // Plan tickets only: a done bank/mine ticket can sit at any sprint and isn't part of
  // sprint capacity.
  const already = tickets.filter(t => !t.archived && t.origin === 'plan' && t.sprint === to).length
  return { count, to, resultingSize: already + count }
}

export function shiftPlan(tickets: Ticket[], fromSprint: number, now: number): { tickets: Ticket[]; event: ShiftPlanEvent } {
  const moved = tickets
    .filter(t => !t.archived && t.sprint >= fromSprint && t.status !== 'done')
    .sort(byOrder)
    .map(t => ({ ...t, sprint: t.sprint + 1 }))
  const to: Record<string, number> = {}
  moved.forEach(t => { to[t.id] = t.sprint })
  return { tickets: moved, event: { t: 'shift_plan', at: now, fromSprint, ids: moved.map(t => t.id), to } }
}

export function undoEvent(tickets: Ticket[], ev: SlideLikeEvent): Ticket[] {
  const byId = new Map(tickets.map(t => [t.id, t]))
  const back = (id: string, from: number, to: number): Ticket | null => {
    const t = byId.get(id)
    if (!t || t.status === 'done' || t.sprint !== to) return null
    const slidFrom = [...t.slidFrom]
    if (slidFrom[slidFrom.length - 1] === from) slidFrom.pop()
    return { ...t, sprint: from, slidFrom }
  }
  const keep = (x: Ticket | null): x is Ticket => x !== null
  if (ev.t === 'column') return [] // undone through the Board move itself (data/boardActions undoLast): it carries XP
  if (ev.t === 'split') return [] // undone by removing the parts (data/splitActions undoSplit)
  if (ev.t === 'slide') return [back(ev.id, ev.from, ev.to)].filter(keep)
  if (ev.t === 'moved') {
    const t = byId.get(ev.id)
    return t && t.status !== 'done' && t.sprint === ev.to ? [{ ...t, sprint: ev.from }] : []
  }
  if (ev.t === 'slide_sprint') return ev.ids.map(id => back(id, ev.sprint, ev.to)).filter(keep)
  return ev.ids
    .map(id => {
      const t = byId.get(id)
      if (!t || t.status === 'done' || t.sprint !== ev.to[id]) return null
      return { ...t, sprint: t.sprint - 1 }
    })
    .filter(keep)
}

export function undoneSeqs(events: StoredEvent[]): Set<number> {
  return new Set(events.flatMap(e => (e.t === 'undo' ? [e.of] : [])))
}

const UNDOABLE = new Set<string>(['slide', 'slide_sprint', 'shift_plan', 'moved', 'column', 'split'])

export interface UndoScope {
  /** ruling 20 S6: only events this app session wrote (a relaunch starts with an empty history); omitted: all */
  appSession?: string
  /** an event that can no longer be undone (a split whose parts were started): it leaves the history */
  blocked?: (e: SlideLikeEvent) => boolean
}

export function undoableEvents(events: StoredEvent[], scope: UndoScope = {}): SlideLikeEvent[] {
  const undone = undoneSeqs(events)
  return events
    .filter((e): e is SlideLikeEvent => UNDOABLE.has(e.t) && typeof e.seq === 'number')
    .filter(e => scope.appSession === undefined || e.appSession === scope.appSession)
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    .slice(0, UNDO_DEPTH)
    .filter(e => !undone.has(e.seq ?? -1) && !scope.blocked?.(e))
}

/**
 * UAT J7: one "Move to sprint…" of a split card (the card and its sessions) or one accepted
 * rebalance writes a moved event per card, all at one instant. Undo takes them back as one step,
 * so Undo (n) counts what the user did, not the events it wrote. Newest step first.
 */
export function undoableSteps(events: StoredEvent[], scope: UndoScope = {}): SlideLikeEvent[][] {
  const steps: SlideLikeEvent[][] = []
  for (const e of undoableEvents(events, scope)) {
    const step = steps[steps.length - 1]
    const head = step?.[0]
    if (e.t === 'moved' && head?.t === 'moved' && head.at === e.at && head.to === e.to && head.why === e.why) step.push(e)
    else steps.push([e])
  }
  return steps
}

const STATUS_WORD: Record<string, string> = { todo: 'Todo', doing: 'Doing', done: 'Done', slid: 'Slid in' }
const cardsText = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

/** Ruling 20 S6: what Undo will undo, named: "Undo: move '200 · Number of Islands' to Sprint 2". */
export function undoLabel(step: readonly SlideLikeEvent[] | undefined, tickets: readonly Ticket[]): string {
  const e = step?.[0]
  if (!e) return 'Nothing to undo'
  const title = (id: string) => `'${tickets.find(t => t.id === id)?.title ?? id}'`
  switch (e.t) {
    case 'column': return `Undo: move ${title(e.id)} to ${STATUS_WORD[e.to] ?? e.to}`
    case 'slide': return `Undo: slide ${title(e.id)} to Sprint ${e.to}`
    case 'slide_sprint': return `Undo: slide ${cardsText(e.count)} from Sprint ${e.sprint} to Sprint ${e.to}`
    case 'shift_plan': return `Undo: shift the plan from Sprint ${e.fromSprint}`
    case 'split': return `Undo: split ${title(e.id)} into ${e.parts.length} sessions`
    case 'moved':
      return e.why === 'rebalance' && step!.length > 1
        ? `Undo: rebalance (${cardsText(step!.length)} to Sprint ${e.to})`
        : `Undo: move ${title(e.id)} to Sprint ${e.to}`
  }
}
