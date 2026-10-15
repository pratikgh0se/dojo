import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDb } from '../../app/providers'
import { syncGate } from '../../data/db'
import { clearPending, PARTS, partHash, stashPending, type Part, type PendingDrawing } from '../../data/designPending'
import { flushThenLock, pauseDesignSession, resumeDesignSession, saveCanvas, saveNotes, saveView } from '../../data/designSessionActions'
import { safeWrite } from '../../data/safeWrite'
import type { DesignSession } from '../../data/types'
import { now } from '../../lib/clock'
import { useNow } from '../../lib/useNow'
import { normalizeCanvas, syncTableNodes, type KitCanvas as Canvas } from '../../rules/designCanvas'
import type { DesignNotes } from '../../rules/designDigest'
import { readDesignMode } from '../../rules/designMode'
import { normalizeNotes } from '../../rules/designNotes'
import type { PlanDesignRef } from '../../rules/designs'
import { interviewStage, isOverdue, lockReason, lockStatusText, pngName } from '../../rules/designSession'
import { useToast } from '../../ui/primitives'
import { CloseForm } from './CloseForm'
import { CloseSummary } from './CloseSummary'
import { DeepDiveList } from './DeepDiveList'
import { KeysHelp } from './KeysHelp'
import { KitCanvas } from './kit/KitCanvas'
import { NotesPanel } from './NotesPanel'
import { useNotesOpen } from './notesOpen'
import { RedesignDiff } from './RedesignDiff'
import { RightTabs } from './RightTabs'
import { ScoreForm } from './ScoreForm'
import { SessionFooter } from './SessionFooter'

type TabId = 'notes' | 'partner' | 'dives'

/**
 * A session in drawing, close or score. Locks itself at 45:00 (and on load when found later).
 * `push`/`flush` come from the parent's write queue (canvas, notes, Close, Score and the chat all share it) so the auto-lock,
 * CLOSE · DESIGN and the pagehide/visibility/unmount flush cover the last keystroke of every one of them.
 * `partnerPane` fills the Partner tab (the AI chat for ai-partner, the card controls for human-partner); without one the tab is empty.
 * While drawing the right column is three tabs; Close and Score replace the tabs (DESIGN-12) and the notes stay, read-only.
 */
export function LiveSession({
  item, session, push, flush, savedAt, partnerPane, dock, onAdvance, onEnd,
}: {
  item: PlanDesignRef; session: DesignSession; push: (job: () => Promise<unknown>, key?: string) => void; flush: () => Promise<void>
  /** when the last write landed (from the write queue); drives the Autosaved line */
  savedAt: number | null
  partnerPane?: ReactNode | ((ctl: { showNotes: () => void }) => ReactNode)
  /** Always in view at the top of the right column while drawing, whichever tab is open (the AI partner's chat: DESIGN-11, DESIGN-45 to DESIGN-52); beside the canvas from 1100 px, above the tabs below that */
  dock?: ReactNode
  /** The phase a button moves the session to, shown at once while `written` (the write that makes it real) is on its way */
  onAdvance?: (patch: Partial<DesignSession> & { phase: DesignSession['phase'] }, written: Promise<unknown>) => void
  /** CLOSE · DESIGN in the footer bar: end the drawing and lock the canvas */
  onEnd?: () => void
}) {
  const d = useDb()
  const toast = useToast()
  const t = useNow(1000)
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const mode = readDesignMode(session.mode)
  const [canvas, setCanvas] = useState(() => normalizeCanvas(session.canvas))
  const [notes, setNotes] = useState<DesignNotes>(() => normalizeNotes(session.notes))
  const [view, setView] = useState<'2d' | 'iso'>(session.view ?? '2d')
  const [tab, setTab] = useState<TabId>('notes')
  const [help, setHelp] = useState(false)
  const [swaps, setSwaps] = useState(0)
  const [pauseBusy, setPauseBusy] = useState(false)
  const accordion = useNotesOpen(session.id)
  const openRequirements = accordion.ensure
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas
  const notesRef = useRef(notes)
  notesRef.current = notes
  const viewRef = useRef(view)
  viewRef.current = view
  const sessionRef = useRef(session)
  sessionRef.current = session

  // Which parts the user has changed and the queue has not yet written (the stash carries only those), the stored values this
  // window started from or wrote (so a later load can tell a newer row from another window), and the stored value at mount.
  const mountRef = useRef<Record<Part, unknown>>({ notes: session.notes, canvas: session.canvas, view: session.view })
  const unsaved = useRef<Record<Part, boolean>>({ notes: false, canvas: false, view: false })
  const seq = useRef<Record<Part, number>>({ notes: 0, canvas: 0, view: 0 })
  const written = useRef<Record<Part, string[]>>({ notes: [], canvas: [], view: [] })
  // The newest stash this window made, so whichever write finishes the queue last can remove it (see pushPart).
  const stashNonce = useRef<string | null>(null)

  // Queue a write of one part and keep track of whether it has landed. Only the newest queued write of a part clears its flag;
  // a write that failed leaves it set. Nothing is hashed per keystroke: a job hashes its snapshot when it starts (coalesced
  // snapshots never start).
  const pushPart = useCallback((part: Part, value: unknown, write: () => Promise<unknown>, qkey?: string) => {
    const n = ++seq.current[part]
    unsaved.current[part] = true
    push(async () => {
      written.current[part] = [...written.current[part], partHash(value)].slice(-4)
      const r = await write()
      if (seq.current[part] === n) unsaved.current[part] = false
      // Everything has landed: the stash is spent. Left in place it could be re-applied after the user types a part back to its mount value (ABA).
      if (stashNonce.current && !PARTS.some(p => unsaved.current[p])) {
        clearPending(sessionRef.current.id, stashNonce.current)
        stashNonce.current = null
      }
      return r
    }, qkey)
  }, [push])

  // A page that is going away cannot finish an IndexedDB read-modify-write: stash the parts that are still unsaved, synchronously
  // (the next load applies them if the row is still what they started from, designPending). An untouched session, a read-only
  // browser and a discarded session stash nothing. When the page survives (tab hidden, route kept) the queue drains as usual and
  // the stash is removed once everything has landed.
  useEffect(() => {
    const stash = () => {
      if (syncGate.readOnly) return
      const s = sessionRef.current
      if (s.phase !== 'drawing') return
      const snap: Omit<PendingDrawing, 'nonce'> = { known: {} }
      const value: Record<Part, unknown> = { notes: notesRef.current, canvas: canvasRef.current, view: viewRef.current }
      for (const part of PARTS) {
        if (!unsaved.current[part]) continue
        Object.assign(snap, { [part]: value[part] })
        snap.known[part] = [partHash(mountRef.current[part]), ...written.current[part]]
      }
      if (!PARTS.some(part => unsaved.current[part])) return
      const nonce = stashPending(s.id, snap)
      if (nonce) {
        stashNonce.current = nonce
        void flush().then(() => {
          if (PARTS.some(part => unsaved.current[part])) return
          clearPending(s.id, nonce)
          if (stashNonce.current === nonce) stashNonce.current = null
        })
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') stash() }
    window.addEventListener('pagehide', stash)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', stash)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush])

  // The 45:00 auto-lock (DESIGN-17). A window whose writes are refused (read-only browser, or data from a newer model, DESIGN-79)
  // does nothing here: the lock cannot land, and retrying it every second would toast every second. The lock is also tried once
  // per session: a failed attempt is not repeated on every tick, only when another session is opened.
  const writesRefused = !!(syncGate.readOnly || syncGate.modelLocked)
  const lockTried = useRef<string | null>(null)
  useEffect(() => {
    if (writesRefused || !isOverdue(session, t) || lockTried.current === session.id) return
    lockTried.current = session.id
    void safeWrite(() => flushThenLock(d, session.id, t, flush), onError)
  }, [d, session, t, onError, flush, writesRefused])

  const change = useCallback((next: Canvas) => {
    canvasRef.current = next
    setCanvas(next)
    pushPart('canvas', next, () => saveCanvas(d, session.id, next), `canvas:${session.id}`)
  }, [d, pushPart, session.id])

  // No debounce: every change is queued as it is made, so the queue (and the flush before a lock) always holds the latest text.
  // The queue coalesces by key (latest snapshot wins): a burst of keystrokes is one running plus one pending write, not one each.
  // A notes change may rename or orphan a table block: write the notes first, then the canvas if it moved.
  const changeNotes = useCallback((next: DesignNotes) => {
    notesRef.current = next
    setNotes(next)
    pushPart('notes', next, () => saveNotes(d, session.id, next), `notes:${session.id}`)
    const synced = syncTableNodes(canvasRef.current, next)
    if (synced !== canvasRef.current) change(synced)
  }, [d, pushPart, session.id, change])

  const changeView = useCallback((v: '2d' | 'iso') => {
    viewRef.current = v
    setView(v)
    pushPart('view', v, () => saveView(d, session.id, v))
  }, [d, pushPart, session.id])

  const showNotes = useCallback(() => setTab('notes'), [])
  const focusCanvas = useCallback(() => bodyRef.current?.querySelector<HTMLElement>('[data-focus-zone="canvas"]')?.focus(), [])

  // Ctrl/Cmd+. swaps focus between the canvas and the notes (DESIGN-42).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '.') return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      e.preventDefault()
      if (document.activeElement?.closest('[data-focus-zone="notes"]')) { focusCanvas(); return }
      setTab('notes')
      openRequirements('requirements') // the first box is in Requirements: a closed section would not take the focus
      setSwaps(n => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusCanvas, openRequirements])

  // Focus the first notes box once the Notes panel is showing (not on a frame timer: a throttled frame would let keys fall through to the canvas).
  useEffect(() => {
    if (swaps > 0) bodyRef.current?.querySelector<HTMLElement>('[data-focus-zone="notes"] [data-focus-first]')?.focus()
  }, [swaps])

  const reason = lockReason(session)
  const inDrawing = session.phase === 'drawing'
  // An overdue session in a window that cannot write the lock renders as locked: its time is up, whatever the stored phase says.
  const drawing = inDrawing && !(writesRefused && isOverdue(session, t))
  // Paused (F2): the clock is stopped and canvas, notes, schema and chat are read-only; Close · Design and Discard still work
  const paused = inDrawing && session.pausedAt != null
  const readOnly = !drawing || paused
  const togglePause = () => {
    if (pauseBusy) return
    const at = now()
    const act = paused ? resumeDesignSession : pauseDesignSession
    setPauseBusy(true)
    void safeWrite(async () => { await flush(); return act(d, session.id, at) }, onError).finally(() => setPauseBusy(false))
  }
  const stage = mode === 'ai-partner' && session.interview ? interviewStage(session.interview.messages) : null
  const linked = useMemo(() => new Set(canvas.nodes.flatMap(n => (n.kind === 'table' && n.schemaId ? [n.schemaId] : []))), [canvas.nodes])
  const notesPanel = <NotesPanel notes={notes} locked={readOnly} allOpen={!inDrawing} accordion={accordion} linkedIds={linked} onChange={changeNotes} onEscape={focusCanvas} />
  const tabs: { id: TabId; label: string }[] = [
    { id: 'notes', label: 'Notes' }, ...(mode === 'solo' ? [] : [{ id: 'partner' as const, label: 'Partner' }]), { id: 'dives', label: 'Deep dives' },
  ]

  return (
    <>
    <div className="ds-body" ref={bodyRef}>
      <div className="ds-left">
        {reason && <p role="status" className="ds-locked">{lockStatusText(reason)}</p>}
        {paused && <p role="status" className="ds-paused" data-testid="session-paused">Paused. The clock is stopped.</p>}
        <KitCanvas
          canvas={canvas} notes={notes} view={view} locked={readOnly} exportName={pngName(item.id, session.at)}
          onChange={change} onNotes={changeNotes} onView={changeView} onHelp={() => setHelp(true)}
        />
        {session.redesignOf && <RedesignDiff earlierId={session.redesignOf} />}
      </div>
      <div className="ds-right">
        {inDrawing && dock}
        {inDrawing && (
          <RightTabs
            tabs={tabs} active={tabs.some(x => x.id === tab) ? tab : 'notes'} onChange={id => setTab(id as TabId)}
            panels={{
              notes: notesPanel,
              partner: typeof partnerPane === 'function' ? partnerPane({ showNotes }) : partnerPane ?? null,
              dives: <DeepDiveList dives={item.deepDives} active={stage?.activeDive ?? 0} />,
            }}
          />
        )}
        {/* Close and Score replace the tabs (DESIGN-12): the form first, the read-only notes below it */}
        {session.phase === 'close' && <><CloseForm item={item} session={session} push={push} flush={flush} onAdvance={onAdvance} />{notesPanel}</>}
        {session.phase === 'score' && (
          <>
            <CloseSummary close={session.close} dives={item.deepDives} />
            <ScoreForm item={item} session={session} push={push} flush={flush} />
            {notesPanel}
          </>
        )}
      </div>
      {help && <KeysHelp onClose={() => setHelp(false)} />}
    </div>
    {inDrawing && <SessionFooter mode={session.mode} savedAt={savedAt} paused={paused} busy={pauseBusy} onTogglePause={togglePause} onEnd={onEnd ?? (() => {})} />}
    </>
  )
}
