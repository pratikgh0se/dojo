import type { DiagramJson, SolutionOutput, SrAlgoJson } from '../ai/types'
import { newId } from '../lib/id'
import { deepestOf, sessionRungs, spentOf, ticketNet } from '../rules/ladderView'
import { redoOutcome, type RedoEffect } from '../rules/redoQueue'
import { closeSessionResult } from '../rules/session'
import { ticketBaseXp } from '../rules/xp'
import type { DojoDB } from './db'
import { syncParentOf } from './splitActions'
import { needsCheck } from '../rules/brief'
import type { HelpRung, Outcome, Rung, RungUse, Session, Ticket, TicketAi } from './types'

/** C-LADDER §2.3: max(0, base once solved − Σ applied help + Σ refunds), floored once.
 * The one XP function for every path that awards a ticket's xp (the ladder's own rung/session
 * flow, and Board's moveTicket → done): solvedEver is purely t.status === 'done', and base is
 * ticketBaseXp(t) (the Codeforces-rating rule when the ticket has a rating, else baseXp). */
export async function netOf(d: DojoDB, t: Ticket): Promise<number> {
  const [uses, events] = await Promise.all([
    d.rungUses.where('ticketId').equals(t.id).toArray(),
    d.events.where('id').equals(t.id).toArray(),
  ])
  const solvedEver = t.status === 'done'
  const refunds = events.reduce((a, e) => a + (e.t === 'redo_pass' ? e.refund : 0), 0)
  const applied = uses.reduce((a, u) => a + u.applied, 0)
  return ticketNet({ base: ticketBaseXp(t), solvedEver, applied, refunds })
}

export interface RungOutput {
  hint?: { level: 1 | 2; text: string }
  picture?: SrAlgoJson
  diagram?: DiagramJson
  solution?: SolutionOutput
}

export interface RecordRungInput {
  ticketId: string
  attemptStart: number
  /** the attempt cycle this rung belongs to (Cycle.id) - see RungUse.cycleId's doc comment */
  cycleId: string
  rung: HelpRung
  cost: number
  at: number
  level?: 1 | 2
  redoId?: string | null
  /** new model output to store on the ticket; absent when a stored output is reused */
  output?: RungOutput
  /** a rung opened after Give up joins the closed session (C-LADDER §2.3) */
  afterGiveUp?: { sessionId: string; redoId: string; countsTowardRedo: boolean; failedRedo: boolean }
}

/** Charges a rung. Call only after its content exists (C-LADDER §2.1 "cost only on delivery"). */
export async function recordRung(d: DojoDB, i: RecordRungInput): Promise<{ xp: number; delta: number }> {
  return d.transaction('rw', [d.tickets, d.rungUses, d.events, d.sessions, d.redos, d.pictures], async () => {
    const t = await d.tickets.get(i.ticketId)
    if (!t) throw new Error(`Ticket ${i.ticketId} not found`)
    const ai: TicketAi = { ...(t.ai ?? {}) }
    if (i.output?.hint) {
      const hints = [...(ai.hints ?? [])]
      hints[i.output.hint.level - 1] = i.output.hint.text
      ai.hints = hints
    }
    if (i.output?.picture) {
      ai.picture = i.output.picture
      await d.pictures.put({ key: t.id, json: i.output.picture, source: 'model', createdAt: i.at })
    }
    if (i.output?.diagram) ai.diagram = i.output.diagram
    if (i.output?.solution) ai.solution = i.output.solution
    const applied = i.afterGiveUp?.failedRedo ? 0 : i.cost
    const use: RungUse = {
      id: newId('ru', i.at), ticketId: t.id, attemptStart: i.attemptStart, cycleId: i.cycleId, rung: i.rung, at: i.at, cost: i.cost, applied, refunded: 0,
      ...(i.level ? { level: i.level } : {}),
      ...(i.output?.picture || i.output?.diagram ? { source: 'model' as const } : {}),
      ...(i.redoId ? { redoId: i.redoId } : {}),
    }
    await d.rungUses.add(use)
    await d.events.add({ t: 'rung', id: t.id, at: i.at, rung: i.rung, cost: i.cost, applied })
    const next: Ticket = { ...t, ai, deepestRung: Math.max(t.deepestRung ?? 0, i.rung) as Rung }
    const xp = await netOf(d, next)
    await d.tickets.put({ ...next, xp })
    const delta = xp - t.xp
    if (i.afterGiveUp) {
      const s = await d.sessions.get(i.afterGiveUp.sessionId)
      if (s) {
        const rungs = [...new Set<Rung>([...(s.rungs ?? [1]), i.rung])].sort((a, b) => a - b)
        await d.sessions.update(s.id, { rungs, xpDelta: s.xpDelta + delta })
      }
      if (i.afterGiveUp.countsTowardRedo) {
        const r = await d.redos.get(i.afterGiveUp.redoId)
        if (r) await d.redos.update(r.id, { helpCost: r.helpCost + i.cost })
      }
    }
    return { xp, delta }
  })
}

export interface LadderCloseInput {
  ticketId: string
  outcome: Outcome
  attemptStart: number
  /** the attempt cycle being closed (Cycle.id) - see RungUse.cycleId's doc comment */
  cycleId: string
  sessionStart: number
  now: number
  netAtStart: number
  /** the cycle's redo id when the cycle began as a redo session, else null */
  redoId: string | null
  notes?: string
  proof?: { repo?: string; note?: string }
  /** the study session this close ends, if any: its plan line and finished focus minutes go on the session row */
  goal?: string
  focusMinutes?: number
  /**
   * briefs Addendum 8: this close follows a passed learning check. The check is the proof of
   * understanding, so no redo effect runs (no redo is created, reset, passed or failed), whatever
   * help rungs the cycle opened. Only a failed check schedules a redo (submitCheck, BR-06).
   */
  checkPass?: boolean
  /** a deterministic row id (a study session's `s-<study id>`): a second close with it writes nothing (reason `duplicate`) */
  sessionId?: string
}

export type LadderClose =
  | { ok: true; session: Session; xpDelta: number; net: number; effect: RedoEffect }
  | { ok: false; reason: string; message: string }

export async function closeLadderSession(d: DojoDB, i: LadderCloseInput): Promise<LadderClose> {
  return d.transaction('rw', [d.tickets, d.sessions, d.events, d.rungUses, d.redos], async (): Promise<LadderClose> => {
    const t = await d.tickets.get(i.ticketId)
    if (!t) return { ok: false, reason: 'missing', message: 'Ticket not found' }
    if (t.archived) return { ok: false, reason: 'archived', message: 'Ticket is archived' }
    if (i.outcome !== 'gave_up' && needsCheck(t)) return { ok: false, reason: 'check_required', message: 'Check your understanding first' }
    if (i.sessionId && (await d.sessions.get(i.sessionId))) return { ok: false, reason: 'duplicate', message: 'Session already saved' }
    const uses = (await d.rungUses.where('ticketId').equals(t.id).toArray()).filter(u => u.cycleId === i.cycleId)
    const live = (await d.redos.where('ticketId').equals(t.id).toArray()).find(r => r.closedAt === undefined) ?? null
    const redoSession = i.redoId !== null && live !== null && live.id === i.redoId
    const effect: RedoEffect = i.checkPass ? { kind: 'none' } : redoOutcome({
      live, redoSession, outcome: i.outcome, deepestRung: deepestOf(uses), helpCost: spentOf(uses),
      end: i.now, ticketId: t.id, newRedoId: newId('r', i.now),
    })
    // Apply the redo effect's ledger changes (applied resets on fail, refund events) before
    // computing net XP, so the tick event and the ticket both record the same, truly final net -
    // the single ledger function (netOf) that Board's Done move also uses.
    if (effect.kind === 'fail') {
      for (const u of uses) await d.rungUses.update(u.id, { applied: 0 })
      await d.events.add({ t: 'redo_fail', id: t.id, at: i.now, stage: effect.stageBefore, refund: 0 })
    }
    if (effect.kind === 'pass') await d.events.add({ t: 'redo_pass', id: t.id, at: i.now, stage: effect.stageBefore, refund: effect.refund })
    if (effect.kind !== 'none') await d.redos.put(effect.redo)

    const finalStatus = i.outcome !== 'gave_up' || t.status === 'done' ? 'done' : 'todo'
    const net = await netOf(d, { ...t, status: finalStatus })
    const base = closeSessionResult({
      ticket: t, outcome: i.outcome, sessionStart: i.sessionStart, now: i.now, notes: i.notes, proof: i.proof, sessionId: i.sessionId ?? newId('s', i.now), net,
    })
    const goal = i.goal?.trim()
    const session: Session = {
      ...base.session, rungs: sessionRungs(uses), ...(redoSession ? { redoId: i.redoId as string } : {}),
      ...(goal ? { goal } : {}), // 0 is kept: a study session closed with no finished focus block still has its Earlier sessions row (cu-r2 A2#11)
      ...(typeof i.focusMinutes === 'number' ? { focusMinutes: i.focusMinutes } : {}),
    }
    await d.sessions.add(session)
    if (base.event) await d.events.add(base.event)
    await d.tickets.put({ ...base.ticket, xp: net })
    const xpDelta = net - i.netAtStart
    await d.sessions.update(session.id, { xpDelta })
    await syncParentOf(d, t.id, i.now)
    return { ok: true, session: { ...session, xpDelta }, xpDelta, net, effect }
  })
}

/** C-LADDER §2.3: a 2/3 quiz marks the session understood; ticket status is unchanged. */
export async function markUnderstood(d: DojoDB, sessionId: string): Promise<void> {
  await d.sessions.update(sessionId, { understood: true })
}
