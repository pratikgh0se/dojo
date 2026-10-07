// The study session runner (ux spec section 3; contract UX addendum 3). Everything a session does
// besides drawing itself lives here, so it works on every screen and in every tab: advance by the wall
// clock, credit focus blocks, bank them into the attempt cycle, chime. The Do screen only renders and
// sends actions. Every write reads the FRESH stored session first (updateStudy), so a stale tab can
// neither double-credit nor bring an ended session back.
import type { DojoDB } from '../data/db'
import { closeLadderSession, type LadderClose } from '../data/ladderActions'
import { endStudySession, recordFocus, startDoing } from '../data/sessionActions'
import { safeWrite } from '../data/safeWrite'
import type { EndLog, Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { bankRun, clearCycle, loadCycle, saveCycle } from '../lib/cycle'
import { localDayKey } from '../lib/dates'
import { clearDraft, closingNotes, dropSessionNotes, loadDraft } from '../lib/drafts'
import { dropEndDraft } from '../lib/endDraft'
import { newId } from '../lib/id'
import { loadStudy, notifyStudy, saveStudy, saveChimePref, clearStudy } from '../lib/studyStore'
import { applyAdvance, blockTimer } from '../lib/studyTimer'
import { blockingTimerTicketId, clearTimer, loadTimer, saveTimer } from '../lib/timer'
import { advance, markProgress, phaseEnd, startStudy, type Study } from '../rules/studySession'
import { copy } from '../lib/platform'

export interface Fx {
  chime: () => void
  toast: (msg: string, tone?: 'ok' | 'warn' | 'danger' | 'help') => void
  onError: (msg: string) => void
  /** overrides the browser's read-only state (tests) */
  readOnly?: boolean
}

/** A rung opened or a tick on one of the session's cards inside the block's window is a progress action. */
async function hadProgress(d: DojoDB, s: Study): Promise<boolean> {
  const end = phaseEnd(s)
  const evs = await d.events.where('id').anyOf(s.cardIds).toArray()
  return evs.some(e => (e.t === 'rung' || e.t === 'tick') && e.at >= s.phaseStart && e.at <= end)
}

/** Ticks of this tab still writing their focus events; a pass closing the session waits for them (Addendum 9). */
const ticking = new Set<Promise<void>>()

/** One clock tick. Safe to call from any number of tabs: only a fresh, unchanged session is advanced. */
export function runTick(d: DojoDB, nowMs: number, fx: Fx): Promise<void> {
  const p = tickOnce(d, nowMs, fx)
  ticking.add(p)
  const done = () => void ticking.delete(p)
  p.then(done, done)
  return p
}

async function tickOnce(d: DojoDB, nowMs: number, fx: Fx): Promise<void> {
  const seen = loadStudy()
  if (!seen || seen.away || seen.paused != null || nowMs < phaseEnd(seen)) return
  let s = seen
  if (s.phase === 'focus' && !s.progress && (await hadProgress(d, s))) s = markProgress(s)
  const r = advance(s, nowMs)
  if (!r.switched) return
  // nothing awaits between this check and the save, so the read-check-write is atomic in this tab
  const cur = loadStudy()
  if (!cur || cur.id !== seen.id || cur.phaseStart !== seen.phaseStart || cur.blocks !== seen.blocks || cur.phase !== seen.phase || cur.away) return
  saveStudy(r.study)
  const out = applyAdvance(loadCycle(seen.ticketId), seen, r, nowMs)
  if (out.cycle) saveCycle(out.cycle)
  if (out.timer) saveTimer(out.timer)
  notifyStudy()
  const readOnly = fx.readOnly ?? isReadOnly()
  if (!readOnly) {
    for (const b of r.finished) {
      await safeWrite(() => recordFocus(d, { ticketId: seen.ticketId, at: b.end, minutes: b.minutes, sid: seen.id, block: b.index }), fx.onError)
    }
  }
  if (r.study.chime && !r.away) fx.chime()
  if (r.finished.length) fx.toast(`Focus block done · ${r.finished[r.finished.length - 1].minutes} min`)
}

export interface Plan { goal: string; focusMin: number; breakMin: number; cardIds: string[]; chime: boolean }

/** Start a session on `ticket`. False when refused (another timer or session, read-only is gated by the caller). */
export async function beginStudy(a: { d: DojoDB; ticket: Ticket; plan: Plan; nowMs: number } & Fx): Promise<boolean> {
  const { d, ticket, plan, nowMs } = a
  const blocker = blockingTimerTicketId(loadTimer(), ticket.id)
  if (blocker) {
    const other = await d.tickets.get(blocker)
    a.toast(`Timer running on ${other?.title ?? blocker} — stop it first`, 'danger')
    return false
  }
  if (ticket.status !== 'done') {
    const r = await safeWrite(() => startDoing(d, ticket.id, nowMs), a.onError)
    if (!r) return false
    if (!r.ok) {
      a.toast(r.message, 'danger')
      return false
    }
  }
  bankLive(ticket.id, nowMs)
  const s = startStudy({ id: newId('st', nowMs), ticketId: ticket.id, goal: plan.goal, cardIds: plan.cardIds, focusMin: plan.focusMin, breakMin: plan.breakMin, chime: plan.chime, now: nowMs })
  saveChimePref(plan.chime)
  saveTimer(blockTimer(s, nowMs, nowMs + plan.focusMin * 60_000, true))
  saveStudy(s)
  notifyStudy()
  return true
}

/** Bank the legacy timer's running window into the ticket's cycle (before it is replaced or stopped). */
function bankLive(ticketId: string, nowMs: number): void {
  const tm = loadTimer()
  const cycle = loadCycle(ticketId)
  if (tm && cycle && tm.ticketId === ticketId && tm.running) saveCycle(bankRun(cycle, tm, nowMs))
}

/** End the stored session with its end log: one `studied` row (id `s-<session id>`), then clear it. Idempotent. */
export async function finishStudy(a: { d: DojoDB; log: Partial<EndLog>; nowMs: number } & Fx): Promise<boolean> {
  const s = loadStudy()
  if (!s) return true
  bankLive(s.ticketId, a.nowMs)
  const r = await safeWrite(
    () => endStudySession(a.d, {
      ticketId: s.ticketId, start: s.startedAt, now: a.nowMs, goal: s.goal, cards: s.cardIds, focusMinutes: s.blocks * s.focusMin,
      endLog: a.log, sessionId: `s-${s.id}`,
    }),
    a.onError,
  )
  if (!r) return false
  if (!r.ok && r.reason !== 'duplicate') {
    a.toast(r.message, 'danger')
    return false
  }
  const tm = loadTimer()
  if (tm && tm.ticketId === s.ticketId) clearTimer()
  clearStudy()
  dropSessionNotes(s.ticketId)
  dropEndDraft(s.id)
  notifyStudy()
  if (r.ok) a.toast('Session saved')
  return true
}

/**
 * briefs Addendum 6: a passed learning check ends a study session running on that card exactly as
 * Solved does in Do (finish()): one `solved` session row carrying the plan line and the finished focus
 * minutes, then the timer, the session, the attempt cycle and the draft are cleared. Called from the
 * check's pass handler (CheckDialog), so it works wherever the check was opened (Do, Today, the Board,
 * CheckGate). Do exits focus mode when it sees the session gone. False when there was nothing to close.
 */
export async function closeStudyOnCheckPass(a: { d: DojoDB; ticketId: string; nowMs: number; /** XP the pass earned (submitCheck's xpDelta) */ xpDelta?: number } & Fx): Promise<boolean> {
  const { d, ticketId, nowMs } = a
  // a focus block this tab is still crediting lands before the close, never after it
  await Promise.allSettled([...ticking])
  const stored = loadStudy()
  const s = stored && stored.ticketId === ticketId ? stored : null
  // Addendum 10: with no study session, an open Do attempt (a stored cycle and/or this card's timer) is
  // closed by the pass all the same. With neither, there is nothing to close (ticked from Today).
  const openTimer = loadTimer()
  const attemptTimer = openTimer && openTimer.ticketId === ticketId ? openTimer : null
  const attemptCycle = loadCycle(ticketId)
  if (!s && !attemptTimer && !attemptCycle) return false
  const stillRunning = (why: string) => a.toast(`${why} ${s ? "The study session is still running; use End session on the card's Do page." : 'The attempt is still open on its Do page.'}`, 'danger')
  if (a.readOnly ?? isReadOnly()) {
    stillRunning(copy('readOnlyPass'))
    return false
  }
  const t = await d.tickets.get(ticketId)
  if (!t) return false
  const mine = attemptTimer
  const cycle = attemptCycle
  const draft = loadDraft(ticketId)
  const isAi = t.track === 'ai'
  // same rule as finish(): a stopped timer's sessionStart is trusted only while running or same-day (N1)
  const sessionStart = mine && (mine.running || localDayKey(mine.sessionStart) === localDayKey(nowMs)) ? mine.sessionStart : nowMs
  // a study session closes under the id End session would give it; an attempt with no study under one derived from its cycle/timer
  const rowId = s ? `s-${s.id}` : `s-pass-${cycle?.id ?? `t${mine?.sessionStart ?? nowMs}`}`
  // One row per session (Addendum 8). The study re-read inside this transaction is only a best-effort check:
  // localStorage is not part of the Dexie transaction, so it is not atomic across tabs. The real guard is the
  // deterministic row id (`s-<study id>`, the one End session gives its row) together with closeLadderSession's
  // duplicate check and endStudySession's block dedupe: whichever tab writes second finds the row and writes nothing.
  let r: LadderClose | undefined
  let blocks = s?.blocks ?? 0 // the focus blocks the closed session held, for the line that says it ended (UAT cu-4 P3-11)
  let reported = false // safeWrite already told the user (quota, read-only): no second toast
  try {
    r = await safeWrite(
    () => d.transaction('rw', [d.tickets, d.sessions, d.events, d.rungUses, d.redos], async (): Promise<LadderClose> => {
      // read the session again here: a tick (another tab's) may have saved a block since the first read
      const cur = s ? loadStudy() : null
      if (s && (!cur || cur.id !== s.id)) return { ok: false, reason: 'duplicate', message: 'Session already ended' }
      // a block that ended on the clock but no tick has credited yet is credited now, before the pass
      const adv = s && cur ? advance(cur, nowMs) : null
      if (s && cur && adv) for (const b of adv.finished) await recordFocus(d, { ticketId, at: b.end, minutes: b.minutes, sid: cur.id, block: b.index })
      if (adv) blocks = adv.study.blocks
      return closeLadderSession(d, {
        ticketId, outcome: 'solved', attemptStart: cycle?.attemptStart ?? s?.startedAt ?? mine?.sessionStart ?? nowMs, cycleId: cycle?.id ?? '', sessionStart, now: nowMs,
        netAtStart: cycle?.netAtStart ?? t.xp - (a.xpDelta ?? 0), redoId: cycle?.redoId ?? null,
        notes: closingNotes(draft, isAi),
        proof: isAi ? { repo: draft.repo, note: draft.note } : undefined,
        ...(cur && adv ? { goal: cur.goal, focusMinutes: adv.study.blocks * cur.focusMin } : {}),
        checkPass: true, sessionId: rowId,
      })
    }),
    m => { reported = true; a.onError(m) },
  )
  } catch {
    r = undefined // any other write error: the session stays, and says so below
  }
  if (!r) {
    if (!reported) stillRunning('Your pass is saved, but the session could not be closed.')
    return false
  }
  if (!r.ok) {
    if (r.reason !== 'duplicate') stillRunning(`Your pass is saved, but the session could not be closed (${r.message}).`)
    else {
      // another tab's End (or close) already wrote this session's row; the attempt is over all the same
      clearDraft(ticketId)
      clearCycle(ticketId)
      notifyStudy()
    }
    return false
  }
  if (mine) clearTimer()
  if (s) {
    clearStudy()
    dropEndDraft(s.id)
    // the same line Solved says (Do's finish()): the check ended the session with the card, and it is under Earlier sessions
    a.toast(`Study session ended with the card · ${blocks} focus block${blocks === 1 ? '' : 's'}`)
  }
  clearDraft(ticketId)
  clearCycle(ticketId)
  notifyStudy()
  return true
}

export { pauseSession, resumeSession, resumeAfterAway } from './controls'
