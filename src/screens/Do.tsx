import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useScreenKeys } from '../app/legend'
import { Screen } from '../app/Screen'
import { useDb, usePlan } from '../app/providers'
import { buildJobRequest, type DiagramJson, type JobContext, type JobName, type SolutionOutput, type SrAlgoJson } from '../ai/types'
import { approachesFor } from '../content/approaches'
import { callJob } from '../data/aiActions'
import { setSessionApproach } from '../data/atlasActions'
import { useDoQuery, useSessions, useSettings, useTicket, useTickets } from '../data/hooks'
import { closeLadderSession, markUnderstood, recordRung, type RungOutput } from '../data/ladderActions'
import { safeWrite } from '../data/safeWrite'
import type { EndLog, HelpRung, Kind, Outcome, Redo, RungUse, Ticket } from '../data/types'
import { playChime } from '../lib/chime'
import { now } from '../lib/clock'
import { appRoute } from '../lib/appLinks'
import {
  bankRun, clearCycle, cycleElapsedMs, gaveUpFor, isStaleEmpty, loadCycle, newCycle, saveCycle, saveGaveUp,
  type Cycle, type GaveUp,
} from '../lib/cycle'
import { localDayKey, pad2 } from '../lib/dates'
import { clearDraft, closingNotes, isEmptyDraft, loadDraft, saveDraft, type Draft } from '../lib/drafts'
import { isActivatable, isPlainKey, isStrayBackgroundKey, isTypingTarget } from '../lib/keys'
import { clearStudy, loadChimePref, loadStudy, notifyStudy, subscribeStudy } from '../lib/studyStore'
import { clearTimer, loadTimer, saveTimer, sessionLabel, timerView, type TimerState } from '../lib/timer'
import { IDLE_TICK_MS, useSecondsNow } from '../lib/useNow'
import { shortSource } from '../rules/board'
import {
  announceText, helpUsed, HINT_UNLOCK_SECONDS, ladderView, newlyUnlocked, RUNG_NAMES, RUNG_OF, spentOf, spentOn, type RungName, type RungView,
} from '../rules/ladderView'
import { displayTitle, dueMs, givenUpText, isRedoDue, outcomeFeedback, redoBannerText } from '../rules/redoQueue'
import {
  aiTicketOf, designDeepDives, diagramSummary, NO_VIDEO, NO_WATCH_LINK, pairedWatchId,
  pictureSummary, QUIZ_PASS, quizResultText, quizScore, taskPictureLinks, videoLinks,
} from '../rules/rungContent'
import { shownText } from '../rules/ticketText'
import { CardBrief } from './brief/CardBrief'
import { ApproachQuestion, ApproachStrip } from '../ui/algo/ApproachStrip'
import { useLeaveDo } from '../app/origin'
import { verbObject } from '../rules/ticketMeta'
import { sessionMinutesOf } from '../rules/prefs'
import type { Study } from '../rules/studySession'
import { pauseSession, resumeSession } from '../study/controls'
import { SessionDock } from '../study/SessionPill'
import { useStartTicket } from '../study/useStartTicket'
import { TicketFacts } from './do/kinds/TicketFacts'
import { TicketMissing } from './do/kinds/TicketMissing'
import { TicketTimer } from './do/kinds/TicketTimer'
import { TicketView } from './do/kinds/TicketView'
import { BlockedNote } from './do/BlockedNote'
import { Glyph } from '../ui/Glyph'
import type { AiFailure } from '../ui/ai/AiStates'
import { Button, Panel, useFlash, usePowerUp, useToast } from '../ui/primitives'
import { Ladder, type LadderContent, type PictureBody } from './do/Ladder'
import { EndLogDialog } from './do/study/EndLogDialog'
import { SessionHistory } from './do/study/SessionHistory'
import { FocusView } from './do/study/FocusView'
import { SessionPanel } from './do/study/SessionPanel'
import { StuckDialog } from './do/study/StuckDialog'
import { finishStudy, focusMinutesOf } from '../study/runner'
import { useStudyFor } from '../study/useStudy'
import { isReadOnly } from '../data/writer'
import { RedoReplay, replayPicture } from './do/RedoReplay'
import { CodePanel } from '../runner/CodePanel'
import { hasPack } from '../runner/client'
import { usePassGate } from '../runner/gate'
import './do.css'
import './do/ticket.css'
import { Loading } from '../ui/Loading'
import { WithFileRefs } from '../ui/FileRefs'

const SESSION_NOTE_ID = 'do-session-ends-note'
const blocksText = (n: number) => `${n} focus block${n === 1 ? '' : 's'}`
/** What a closed session says it recorded: a single session its focus minutes, an older multi-block one its blocks. */
export const focusDoneText = (s: Study, nowMs: number): string => (s.single ? `${focusMinutesOf(s, nowMs)} min focus` : blocksText(s.blocks))
/** UAT cu-4 P3-11: said before the click, while a study session runs, and again after it: finishing the card ends the session too. */
/** UAT cu-4 P3-5: the Stuck? prompt's reason for having no help rung to open, with the minutes the Hint still needs when that is the reason. */
export function noRungText(elapsedSec: number, hint: RungView['state']): string {
  if (hint === 'locked' && elapsedSec < HINT_UNLOCK_SECONDS) {
    const min = Math.ceil((HINT_UNLOCK_SECONDS - elapsedSec) / 60)
    return `No help rung is unlocked yet: the Hint opens after 10 minutes on this attempt (${min} min to go).`
  }
  return 'No help rung is unlocked yet.'
}
export const sessionEndsNote = (s: Study, nowMs: number) =>
  `Solved, Solved with help and Give up also end your session (${focusDoneText(s, nowMs)} so far). It stays under Earlier sessions.`

const DIFF: Record<string, string> = { E: 'Easy', M: 'Medium', H: 'Hard' }

export function Do() {
  const { ticketId = '' } = useParams()
  const q = useDoQuery(ticketId)
  // RIT-69: the `screen-do` root is drawn together with the ticket (never as an empty shell), so a read right after the URL changes sees the title
  if (q === undefined) return <Loading />
  const { ticket, redo, uses } = q
  if (ticket === null || ticket.archived) return <Screen name="do"><TicketMissing /></Screen>
  if (ticket.kind === 'problem' || ticket.kind === 'stage') return <Screen name="do"><DoScreen key={ticket.id} ticket={ticket} redo={redo} allUses={uses} /></Screen>
  return <Screen name="do"><TicketView key={ticket.id} ticket={ticket} /></Screen>
}

interface CycleState { cycle: Cycle | null; gaveUp: GaveUp | null }

/** C-LADDER §2.2/§2.4: resume the cycle, or start one (a redo session when the redo is due right now). */
function initialCycle(ticket: Ticket, redo: Redo | null, allUses: RungUse[], t: number): CycleState {
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
  const startTicket = useStartTicket()
  const readOnly = isReadOnly()
  useScreenKeys(['F focus mode', 'D mark solved', 'Space start or pause'])
  const { fire: powerUp } = usePowerUp()
  const [{ cycle, gaveUp }, setCycleState] = useState<CycleState>(() => initialCycle(ticket, redo, allUses, now()))
  const [timer, setTimer] = useState<TimerState | null>(() => loadTimer())
  const [draft, setDraft] = useState<Draft>(() => loadDraft(ticket.id))
  const [busy, setBusy] = useState<RungName | null>(null)
  const [errors, setErrors] = useState<Partial<Record<RungName, AiFailure>>>({})
  const [announce, setAnnounce] = useState('')
  const [quizResult, setQuizResult] = useState<string | null>(null)
  const openLock = useRef(false)
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
  const study = useStudyFor(ticket.id)
  // ticks on the study session's own seconds (anchored at its phase start), so the header reading is not a second late after Start (TICKET-03)
  const t = useSecondsNow(study.study?.phaseStart, timer?.running ? 1000 : IDLE_TICK_MS)
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
  const itemId = ticket.id
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
  // a finished problem with no redo due offers no way to finish it again (TICKET-05); a read-only browser writes nothing (SHELL-23)
  const finished = ticket.status === 'done' && !(redo !== null && isRedoDue(redo, t))
  const outcomesLocked = cycle === null || gaveUp !== null || readOnly || finished
  // TICKET-25/26: Solved is available from the moment the ticket is started. A pack ticket's Submit is a self-check the learner runs,
  // not a gate (the C-RUNNER §4 "Submit 5/5 to unlock Solved" gate is gone); the pass is still recorded for the attempt.
  const pack = hasPack(ticket.id)
  const { onSubmitPassed } = usePassGate(ticket.id, cycleId)
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
      powerUp(undefined, false) // a timer end grants no XP
      if (loadChimePref()) playChime() // a run that ends unseen is still heard (the same soft chime as a session's block)
      toast(`Power up · ${mine.min} min`)
    }
  }, [mine, view.expired, study.active, flash, powerUp, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const fx = { chime: () => {}, toast, onError }

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
    if (openLock.current || asking || readOnly) return
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
    const t0 = now()
    const tm = loadTimer()
    const banked = bankRun(cycle, tm && tm.ticketId === ticket.id ? tm : null, t0)
    // A stopped timer's sessionStart can be stale (an abandoned timer); trust it only while running or same-day (N1).
    const sessionStart = mine && (mine.running || localDayKey(mine.sessionStart) === localDayKey(t0)) ? mine.sessionStart : t0
    const r = await safeWrite(
      () => closeLadderSession(d, {
        ticketId: ticket.id, outcome, attemptStart: cycle.attemptStart, cycleId: cycle.id, sessionStart, now: t0,
        netAtStart: cycle.netAtStart, redoId: cycle.redoId,
        notes: closingNotes(draft, isAi),
        proof: isAi ? { repo: draft.repo, note: draft.note } : undefined,
        ...(study.study ? { goal: study.study.goal, focusMinutes: focusMinutesOf(study.study, t0) } : {}),
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
    if (study.study) {
      const ended = study.study
      clearStudy()
      notifyStudy()
      setFocusMode(false)
      toast(ended.single ? `Session ended · ${focusMinutesOf(ended, t0)} min focus` : `Study session ended with the card · ${blocksText(ended.blocks)}`)
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
      navigate('/')
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

  /** The d key is the outcome button that is enabled: Solved, or Solved with help once help was used. */
  function doneKey() {
    if (outcomesLocked) return
    void finish(used ? 'solved_help' : 'solved')
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
    // ruling 23 K1: d marks the card done (a learning card opens its check)
    if (e.key === 'd' && !stray && isPlainKey(e) && !e.repeat && !asking && !isTypingTarget(e.target)) {
      e.preventDefault()
      doneKey()
      return
    }
    // space starts the session, then pauses and resumes it (one timer: the session's)
    if (e.key === ' ' && !stray && !asking && !isTypingTarget(e.target) && !isActivatable(e.target)) {
      e.preventDefault()
      // a finished problem with no redo due has nothing to start, pause or resume (TICKET-05); a redo due makes it unfinished (REVIEW-14)
      if (finished) return
      if (study.study && !study.study.over) {
        if (study.study.paused != null) resumeSession(now())
        else pauseSession(now())
      } else if (!study.study && cycle !== null && gaveUp === null && !readOnly) void startTicket(ticket)
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
  // the one reading of the header: the session's clock, or the length a Start would run
  const idleReading = study.study ? sessionLabel(study.study, t) : ticket.status === 'done' ? '--:--' : `${pad2(sessionMinutesOf(settings))}:00`
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
  const outcomeDesc = study.active ? SESSION_NOTE_ID : undefined

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
      <header className="do-rail" role="group" aria-label="Ticket">
        <button type="button" className="do-back" data-testid="do-back" onClick={leave}><Glyph name="chevronL" /> Back</button>
        <span className="do-rail-title" data-content="plan" title={ticket.title}>{ticket.title}</span>
        <span className="do-rail-meta">
          <TicketFacts ticket={ticket}>
            <span className="do-rail-xp" data-testid="do-ticket-xp" data-xp={ticket.xp}>Net {ticket.xp} xp</span>
          </TicketFacts>
          {/* the save state is the shell header's: one save-status per page (GLOBAL-10) */}
          {/* the one visible timer reading (TICKET-08): the sticky rail's, so it stays in view beside the code; the session hook rides on it while one runs */}
          {study.study && !focusOn ? (
            <span className="do-rail-timer" data-testid="session-timer" role="timer"><span data-testid="timer-readout">{idleReading}</span></span>
          ) : (
            <span className="do-rail-timer" data-testid="timer-readout">{idleReading}</span>
          )}
        </span>
      </header>
      {/* a session running on ANOTHER ticket stays one click away; on its own ticket the one timer below is the control */}
      {study.other && <SessionDock />}
      <div className="do-work">
      {redoSession && redoStage !== null && (
        <p className="redo-banner" role="status" data-testid="redo-banner" data-stage={redoStage}>{redoBannerText(redoStage)}</p>
      )}
      <div className="do-cols">
        <div className="do-left">
          <Panel title="Statement" className="statement">
            <h1 className="st-title" data-testid="do-title" data-content="plan">{ticket.title}</h1>
            <BlockedNote ticket={ticket} className="st-text" />
            <div className="st-chips">
              {ticket.difficulty && <span className={`chip diff-${ticket.difficulty}`}>{DIFF[ticket.difficulty]}</span>}
              {lc && <span className="chip">LC {lc}</span>}
              {ticket.pattern && <span className="chip" data-content="plan">{ticket.pattern}</span>}
              {ticket.links.map(l => <span key={`chip-${l.url}`} className="chip chip-src" data-content="plan" title={l.label}>{shortSource(l.label)}</span>)}
            </div>
            {shownText(ticket.text) && <p className="st-text" data-content="plan"><WithFileRefs text={shownText(ticket.text)} /></p>}
          </Panel>

          <CardBrief ticket={ticket} />
          {!ticket.brief && (
            <p className="brief-note" data-testid="no-brief">
              No brief for this ticket yet.
            </p>
          )}

          <div className="open-row">
            {ticket.links.map(l => {
              const route = appRoute(l.url)
              // An in-app link (#bank, ...) opens that screen. No Open link starts anything: Start is the one way to begin.
              if (route) return <Link key={l.url} to={route} className="sr-btn open-link" title={l.label}>Open · <span data-content="plan">{l.label}</span></Link>
              return (
                <a
                  key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="sr-btn open-link" title={l.label}>
                  Open · <span data-content="plan">{l.label}</span>
                </a>
              )
            })}
          </div>

          {study.study ? (focusOn ? null : (
            <TicketTimer
              ticket={ticket} showReadout={false} withEnd={false}
              trailing={<Button variant="quiet" data-testid="session-end" onClick={() => setEndOpen(true)}>End session</Button>}
            >
              <SessionPanel study={study.study} cards={sessionCards} elapsedSec={elapsedSec} />
            </TicketTimer>
          )) : (
            <TicketTimer ticket={ticket} showReadout={false}>
              {/* the one accent before the start; none once it is finished, given up on or still being set up */}
              {finished ? (
                <span className="dk-done" data-testid="ticket-done-state"><Glyph name="check" size={3} /> Done.</span>
              ) : cycle !== null && gaveUp === null ? (
                <Button variant="accent" data-accent="primary" data-testid="ticket-start" disabled={readOnly} onClick={() => void startTicket(ticket)}>
                  {verbObject('START', 'problem')}
                </Button>
              ) : null}
              <span className="timer-elapsed" data-testid="do-timer-elapsed" data-seconds={elapsedSec}>
                This attempt {pad2(Math.floor(elapsedSec / 60))}:{pad2(elapsedSec % 60)}
              </span>
            </TicketTimer>
          )}

          <SessionHistory sessions={allSessions ?? []} ticketId={ticket.id} />
          {replay && <RedoReplay picture={replay} title={displayTitle(ticket)} />}

          <Panel title="Attempt log" className="attempt-log">
            {isAi ? (
              <>
                <label>
                  Repo / commit URL
                  <input type="url" disabled={readOnly} value={draft.repo} onChange={e => typed({ ...draft, repo: e.target.value })} />
                </label>
                <label>
                  Proof
                  <textarea disabled={readOnly} value={draft.note} placeholder="What runs, what you measured" onChange={e => typed({ ...draft, note: e.target.value })} />
                </label>
              </>
            ) : (
              <label>
                What is the invariant? What did you try?
                <textarea data-testid="do-attempt-log" disabled={readOnly} value={draft.notes} onChange={e => typed({ ...draft, notes: e.target.value })} />
              </label>
            )}
          </Panel>

        </div>

        <aside className="do-right">
          {ticket.kind === 'problem' && <ApproachStrip problemId={itemId} />}
          <Ladder
            title={displayTitle(ticket)} rungs={rungs} readOnly={readOnly} spent={spentOf(uses)} spentByRung={spentByRung} announce={announce}
            busy={busy} errors={errors} content={content} quizResult={quizResult}
            onOpen={n => void openRung(n)} onMoreHint={() => void openRung('hint', 2)} onRetry={n => void openRung(n, n === 'hint' && hintUses.length === 1 ? 2 : 1)}
            onCheckQuiz={a => void checkQuiz(a)} elapsedSec={elapsedSec}
          />
        </aside>
      </div>
      {/* ui-do D1: full-width workbench rows: B code, C trace (inside CodePanel's fragment), D outcomes */}
      {pack && (
        <CodePanel ticketId={ticket.id} onSubmitPassed={onSubmitPassed} />
      )}
      <div className="do-outcome-row">
      {asking ? (
            <ApproachQuestion problemId={itemId} chosen={asking.chosen} onChoose={a => void choose(a)} onBack={leave} />
          ) : (
            <div className="outcomes">
              <Button data-testid="do-outcome-solved" aria-describedby={outcomeDesc} disabled={outcomesLocked || used} onClick={() => void finish('solved')}>Solved</Button>
              <Button data-testid="do-outcome-help" aria-pressed={used} aria-describedby={outcomeDesc} disabled={outcomesLocked} onClick={() => void finish('solved_help')}>Solved with help</Button>
              <Button variant="quiet" data-testid="do-outcome-giveup" aria-describedby={study.active ? SESSION_NOTE_ID : undefined} disabled={outcomesLocked} onClick={() => void finish('gave_up')}>Give up</Button>
            </div>
          )}
          {/* UAT cu-4 P3-11: while a study session runs, say that the outcome buttons end it too */}
          {!asking && study.study && <p className="do-session-note" id={SESSION_NOTE_ID} data-testid="do-session-note">{sessionEndsNote(study.study, t)}</p>}
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
    {endOpen && <EndLogDialog saving={savingEnd} onSave={l => void endSession(l)} onCancel={() => setEndOpen(false)} />}
    {stuckDialog}
    </>
  )
}
