import { useCallback, useEffect, useRef, useState } from 'react'
import { canHint, HINT_MAX, hintsUsed, messageTopics } from '../../ai/coachPlan'
import { TRANSCRIPT_TEXT_MAX } from '../../ai/prompts'
import { useDb } from '../../app/providers'
import { syncGate } from '../../data/db'
import { appendInterview } from '../../data/designSessionActions'
import type { DesignSession, InterviewMessage } from '../../data/types'
import { DIGEST_TURN_MAX } from '../../rules/designDigest'
import type { PlanDesignRef } from '../../rules/designs'
import { interviewStage, needsInterviewerTurn } from '../../rules/designSession'
import { Button } from '../../ui/primitives'
import { BlockLoader } from './BlockLoader'
import { askInterviewer, freshDigest, learnerWords, once, thrownMessage } from './designAi'

/** `follow`: the live panel keeps the newest message in view; a finished conversation is read from the top. */
export function TranscriptLog({ messages, follow = false }: { messages: InterviewMessage[]; follow?: boolean }) {
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = log.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, messages.length])
  // GLOBAL-01: the AI's words are shown without the stored job name; the stored transcript stays as the model wrote it
  // the topic of each AI message comes from the coach plan (answers given so far), never from a label; a hint takes the question it sharpens
  const topics = messageTopics(messages)
  return (
    <div ref={log} role="log" aria-label="Conversation" className="ds-log" tabIndex={0}>
      {messages.map((m, i) => {
        const ai = m.from === 'interviewer'
        return (
          <div
            key={i} className={`ds-msg ds-msg-${ai ? 'ai' : 'you'}`} data-testid="session-msg" data-from={ai ? 'ai' : 'you'}
            {...(ai ? { 'data-topic': topics[i] ?? 'requirements', 'data-kind': m.hint ? 'hint' : 'turn' } : { 'data-content': 'learner' })}
          >
            <span className="ds-msg-label" data-testid="session-msg-label">{ai ? 'AI partner' : 'You'}</span>
            <span className="ds-msg-text" data-testid="session-msg-text">{ai ? learnerWords(m.text) : m.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** The Partner tab of an AI-partner session. The conversation itself sits under the canvas (so it is in view whichever tab is open); this tab says how it works. */
export function AiPartnerNote({ session }: { session: DesignSession }) {
  const left = HINT_MAX - hintsUsed(session.interview?.messages ?? [])
  return (
    <div className="ptt" data-testid="session-partner-note">
      <p className="ptt-lead">Your AI partner asks one question at a time and never gives the answer. The conversation is above these tabs, next to your drawing.</p>
      <p className="ptt-note">Hint asks a sharper question instead of answering: {left} left.</p>
    </div>
  )
}

/**
 * The thinking coach (amendment A1): it speaks first, asks one question a turn, never offers options or an answer, and a Hint
 * asks a sharper question (at most three). The chat is open-ended. A failed call stores nothing and shows a sentence with Retry.
 */
export function AiPartnerPanel({ item, session, flush }: { item: PlanDesignRef; session: DesignSession; flush: () => Promise<void> }) {
  const d = useDb()
  const messages = session.interview?.messages ?? []
  const stage = interviewStage(messages)
  const locked = session.phase !== 'drawing' || session.pausedAt != null // a pause makes the chat read-only too (F2)
  const writesRefused = !!(syncGate.readOnly || syncGate.modelLocked) // a refused write means no AI call: the reply could not be stored
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const retrySend = useRef(false) // the failure to retry is the learner's own message, still in the box
  const box = useRef<HTMLTextAreaElement>(null)

  /** One AI call: flush queued notes, read the stored design, ask, store the reply. A failure stores nothing (so a failed Hint costs none of the three).
   * A write that throws (quota, IndexedDB, read-only) is the same sentence with Retry, and the panel never stays busy. */
  const run = useCallback(async (key: string, msgs: InterviewMessage[], hint: boolean) => {
    if (syncGate.readOnly || syncGate.modelLocked) return
    setBusy(true)
    setError('')
    retrySend.current = false
    try {
      const r = await once(key, async () => {
        await flush()
        if (!(await d.designSessions.get(session.id))) return { ok: false as const, error: 'The session is gone.' } // never ask for a reply that cannot be stored
        const design = await freshDigest(d, session.id, DIGEST_TURN_MAX)
        const res = await askInterviewer(d, item, msgs, { hint, design })
        if (res.ok) await appendInterview(d, session.id, [{ from: 'interviewer', text: res.value, ...(hint ? { hint: true as const } : {}) }])
        return res
      })
      if (!r.ok) setError(r.error)
    } catch (e) {
      setError(thrownMessage(e, 'turn'))
    } finally {
      setBusy(false)
    }
  }, [d, flush, item, session.id])

  const ask = useCallback((msgs: InterviewMessage[]) => run(`interview:${session.id}:${msgs.filter(m => m.from === 'you').length}`, msgs, false), [run, session.id])
  const hint = () => run(`hint:${session.id}:${hintsUsed(messages)}`, messages, true)

  // The AI speaks first: turn 0 only when the conversation is empty; a reload never asks by itself otherwise.
  // A read-only browser cannot store the reply and the AI is for the writer only (DESIGN-79): it never asks by itself.
  // The model gate (a newer Dojo owns the database) refuses writes the same way, so it never asks either.
  useEffect(() => {
    if (!locked && messages.length === 0 && !writesRefused) void ask([])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!text.trim() || sending.current || locked || busy || writesRefused) return
    sending.current = true
    try {
      const said = text
      setError('')
      retrySend.current = false
      let ok: boolean
      try {
        ok = await appendInterview(d, session.id, [{ from: 'you', text: said }])
      } catch (e) {
        retrySend.current = true // nothing was stored: the words stay in the box and Retry sends them again
        setError(thrownMessage(e, 'turn'))
        return
      }
      if (!ok) return // refused (the canvas locked meanwhile): the words stay in the box
      setText('')
      box.current?.focus()
      await ask([...messages, { from: 'you', text: said }])
    } finally {
      sending.current = false
    }
  }

  // After a failure: nothing yet -> the opening; the learner spoke last -> the reply; the AI spoke last -> the Hint that failed.
  const retry = () => void (retrySend.current ? send() : messages.length === 0 ? ask([]) : needsInterviewerTurn(messages) ? ask(messages) : hint())
  const askAgain = !locked && !writesRefused && !busy && !error && messages.length > 0 && needsInterviewerTurn(messages)
  const left = HINT_MAX - hintsUsed(messages)

  return (
    <section className="ds-partner" data-testid="session-interviewer" aria-label="AI partner" data-phase={stage.phase} data-no-global-keys="">
      <TranscriptLog messages={messages} follow />
      {busy && <BlockLoader label="The AI partner is thinking" testId="ai-loader" />}
      {error && (
        <p className="ds-ai-error" data-testid="session-ai-error">
          {error} <Button data-testid="ai-retry" onClick={retry}>Retry</Button>
        </p>
      )}
      {askAgain && <Button onClick={() => void ask(messages)}>Ask again</Button>}
      <textarea
        ref={box} className="ds-answer" data-testid="session-chat-input" aria-label="Your answer" rows={2} value={text} readOnly={locked}
        maxLength={TRANSCRIPT_TEXT_MAX} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send() } }}
      />
      <div className="ds-chat-foot">
        <p className="ds-istatus" data-testid="session-interview-status">{stage.status}</p>
        <div className="ds-chat-actions">
          <Button data-testid="session-hint" disabled={busy || writesRefused || !canHint(messages, locked)} onClick={() => void hint()}>Hint ({left} left)</Button>
          <Button data-testid="session-send" disabled={locked || busy || writesRefused || !text.trim()} onClick={() => void send()}>Send</Button>
        </div>
      </div>
    </section>
  )
}
