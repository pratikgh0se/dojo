import type { Ticket } from '../../src/data/types'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { smallPlan } from './plan'

export function mkTicket(p: Partial<Ticket> & { id: string }): Ticket {
  return {
    origin: 'plan', track: 'ai', kind: 'task', title: p.id, links: [], estMin: 50,
    plannedSprint: 1, sprint: 1, status: 'todo', slidFrom: [], xp: 0, archived: false, order: 0,
    ...p,
  }
}

export function smallTickets(): Ticket[] {
  return planToTickets(smallPlan).map(newTicket)
}
