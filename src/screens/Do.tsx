import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tipProps } from '../ui/Tip'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useDb, usePlan } from '../app/providers'
import { buildJobRequest, type DiagramJson, type JobContext, type JobName, type SolutionOutput, type SrAlgoJson } from '../ai/types'
import { approachesFor } from '../content/approaches'
import { callJob } from '../data/aiActions'
import { setSessionApproach } from '../data/atlasActions'
import { useChildren, useDoQuery, useSessions, useSettings, useTicket, useTickets } from '../data/hooks'
import { closeLadderSession, markUnderstood, recordRung, type RungOutput } from '../data/ladderActions'
import { safeWrite } from '../data/safeWrite'
import { startDoing } from '../data/sessionActions'
import type { EndLog, HelpRung, Kind, Outcome, Redo, RungUse, Ticket } from '../data/types'
import { playChime, primeChime } from '../lib/chime'
import { now } from '../lib/clock'
import { openCheck } from '../lib/checkGate'
import {
  bankRun, clearCycle, cycleElapsedMs, gaveUpFor, isStaleEmpty, loadCycle, newCycle, saveCycle, saveGaveUp,
  type Cycle, type GaveUp,
} from '../lib/cycle'
import { localDayKey, pad2 } from '../lib/dates'
import { clearDraft, closingNotes, isEmptyDraft, loadDraft, saveDraft, type Draft } from '../lib/drafts'
import { isActivatable, isPlainKey, isStrayBackgroundKey, isTypingTarget } from '../lib/keys'
import { clearStudy, loadChimePref, loadStudy, notifyStudy, saveChimePref, subscribeStudy } from '../lib/studyStore'
import { sessionLabel } from '../lib/studyTimer'
import { blockingTimerTicketId, clearTimer, isPaused, loadTimer, pauseTimer, resumeTimer, saveTimer, startTimer, timerView, type TimerState } from '../lib/timer'
import { useNow } from '../lib/useNow'
import { shortSource } from '../rules/board'
import {
  announceText, helpUsed, HINT_UNLOCK_SECONDS, ladderView, newlyUnlocked, RUNG_NAMES, RUNG_OF, spentOf, spentOn, type RungName, type RungView,
} from '../rules/ladderView'
import { displayTitle, dueMs, givenUpText, isRedoDue, outcomeFeedback, redoBannerText } from '../rules/redoQueue'
import {
  aiTicketOf, designDeepDives, diagramSummary, NO_VIDEO, NO_WATCH_LINK, pairedWatchId,
  pictureSummary, QUIZ_PASS, quizResultText, quizScore, taskPictureLinks, videoLinks,
} from '../rules/rungContent'
import { isContainer, needsCheck } from '../rules/brief'
import { partIndexOf } from '../rules/split'
import { nextSlideTarget } from '../rules/slide'
import { currentSprint } from '../rules/sprint'
import { lastDraftFailure, useDraftStore } from '../data/draftJob'
import { shownText } from '../rules/ticketText'
import { CardBrief } from './brief/CardBrief'
import { SessionList, SplitButton } from './brief/SplitDialog'
import { ApproachQuestion, ApproachStrip } from '../ui/algo/ApproachStrip'
import { useLeaveDo } from '../app/origin'
import { Sized } from '../ui/Sized'
import type { AiFailure } from '../ui/ai/AiStates'
import { SaveStatus } from '../ui/SaveStatus'
import { Button, Panel, useFlash, usePowerUp, useToast } from '../ui/primitives'
import { useCardActions } from '../ui/useCardActions'
import { Ladder, type LadderContent, type PictureBody } from './do/Ladder'
import { TimerBusyDialog } from './do/TimerBusyDialog'
import { EndLogDialog } from './do/study/EndLogDialog'
import { SessionHistory } from './do/study/SessionHistory'
import { FocusView } from './do/study/FocusView'
import { PlanDialog, type PlanResult } from './do/study/PlanDialog'
import { SessionPanel } from './do/study/SessionPanel'
import { StuckDialog } from './do/study/StuckDialog'
import { beginStudy, finishStudy, resumeSession } from '../study/runner'
import { useStudyFor } from '../study/useStudy'
import { SessionDock } from '../study/SessionPill'
import { isReadOnly, READ_ONLY_MESSAGE } from '../data/writer'
import { RedoReplay, replayPicture } from './do/RedoReplay'
import { CodePanel } from '../runner/CodePanel'
import { hasPack } from '../runner/client'
import { usePassGate } from '../runner/gate'
import './do.css'
import { Loading } from '../ui/Loading'
import { WithFileRefs } from '../ui/FileRefs'

const RUN_GATE_HINT_ID = 'do-run-gate-hint'
const SESSION_NOTE_ID = 'do-session-ends-note'
const blocksText = (n: number) => `${n} focus block${n === 1 ? '' : 's'}`
/** UAT cu-4 P3-11: said before the click, while a study session runs, and again after it: finishing the card ends the session too. */
/** UAT cu-4 P3-5: the Stuck? prompt's reason for having no help rung to open, with the minutes the Hint still needs when that is the reason. */
export function noRungText(elapsedSec: number, hint: RungView['state']): string {
  if (hint === 'locked' && elapsedSec < HINT_UNLOCK_SECONDS) {
    const min = Math.ceil((HINT_UNLOCK_SECONDS - elapsedSec) / 60)
    return `No help rung is unlocked yet: the Hint opens after 10 minutes on this attempt (${min} min to go).`
  }
  return 'No help rung is unlocked yet.'
}
export const sessionEndsNote = (blocks: number) =>
  `Solved ✓, Solved with help and Give up also end your study session (${blocksText(blocks)} so far). It stays under Earlier sessions.`
export const RUN_GATE_HINT = 'Submit 5/5 to unlock Solved'

const DIFF: Record<string, string> = { E: 'Easy', M: 'Medium', H: 'Hard' }

/** UAT r3 J3: "Retreat" is the design's word (handoff README, the Spar timer); its name and tooltip say what it does.
 * The accessible name keeps the visible word first (label in name). */
const RETREAT_LABEL = 'Retreat: stop the timer'
const RETREAT_TITLE = 'Stop the timer'
/** UAT cu-4 P3-3: what the Custom minutes field says, on the page, while its value is wrong (a toast was gone in 1.4 s). */
export const CUSTOM_MINUTES_ERROR = 'Custom minutes must be a whole number from 1 to 240.'
const CUSTOM_ERROR_ID = 'do-custom-error'
/** The minutes in the Custom field, or null when it is empty, not a number, or outside 1 to 240. */
export function customMinutes(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 && n <= 240 ? Math.round(n) : null
}
/** UAT r2 J3: Pause and Resume share one width, so Retreat beside them never moves. */
const PAUSE_LABELS = ['Pause', 'Resume'] as const

export function Do() {
  const { ticketId = '' } = useParams()
  const leave = useLeaveDo()
  const q = useDoQuery(ticketId)
  if (q === undefined) return <Loading />
  const { ticket, redo, uses } = q
  if (ticket === null) {
    // ui-do D9: one .do-missing paragraph and do-back
    return (
      <main className="do-missing-screen" data-testid="do-screen">
        <button type="button" className="do-back" data-testid="do-back" onClick={leave}>‹ Back</button>
        <p className="do-missing">No ticket {ticketId}.</p>
      </main>
    )
  }
  return <DoScreen key={ticket.id} ticket={ticket} redo={redo} allUses={uses} />
}

interface CycleState { cycle: Cycle | null; gaveUp: GaveUp | null }

/** C-LADDER §2.2/§2.4: resume the cycle, or start one (a redo session when the redo is due right now). */
function initialCycle(ticket: Ticket, redo: Redo | null, allUses: RungUse[], t: number): CycleState {
  // ruling 21 (r6 P3 #1): a split card has no attempt of its own; its parts do. Visiting it opens no cycle.
  if (isContainer(ticket)) return { cycle: null, gaveUp: null }
  const gaveUp = gaveUpFor(ticket.id, t)
  if (gaveUp) return { cycle: null, gaveUp }
  const timer = loadTimer()
  let cycle = loadCycle(ticket.id)
  if (cycle) {
    if (isStaleEmpty(cycle, allUses.filter(u => u.cycleId === cycle!.id).length, timer, t)) {
      clearCycle(ticket.id)
      cycle = null
    }
  }
  if (!cycle) {
    // newCycle mints a fresh, unique id (Cycle.id) regardless of what `t` is - rungUses key off
    // that id (RungUse.cycleId), not attemptStart, so two cycles can never collide even if a
    // frozen/adjusted wall clock hands them the same `now()` (C-LADDER §2.4: a due redo's row
    // must open with its own, empty ladder, not silently inherit an earlier cycle's uses).
    cycle = newCycle({ ticketId: ticket.id, now: t, redo: redo && isRedoDue(redo, t) ? { id: redo.id, stage: redo.stage } : null, netAtStart: ticket.xp, timer })
    saveCycle(cycle)
  }
  return { cycle, gaveUp: null }
}

function jobFor(name: RungName, kind: Kind): JobName | null {
  if (name === 'hint') return 'hint'
  if (name === 'solution') return 'solution'
  if (name === 'picture' && kind === 'problem') return 'picture'
  if (name === 'picture' && kind === 'design') return 'diagram'
  return null
}

function toOutput(name: RungName, kind: Kind, level: 1 | 2, output: unknown): RungOutput {
  if (name === 'hint') return { hint: { level, text: (output as { hint: string }).hint } }
  if (name === 'picture') return kind === 'design' ? { diagram: output as DiagramJson } : { picture: output as SrAlgoJson }
  return { solution: output as SolutionOutput }
}

function DoScreen({ ticket, redo, allUses }: { ticket: Ticket; redo: Redo | null; allUses: RungUse[] }) {
  const d = useDb()
  const plan = usePlan()
  const navigate = useNavigate()
  const leave = useLeaveDo()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const t = useNow(1000)
  const [{ cycle, gaveUp }, setCycleState] = useState<CycleState>(() => initialCycle(ticket, redo, allUses, now()))
  const [timer, setTimer] = useState<TimerState | null>(() => loadTimer())
  const [custom, setCustom] = useState('')
  const [customBad, setCustomBad] = useState(false)
  /** UAT cu-4 P3-5: Start was refused because another card owns the one timer or session; what it was, and what to do next */
  const [blocked, setBlocked] = useState<{ id: string; kind: 'timer' | 'session'; then: { kind: 'session' } | { kind: 'timer'; min: number } } | null>(null)
  const [draft, setDraft] = useState<Draft>(() => loadDraft(ticket.id))
  const [busy, setBusy] = useState<RungName | null>(null)
  const [errors, setErrors] = useState<Partial<Record<RungName, AiFailure>>>({})
  const [announce, setAnnounce] = useState('')
  const [quizResult, setQuizResult] = useState<string | null>(null)
  const openLock = useRef(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [savingEnd, setSavingEnd] = useState(false)
  const [focusMode, setFocusModeRaw] = useState(false)
  // UAT cu-2 P3-9: leaving focus mode returns the page to where the reader was (the screen under it is hidden meanwhile,
  // and the browser clamps the scroll to the top), so the place is taken on the way in and put back on the way out
  const inFocus = useRef(false)
  const scrollBeforeFocus = useRef(0)
  const setFocusMode = (v: boolean | ((m: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(inFocus.current) : v
    if (next && !inFocus.current) scrollBeforeFocus.current = window.scrollY
    inFocus.current = next
    setFocusModeRaw(next)
  }
  const allTickets = useTickets()
  const allSessions = useSessions()
  const settings = useSettings()
  const { slide } = useCardActions()
  const study = useStudyFor(ticket.id)
  // the session can end away from Do's own buttons (a passed check, another tab): leave focus mode with it
  const hasStudy = study.study !== null
  useEffect(() => { if (!hasStudy) setFocusMode(false) }, [hasStudy]) // eslint-disable-line react-hooks/exhaustive-deps
  const focusShown = hasStudy && focusMode
  const wasFocusShown = useRef(false)
  useLayoutEffect(() => {
    if (wasFocusShown.current && !focusShown) window.scrollTo(0, scrollBeforeFocus.current)
    wasFocusShown.current = focusShown
  }, [focusShown])
  // the runner (Shell) advances the session, banks the cycle and moves the timer; pick that up from storage
  useEffect(() => subscribeStudy(() => {
    setTimer(loadTimer())
    const stored = loadCycle(ticket.id)
    // the cycle was closed outside this screen (a passed check, Addendum 6; another tab): drop our copy and the draft too
    const closed = !stored && loadStudy() === null
    if (closed) setDraft(loadDraft(ticket.id))
    setCycleState(s => ({ ...s, cycle: stored ?? (closed ? null : s.cycle) }))
  }), [ticket.id])
  const pair = useTicket(pairedWatchId(ticket.id) ?? '') ?? null
  const kids = useChildren(ticket.children) ?? []
  const container = isContainer(ticket)
  // ruling 20 S3: a part is its parent's work: the parent's brief, approaches and problem label (LC 200, not LC 200~1)
  const parent = useTicket(ticket.childOf ?? '') ?? null
  const itemId = ticket.childOf ?? ticket.id
  const partNo = ticket.childOf ? partIndexOf(ticket) : null
  // ruling 20 S7: the last Draft briefs run failed because Claude Code isn't signed in (re-read as the run ends)
  const draftJob = useDraftStore().job
  const signedOut = useMemo(() => lastDraftFailure() === 'claude_signed_out', [draftJob]) // eslint-disable-line react-hooks/exhaustive-deps
  // a learning card with a brief is finished through its check ("Mark done"), not by Solved
  const checkGate = needsCheck(ticket)
  /** the closed session awaiting "Which approach did you use?" (labs §7.3), and his answer */
  const [asking, setAsking] = useState<{ sessionId: string; chosen: string | null } | null>(null)
  const hasApproaches = ticket.kind === 'problem' && approachesFor(itemId).length > 0
  const isAi = ticket.track === 'ai'
  const isTaskKind = ticket.kind === 'task' || ticket.kind === 'stage'
  const mine = timer && timer.ticketId === ticket.id ? timer : null
  const view = timerView(mine, t)
  const lc = ticket.kind === 'problem' ? itemId.replace(/^p/, '') : null
  const onError = (m: string) => toast(m, 'danger')

  const attemptStart = gaveUp?.attemptStart ?? cycle?.attemptStart ?? 0
  const cycleId = gaveUp?.cycleId ?? cycle?.id ?? ''
  const uses = allUses.filter(u => u.cycleId === cycleId).sort((a, b) => a.at - b.at)
  const redoSession = gaveUp ? gaveUp.redoSession : cycle !== null && cycle.redoId !== null
  const redoStage = gaveUp ? gaveUp.redoStage : cycle?.redoStage ?? null
  const elapsedMs = gaveUp ? gaveUp.elapsedMs : cycle ? cycleElapsedMs(cycle, timer, t) : 0
  const elapsedSec = Math.floor(elapsedMs / 1000)
  const replay = redoSession && elapsedSec === 0 && !mine?.running ? replayPicture(ticket) : null
  const rungs = ladderView({ kind: ticket.kind, uses, elapsedSec, gaveUp: gaveUp !== null, redo: redoSession })
  const byName = (n: RungName): RungView => rungs.find(r => r.name === n) as RungView
  const used = helpUsed(uses)
  const outcomesLocked = cycle === null || gaveUp !== null || container
  // C-RUNNER §4 Solved gate: on a pack ticket, Solved and Solved with help wait for a Submit passing 5/5 in this attempt.
  const pack = hasPack(ticket.id)
  const { passCycle, onSubmitPassed } = usePassGate(ticket.id, cycleId)
  const runGate = pack && (cycleId === '' || passCycle !== cycleId)
  // L6: the "Submit 5/5" hint only when the run gate is what keeps the buttons disabled
  const gateHint = runGate && !outcomesLocked
  const ai = ticket.ai ?? {}
  const hintUses = uses.filter(u => u.rung === 2)

  const prevRungs = useRef<RungView[] | null>(null)
  const stateKey = rungs.map(r => r.state).join(',')
  // useLayoutEffect (not useEffect): the "newly unlocked" announcement must land in the same
  // flush as the rungUses/ticket update that unlocked it, or a synchronous assertion right after
  // an awaited state change (as in the do-ladder tests) can read the DOM before the announcement
  // effect's own state update has committed — a real race with a plain passive effect.
  useLayoutEffect(() => {
    const hit = newlyUnlocked(prevRungs.current, rungs)
    if (hit) setAnnounce(announceText(hit))
    prevRungs.current = rungs
    // rungs is rebuilt every render; only a state change matters here
  }, [stateKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // UAT cu-2p P3-4: the session's Notes end with the session; the next one starts with an empty box
  const hadStudy = useRef(study.study !== null)
  useEffect(() => {
    if (hadStudy.current && study.study === null) setDraft(d => (d.sessionNotes ? { ...d, sessionNotes: '' } : d))
    hadStudy.current = study.study !== null
  }, [study.study])

  useEffect(() => {
    if (isEmptyDraft(draft)) clearDraft(ticket.id)
    else saveDraft(ticket.id, draft)
  }, [ticket.id, draft])

  function bank(tm: TimerState | null) {
    if (!cycle) return
    const next = bankRun(cycle, tm, now())
    if (next === cycle) return
    saveCycle(next)
    setCycleState(s => ({ ...s, cycle: next }))
  }

  useEffect(() => {
    if (mine && mine.running && view.expired && !mine.notified && !study.active) {
      bank(mine)
      const n = { ...mine, running: false, notified: true }
      saveTimer(n)
      setTimer(n)
      flash()
      powerUp()
      if (loadChimePref()) playChime() // a run that ends unseen is still heard (the same soft chime as a session's block)
      toast(`Power up · ${mine.min} min`)
    }
  }, [mine, view.expired, study.active, flash, powerUp, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  /** True when another card owns the timer or a study session (the Open links, being silent, just do not start one). */
  function blockedFor(then: NonNullable<typeof blocked>['then'], silent = false): boolean {
    const id = blockingTimerTicketId(loadTimer(), ticket.id)
    if (!id) return false
    if (!silent) setBlocked({ id, kind: loadStudy()?.ticketId === id ? 'session' : 'timer', then })
    return true
  }
  /** "Stop it and start here": the other card keeps the minutes it ran (banked into its attempt), its timer is cleared. */
  function stopOtherThenGo() {
    if (!blocked) return
    const tm = loadTimer()
    const theirs = loadCycle(blocked.id)
    if (tm && theirs && tm.ticketId === blocked.id) {
      const next = bankRun(theirs, tm, now())
      if (next !== theirs) saveCycle(next)
    }
    if (tm && tm.ticketId === blocked.id) clearTimer()
    const then = blocked.then
    setBlocked(null)
    if (then.kind === 'session') setPlanOpen(true)
    else void start(then.min)
  }

  async function start(min: number, opts: { silent?: boolean } = {}) {
    if (loadChimePref()) primeChime() // inside the click: the autoplay policy lets the end-of-run chime sound later
    if (blockedFor({ kind: 'timer', min }, opts.silent)) return
    if (ticket.status !== 'done') {
      const r = await safeWrite(() => startDoing(d, ticket.id, now()), onError)
      if (!r) return
      if (!r.ok) {
        toast(r.message, 'danger')
        return
      }
    }
    const next = startTimer(loadTimer(), ticket.id, min, now())
    saveTimer(next)
    setTimer(next)
  }

  /** UAT J3 (D3.5): Pause keeps the rest of the block (the minutes so far are banked); Resume runs it on. */
  function pause() {
    if (!mine) return
    bank(mine)
    const n = pauseTimer(mine, now())
    saveTimer(n)
    setTimer(n)
  }
  function resume() {
    if (!mine) return
    const n = resumeTimer(mine, now())
    saveTimer(n)
    setTimer(n)
  }

  /** Retreat: the block is abandoned (its minutes still count toward the attempt), and the timer is cleared. */
  function retreat() {
    if (!mine) return
    bank(mine)
    clearTimer()
    setTimer(null)
  }

  const fx = { chime: () => {}, toast, onError }

  async function startSession(plan: PlanResult) {
    if (isReadOnly()) {
      toast(READ_ONLY_MESSAGE, 'danger')
      return
    }
    if (!(await beginStudy({ d, ticket, plan, nowMs: now(), ...fx }))) return
    setTimer(loadTimer())
    setCycleState(s => ({ ...s, cycle: loadCycle(ticket.id) ?? s.cycle }))
    setPlanOpen(false)
  }

  async function endSession(log: EndLog) {
    setSavingEnd(true)
    try {
      if (!(await finishStudy({ d, log, nowMs: now(), ...fx }))) return
      setTimer(loadTimer())
      setCycleState(s => ({ ...s, cycle: loadCycle(ticket.id) ?? s.cycle }))
      setEndOpen(false)
      setFocusMode(false)
    } finally {
      setSavingEnd(false)
    }
  }

  function hasStored(name: RungName, level: 1 | 2): boolean {
    if (name === 'hint') return typeof ai.hints?.[level - 1] === 'string'
    if (name === 'picture') return ticket.kind === 'design' ? ai.diagram !== undefined : ai.picture !== undefined
    if (name === 'solution') return ai.solution !== undefined
    return true
  }

  function contextFor(name: RungName, level: 1 | 2): JobContext<JobName> {
    const log = closingNotes(draft, isAi)
    const attemptLog = log ? { attemptLog: log } : {}
    if (name === 'hint') return { level, ...attemptLog }
    if (name === 'picture' && ticket.kind === 'design') return { deepDives: designDeepDives(plan, ticket.id), refs: ticket.links }
    if (name === 'picture') return { language: 'python', ...attemptLog }
    return { gave_up: true, ...attemptLog, ...(ai.picture ? { picture: ai.picture } : {}) }
  }

  /** One click, no confirm; charged only once the content exists (C-LADDER §2.1). */
  async function openRung(name: RungName, level: 1 | 2 = 1) {
    // ruling 21: help is spent on a split card's parts, never on the card itself
    if (openLock.current || asking || container) return
    const r = byName(name)
    const allowed = level === 2 ? name === 'hint' && r.state === 'open' && hintUses.length === 1 : r.state === 'unlocked'
    if (!allowed || r.cost === null) return
    openLock.current = true
    try {
      setErrors(e => ({ ...e, [name]: undefined }))
      let output: RungOutput | undefined
      const job = jobFor(name, ticket.kind)
      if (job && !hasStored(name, level)) {
        setBusy(name)
        const request = buildJobRequest(job, aiTicketOf(ticket), contextFor(name, level))
        const res = await callJob(d, job, request, now())
        setBusy(null)
        if (!res.ok) {
          setErrors(e => ({ ...e, [name]: { code: res.code, message: res.error } }))
          return
        }
        output = toOutput(name, ticket.kind, level, res.output)
      }
      const cost = r.cost
      const redoId = redoSession ? gaveUp?.redoId ?? cycle?.redoId ?? null : null
      await safeWrite(() => recordRung(d, {
        ticketId: ticket.id, attemptStart, cycleId, rung: RUNG_OF[name] as HelpRung, cost, at: now(),
        ...(name === 'hint' ? { level } : {}),
        ...(redoId ? { redoId } : {}),
        ...(output ? { output } : {}),
        ...(gaveUp ? { afterGiveUp: { sessionId: gaveUp.sessionId, redoId: gaveUp.redoId, countsTowardRedo: gaveUp.countsTowardRedo, failedRedo: gaveUp.failedRedo } } : {}),
      }), onError)
      study.mark()
    } finally {
      setBusy(null)
      openLock.current = false
    }
  }

  async function finish(outcome: Outcome) {
    if (!cycle || gaveUp) return
    if (runGate && outcome !== 'gave_up') return
    if (checkGate && outcome !== 'gave_up') return openCheck(ticket.id) // a learning card is finished through its check
    const t0 = now()
    const tm = loadTimer()
    const banked = bankRun(cycle, tm && tm.ticketId === ticket.id ? tm : null, t0)
    // A stopped timer's sessionStart can be stale (Spar → Retreat); trust it only while running or same-day (N1).
    const sessionStart = mine && (mine.running || localDayKey(mine.sessionStart) === localDayKey(t0)) ? mine.sessionStart : t0
    const r = await safeWrite(
      () => closeLadderSession(d, {
        ticketId: ticket.id, outcome, attemptStart: cycle.attemptStart, cycleId: cycle.id, sessionStart, now: t0,
        netAtStart: cycle.netAtStart, redoId: cycle.redoId,
        notes: closingNotes(draft, isAi),
        proof: isAi ? { repo: draft.repo, note: draft.note } : undefined,
        ...(study.study ? { goal: study.study.goal, focusMinutes: study.study.blocks * study.study.focusMin } : {}),
      }),
      onError,
    )
    if (!r) return
    if (!r.ok) {
      toast(r.message, 'danger')
      return
    }
    if (mine) {
      clearTimer()
      setTimer(null)
    }
    if (study.active) {
      clearStudy()
      notifyStudy()
      setFocusMode(false)
      toast(`Study session ended with the card · ${blocksText(study.study?.blocks ?? 0)}`)
    }
    clearDraft(ticket.id)
    clearCycle(ticket.id)
    // Close the cycle in React state too, not just storage: the "asking" detour below (labs §7.3)
    // keeps this component mounted after Solved/Solved with help, so a stale `mine`/`cycle` closure
    // still backs the timer-expiry effect. Without this, a later clock jump while "asking" is showing
    // fires that effect, and its bank(mine) call resurrects the just-closed cycle into storage with
    // its now-stale attemptStart (H-23: a next-day new cycle reused the closed one instead of a fresh,
    // locked ladder).
    setCycleState(s => ({ ...s, cycle: null }))
    const fb = outcomeFeedback(r.effect, outcome, r.xpDelta)
    if (fb.flash) flash()
    if (fb.powerUp) powerUp(fb.powerUpMs)
    toast(fb.text, fb.tone)
    // After Solved / Solved with help on a problem with approaches, stay and ask (D-16); Give up never asks.
    if (outcome !== 'gave_up' && hasApproaches) {
      setAsking({ sessionId: r.session.id, chosen: null })
      return
    }
    if (outcome !== 'gave_up' || r.effect.kind === 'none') {
      navigate('/board')
      return
    }
    const g: GaveUp = {
      ticketId: ticket.id, cycleId: cycle.id, attemptStart: cycle.attemptStart, sessionId: r.session.id, at: t0, elapsedMs: banked.bankedMs,
      netAtStart: cycle.netAtStart, redoId: r.effect.redo.id, redoDue: dueMs(r.effect.redo.due), redoStage: cycle.redoStage,
      redoSession: cycle.redoId !== null, countsTowardRedo: r.effect.kind === 'created' || r.effect.kind === 'reset',
      failedRedo: r.effect.kind === 'fail',
    }
    saveGaveUp(g)
    setCycleState({ cycle: null, gaveUp: g })
  }

  async function checkQuiz(answers: string[]) {
    const k = quizScore(ai.solution?.quiz ?? [], answers)
    setQuizResult(quizResultText(k))
    if (k >= QUIZ_PASS && gaveUp) await safeWrite(() => markUnderstood(d, gaveUp.sessionId), onError)
  }

  async function choose(approach: string) {
    if (!asking) return
    setAsking({ ...asking, chosen: approach })
    await safeWrite(() => setSessionApproach(d, asking.sessionId, approach), onError)
  }

  /** The d key is the outcome button that is enabled: Solved ✓, or Solved with help once help was used. */
  function doneKey() {
    if (outcomesLocked) return
    if (runGate) {
      toast(RUN_GATE_HINT, 'warn')
      return
    }
    void finish(used ? 'solved_help' : 'solved')
  }
  async function slideKey() {
    const row = settings ?? (await d.settings.get('main')) // the screen may be a moment old: read the start date when it is not here yet
    if (!row) return
    const cur = currentSprint(now(), row.startDate)
    await slide(ticket.id, cur, () => toast(`Slid ${ticket.title} to Sprint ${nextSlideTarget(ticket, cur)}`))
  }

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = e => {
    // ui-dp-view M2 / ruling 7 Q19: an Esc the trace (or a dialog) already used, to clear a press, stays there
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (focusMode) setFocusMode(false)
      else leave()
      return
    }
    // a stray click on page background aims no key at a control: letters and space after it do nothing (cu-r2 A2#22)
    const stray = isStrayBackgroundKey()
    if (e.key === 'f' && !stray && study.active && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !isTypingTarget(e.target)) {
      e.preventDefault()
      setFocusMode(m => !m)
      return
    }
    // ruling 23 K1: d marks the card done (a learning card opens its check), s slides it to the next sprint
    if ((e.key === 'd' || e.key === 's') && !stray && isPlainKey(e) && !e.repeat && !asking && !container && !isTypingTarget(e.target)) {
      e.preventDefault()
      if (e.key === 'd') doneKey()
      else void slideKey()
      return
    }
    if (e.key === ' ' && !stray && !asking && !study.active && !container && !isTypingTarget(e.target) && !isActivatable(e.target)) {
      e.preventDefault()
      if (mine?.running) pause()
      else if (isPaused(mine)) resume()
      else void start(mine?.min ?? 25)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  function pictureBody(): PictureBody | null {
    if (byName('picture').state !== 'open') return null
    if (isTaskKind) return { kind: 'links', links: taskPictureLinks(ticket, pair), empty: NO_WATCH_LINK }
    if (ticket.kind === 'design') return ai.diagram ? { kind: 'design', ...diagramSummary(ai.diagram), json: ai.diagram } : null
    return ai.picture ? { kind: 'dsa', ...pictureSummary(ai.picture), json: ai.picture } : null
  }

  const content: LadderContent = {
    hints: hintUses.map(u => ai.hints?.[(u.level ?? 1) - 1]).filter((h): h is string => typeof h === 'string'),
    hintMoreCost: hintUses.length === 1 ? byName('hint').cost : null,
    picture: pictureBody(),
    video: byName('video').state === 'open' ? { links: videoLinks(ticket, pair), empty: NO_VIDEO } : null,
    solution: byName('solution').state === 'open' ? ai.solution ?? null : null,
  }
  const spentByRung = Object.fromEntries(RUNG_NAMES.map(n => [n, spentOn(uses, RUNG_OF[n])])) as Record<RungName, number>
  // ui-do D3.5: idle, running, paused or done (a run that reached 00:00 stays "done", with 00:00, until the next Start)
  const timerState = isPaused(mine) ? 'paused' : view.done || (mine?.running && view.expired) ? 'done' : !mine?.running ? 'idle' : 'running'
  const sessionCards = study.study
    ? study.study.cardIds.map(id => (id === ticket.id ? ticket : allTickets?.find(x => x.id === id))).filter((x): x is Ticket => !!x)
    : []
  /** the study session's Notes pad: its own field, apart from the Attempt log (UAT cu-4 P3-10) */
  const notesValue = draft.sessionNotes
  /** typing in any log field is a progress action for the study session's stuck check */
  const typed = (next: Draft) => {
    setDraft(next)
    if (study.active) study.mark()
  }
  const setNotes = (v: string) => typed({ ...draft, sessionNotes: v })
  const nextRung = rungs.find(r => r.state === 'unlocked' && r.name !== 'attempt')
  const stuckOpen = study.study?.stuck === true && !endOpen
  const outcomeDesc = [gateHint ? RUN_GATE_HINT_ID : '', study.active ? SESSION_NOTE_ID : ''].filter(Boolean).join(' ') || undefined

  const focusOn = study.study !== null && focusMode
  const stuckDialog = stuckOpen && (
    <StuckDialog
      noRung={nextRung ? null : noRungText(elapsedSec, byName('hint').state)}
      onNextRung={() => {
        study.dismissStuck()
        setFocusMode(false)
        if (!nextRung) return // the button is disabled then; the dialog already said why
        void openRung(nextRung.name).then(() =>
          requestAnimationFrame(() => document.querySelector(`[data-testid="ladder-rung-${nextRung.name}"]`)?.scrollIntoView?.({ block: 'center' })))
      }}
      onBreak={() => study.takeBreak(now())}
      onFine={study.dismissStuck}
    />
  )

  return (
    <>
    <div hidden={focusOn} style={focusOn ? { display: 'none' } : undefined}>
    <main className="do" data-testid="do-screen">
      <header className="do-rail" role="banner">
        <button type="button" className="do-back" data-testid="do-back" onClick={leave}>‹ Back</button>
        <span className="do-rail-title" title={ticket.title}>{ticket.title}</span>
        <span className="do-rail-meta">
          <span className="do-rail-sprint">S{ticket.sprint}</span>
          <SaveStatus />
          <span className="do-rail-xp" data-testid="do-ticket-xp" data-xp={ticket.xp}>Net {ticket.xp} xp</span>
          <span className="do-rail-timer" data-testid="timer-readout">{study.study ? sessionLabel(study.study, t) : view.mmss}</span>
        </span>
      </header>
      {/* ruling 24 S1: a running session stays in view here, on its own card too, with Pause and Resume (Do has no header strip; UAT cu-2p P3-6) */}
      <SessionDock />
      <div className="do-work">
      {redoSession && redoStage !== null && (
        <p className="redo-banner" role="status" data-testid="redo-banner" data-stage={redoStage}>{redoBannerText(redoStage)}</p>
      )}
      <div className="do-cols">
        <div className="do-left">
          <Panel title="Statement" className="statement">
            <h1 className="st-title" data-testid="do-title">{ticket.title}</h1>
            <div className="st-chips">
              {ticket.difficulty && <span className={`chip diff-${ticket.difficulty}`}>{DIFF[ticket.difficulty]}</span>}
              {lc && <span className="chip">LC {lc}</span>}
              {ticket.pattern && <span className="chip">{ticket.pattern}</span>}
              {ticket.links.map(l => <span key={`chip-${l.url}`} className="chip chip-src" title={l.label}>{shortSource(l.label)}</span>)}
            </div>
            {shownText(ticket.text) && <p className="st-text"><WithFileRefs text={shownText(ticket.text)} /></p>}
          </Panel>

          <CardBrief ticket={ticket} />
          {parent?.brief && partNo && <CardBrief ticket={parent} part={{ n: partNo, of: parent.children?.length ?? partNo, minutes: ticket.estMin }} />}
          {!ticket.brief && !parent?.brief && (
            <p className="brief-note" data-testid="no-brief">
              No brief yet. Draft briefs for this sprint from the Board.{signedOut ? ' Drafting needs Claude Code signed in.' : ''}
            </p>
          )}
          <SplitButton ticket={ticket} />
          {ticket.childOf && <p className="brief-note">Part of <Link to={`/do/${ticket.childOf}`}>the split card</Link></p>}

          <div className="open-row">
            {ticket.links.map(l => (
              <a
                key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="sr-btn sr-btn-accent open-link" title={l.label}
                onClick={() => { if (!mine?.running && !container) void start(mine?.min ?? 25, { silent: true }) }}
              >
                Open ▸ {l.label}
              </a>
            ))}
          </div>

          {/* UAT r5 P3 #3: a split card has no timer or outcomes of its own; it points to its sessions instead */}
          {container && <SessionList items={kids} />}
          {study.study ? (focusOn ? null : (
            <SessionPanel
              study={study.study} now={t} cards={sessionCards} elapsedSec={elapsedSec} notes={notesValue} onNotes={setNotes}
              onFocus={() => setFocusMode(true)} onEnd={() => setEndOpen(true)}
              onChime={on => { saveChimePref(on); study.setChime(on) }}
              onResume={() => resumeSession(now())}
            />
          )) : container ? null : (
          <Panel title="Timer" className="timer">
            <Button
              variant="accent" data-testid="start-session" disabled={cycle === null || gaveUp !== null}
              onClick={() => {
                if (isReadOnly()) toast(READ_ONLY_MESSAGE, 'danger')
                else if (!blockedFor({ kind: 'session' })) setPlanOpen(true)
              }}
            >
              Start session
            </Button>
            <div className="timer-row" {...tipProps('Block timer: counts down the 25 or 50 minute block you start here', 'right')}>
              <div className="blocks" aria-hidden="true">
                {Array.from({ length: 5 }, (_, i) => <span key={i} className="block" data-on={i < view.blocksOn ? 'true' : 'false'} />)}
              </div>
              <div className="timer-big" data-testid="timer-panel-readout">{view.mmss}</div>
            </div>
            <div className="timer-state" data-testid="timer-state">{timerState}</div>
            <span className="timer-elapsed" data-testid="do-timer-elapsed" data-seconds={elapsedSec} {...tipProps('This attempt: the total time you have put into this card in this attempt, across blocks', 'above')}>
              This attempt {pad2(Math.floor(elapsedSec / 60))}:{pad2(elapsedSec % 60)}
            </span>
            {mine?.running || isPaused(mine) ? (
              // ui-do D3.5 / _common 17: while running, Pause and a quiet Retreat replace the presets; paused, Resume
              <div className="timer-controls">
                {mine?.running
                  ? <Button data-testid="timer-pause" onClick={pause}><Sized label="Pause" alts={PAUSE_LABELS} /></Button>
                  : <Button data-testid="timer-resume" onClick={resume}><Sized label="Resume" alts={PAUSE_LABELS} /></Button>}
                <Button variant="quiet" onClick={retreat} aria-label={RETREAT_LABEL} {...tipProps(RETREAT_TITLE, 'right')}>Retreat</Button>
              </div>
            ) : (
              <div className="timer-controls">
                <Button data-testid="do-timer-preset-25" onClick={() => void start(25)}>Start 25 min</Button>
                <Button data-testid="do-timer-preset-50" onClick={() => void start(50)}>Start 50 min</Button>
                <label>
                  Custom minutes
                  <input
                    type="number" min={1} max={240} value={custom} data-testid="do-custom-minutes"
                    aria-invalid={customBad ? true : undefined} aria-describedby={customBad ? CUSTOM_ERROR_ID : undefined}
                    onChange={e => {
                      setCustom(e.target.value)
                      // a value that is out of range says so as it is typed; an empty field only on Start, a good one clears it
                      setCustomBad(e.target.value.trim() !== '' && customMinutes(e.target.value) === null)
                    }}
                  />
                </label>
                <Button
                  onClick={() => {
                    const m = customMinutes(custom)
                    setCustomBad(m === null)
                    if (m !== null) void start(m)
                  }}
                >
                  Start custom
                </Button>
              </div>
            )}
            {customBad && !(mine?.running || isPaused(mine)) && <p role="alert" className="form-error" id={CUSTOM_ERROR_ID} data-testid="do-custom-error">{CUSTOM_MINUTES_ERROR}</p>}
          </Panel>
          )}

          <SessionHistory sessions={allSessions ?? []} ticketId={ticket.id} />
          {replay && <RedoReplay picture={replay} title={displayTitle(ticket)} />}

          <Panel title="Attempt log" className="attempt-log">
            {isAi ? (
              <>
                <label>
                  Repo / commit URL
                  <input type="url" value={draft.repo} onChange={e => typed({ ...draft, repo: e.target.value })} />
                </label>
                <label>
                  Proof
                  <textarea value={draft.note} placeholder="What runs, what you measured" onChange={e => typed({ ...draft, note: e.target.value })} />
                </label>
              </>
            ) : (
              <label>
                What is the invariant? What did you try?
                <textarea data-testid="do-attempt-log" value={draft.notes} onChange={e => typed({ ...draft, notes: e.target.value })} />
              </label>
            )}
          </Panel>

        </div>

        {(ticket.kind === 'problem' || !container) && (
        <aside className="do-right">
          {ticket.kind === 'problem' && <ApproachStrip problemId={itemId} />}
          {/* ruling 21 (r6 P3 #1): a split card has no help ladder; help is spent on its parts */}
          {!container && (
          <Ladder
            title={displayTitle(ticket)} rungs={rungs} spent={spentOf(uses)} spentByRung={spentByRung} announce={announce}
            busy={busy} errors={errors} content={content} quizResult={quizResult}
            onOpen={n => void openRung(n)} onMoreHint={() => void openRung('hint', 2)} onRetry={n => void openRung(n, n === 'hint' && hintUses.length === 1 ? 2 : 1)}
            onCheckQuiz={a => void checkQuiz(a)} elapsedSec={elapsedSec}
          />
          )}
        </aside>
        )}
      </div>
      {/* ui-do D1: full-width workbench rows: B code, C trace (inside CodePanel's fragment), D outcomes */}
      {pack && (
        <CodePanel ticketId={ticket.id} onSubmitPassed={onSubmitPassed} />
      )}
      <div className="do-outcome-row">
      {container ? null : asking ? (
            <ApproachQuestion problemId={itemId} chosen={asking.chosen} onChoose={a => void choose(a)} onBack={() => navigate('/board')} />
          ) : (
            <div className="outcomes">
              <Button variant="accent" data-testid="do-outcome-solved" aria-describedby={outcomeDesc} disabled={outcomesLocked || used || runGate} onClick={() => void finish('solved')}>Solved ✓</Button>
              <Button data-testid="do-outcome-help" aria-pressed={used} aria-describedby={outcomeDesc} disabled={outcomesLocked || runGate} onClick={() => void finish('solved_help')}>Solved with help</Button>
              <Button variant="quiet" data-testid="do-outcome-giveup" aria-describedby={study.active ? SESSION_NOTE_ID : undefined} disabled={outcomesLocked} onClick={() => void finish('gave_up')}>Give up</Button>
            </div>
          )}
          {/* UAT cu-4 P3-11: while a study session runs, say that the outcome buttons end it too */}
          {!asking && !container && study.study && <p className="do-session-note" id={SESSION_NOTE_ID} data-testid="do-session-note">{sessionEndsNote(study.study.blocks)}</p>}
          {/* M6 / ui-do D7: why Solved is disabled on a pack ticket, on its own line below the buttons */}
          {!asking && gateHint && <p className="do-run-gate-hint" id={RUN_GATE_HINT_ID} data-testid="do-run-gate-hint">{RUN_GATE_HINT}</p>}
          {gaveUp && <p className="do-given-up" role="status" data-testid="do-given-up">{givenUpText(gaveUp.redoDue)}</p>}
      </div>
      </div>
    </main>
    </div>
    {focusOn && study.study && (
      <FocusView
        study={study.study} now={t} cards={sessionCards} notes={notesValue} onNotes={setNotes}
        onEnd={() => setEndOpen(true)} onExit={() => setFocusMode(false)}
      />
    )}
    {blocked && (
      <TimerBusyDialog
        kind={blocked.kind}
        title={allTickets?.find(x => x.id === blocked.id)?.title ?? blocked.id}
        startLabel={blocked.then.kind === 'session' ? 'Stop it and plan a session here' : `Stop it and start ${blocked.then.min} min here`}
        onStop={stopOtherThenGo}
        onGo={() => { const id = blocked.id; setBlocked(null); navigate(`/do/${id}`) }}
        onCancel={() => setBlocked(null)}
      />
    )}
    {planOpen && <PlanDialog ticket={ticket} chime={loadChimePref()} onStart={p => void startSession(p)} onCancel={() => setPlanOpen(false)} />}
    {endOpen && <EndLogDialog saving={savingEnd} onSave={l => void endSession(l)} onCancel={() => setEndOpen(false)} />}
    {stuckDialog}
    </>
  )
}
