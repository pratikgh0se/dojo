import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '../../ai/types'
import { useDb } from '../../app/providers'
import { appendInterview } from '../../data/designSessionActions'
import type { DesignSession } from '../../data/types'
import type { PlanDesignRef } from '../../rules/designs'
import { TRANSCRIPT_TEXT_MAX } from '../../ai/prompts'
import { interviewStage, interviewStoppedText, lockReason, needsInterviewerTurn } from '../../rules/designSession'
import { Button } from '../../ui/primitives'
import { BlockLoader } from './BlockLoader'
import { askInterviewer, once } from './designAi'

type Msg = TranscriptMessage

/** `follow`: the live panel keeps the newest message in view (UAT cu-7 P3-3); a finished transcript is read from the top. */
export function TranscriptLog({ messages, follow = false }: { messages: Msg[]; follow?: boolean }) {
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = log.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, messages.length])
  return (
    <div ref={log} role="log" aria-label="Interview transcript" className="ds-log" tabIndex={0}>
      {messages.map((m, i) => (
        <p key={i} className={`ds-msg ds-msg-${m.from}`} data-testid="session-msg" data-from={m.from}>{m.text}</p>
      ))}
    </div>
  )
}

/** AI.md `interview`: turn 0 requirements, then each deep dive with one push-back; the box locks with the canvas. */
export function InterviewerPanel({ item, session }: { item: PlanDesignRef; session: DesignSession }) {
  const d = useDb()
  const messages = session.interview?.messages ?? []
  const stage = interviewStage(messages)
  const locked = session.phase !== 'drawing'
  const reason = lockReason(session)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const ask = useCallback(async (msgs: Msg[]) => {
    setBusy(true)
    setError('')
    const turn = msgs.filter(m => m.from === 'you').length
    const r = await once(`interview:${session.id}:${turn}`, async () => {
      const res = await askInterviewer(d, item, msgs)
      if (res.ok) await appendInterview(d, session.id, [{ from: 'interviewer', text: res.value }])
      return res
    })
    setBusy(false)
    if (!r.ok) setError(r.error)
  }, [d, item, session.id])

  // Turn 0 only when the transcript is empty; a reload never asks by itself otherwise (D-35).
  useEffect(() => {
    if (!locked && messages.length === 0) void ask([])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!text.trim() || sending.current || locked || stage.complete || busy) return
    sending.current = true
    try {
      const said = text
      const ok = await appendInterview(d, session.id, [{ from: 'you', text: said }])
      if (!ok) return
      setText('')
      box.current?.focus()
      await ask([...messages, { from: 'you', text: said }])
    } finally {
      sending.current = false
    }
  }

  const status = locked && !stage.complete && reason ? interviewStoppedText(reason) : stage.status
  const askAgain = !locked && !busy && !error && messages.length > 0 && needsInterviewerTurn(messages)
  const closed = locked || stage.complete

  return (
    <section className="sr-panel ds-interviewer" data-testid="session-interviewer" aria-label="Interviewer">
      <h2 className="sr-panel-title">Interviewer</h2>
      <p className="ds-istatus" data-testid="session-interview-status">{status}</p>
      <TranscriptLog messages={messages} follow />
      {busy && <BlockLoader label="The interviewer is thinking" />}
      {error && (
        <p className="ds-ai-error" data-testid="session-ai-error">
          {error} <Button onClick={() => void ask(messages)}>Retry</Button>
        </p>
      )}
      {askAgain && <Button onClick={() => void ask(messages)}>Ask again</Button>}
      <textarea
        ref={box} className="ds-answer" aria-label="Your answer" rows={3} value={text} disabled={closed}
        maxLength={TRANSCRIPT_TEXT_MAX}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send() } }}
      />
      <Button variant="accent" disabled={closed || busy || !text.trim()} onClick={() => void send()}>Send</Button>
    </section>
  )
}
