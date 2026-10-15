import { clipTranscript } from '../../ai/prompts'
import type { AiTicket, DiagramJson, InterviewFinal, TranscriptMessage } from '../../ai/types'
import { callJob } from '../../data/aiActions'
import { isReadOnlyError, READ_ONLY_MESSAGE } from '../../data/writer'
import type { DojoDB } from '../../data/db'
import { now } from '../../lib/clock'
import { CLIPPED, designDigest } from '../../rules/designDigest'
import { learnerWords } from '../../rules/learnerWords'
import type { PlanDesignRef } from '../../rules/designs'

/** The only file in chain D that calls the AI (C-DESIGN §7 jobs `interview` and `diagram`), via callJob (aiLog). */
export type AiOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * UAT cu-7 P2-1: the validator's own wording ("score must be 0-20; perItem must be a list…") is for the helper's log, not
 * for the learner. A reply that stayed unusable after the repair and the helper's one re-ask reads as a plain sentence that
 * says what is lost (nothing) and what to do. Every other failure keeps its raw error (AI.md "UI contract": raw error + Retry).
 */
export const INVALID_REPLY = {
  turn: "The AI partner's reply did not come through in a form Dojo can use. Nothing is lost: Retry asks again.",
  grade: 'The grade did not come through in a form Dojo can read. Retry asks again, or score the session yourself below.',
  diagram: 'The reference diagram did not come through in a form Dojo can draw. Retry asks again.',
} as const
const friendly = (code: string, raw: string, plain: string) => (code === 'invalid_output' ? plain : raw)
/** The job is stored under the name `interview`; a learner never reads that word (GLOBAL-01), so a raw failure text (turn, grade or reference) says "session". */
export { learnerWords }

/**
 * A write that threw inside an automatic flow (quota, an IndexedDB error, a read-only refusal) reads as the same plain sentence the
 * unusable-reply failures use, with Retry beside it; a read-only browser says so in the app's own words. Never the raw error.
 */
export const thrownMessage = (e: unknown, kind: keyof typeof INVALID_REPLY): string => (isReadOnlyError(e) ? READ_ONLY_MESSAGE : learnerWords(INVALID_REPLY[kind]))

export function designTicket(item: PlanDesignRef): AiTicket {
  return { id: item.id, title: item.title, track: 'design', difficulty: item.difficulty, links: item.refs }
}

/**
 * The helper refuses a body over MAX_BODY_BYTES (64 KiB, server/helper.mjs) with a 413. The limit is on encoded bytes of the
 * JSON text, and JSON escaping can double a character (a quote or backslash) or sextuple it (a control character), so a
 * worst-case transcript (19 x 2,000 characters) plus an 8,000-character digest can pass 64 KiB. Review Focus 5.
 */
const HELPER_BODY_LIMIT = 64 * 1024
const BODY_BUDGET = HELPER_BODY_LIMIT - 4 * 1024 // headroom for the ticket and the other context fields
const MIN_MESSAGE_CHARS = 100
const MIN_DESIGN_CHARS = 400
const encoder = new TextEncoder()
const sizeOf = (v: unknown): number => encoder.encode(JSON.stringify(v)).length

function cut(text: string, max: number, mark: string): string {
  if (text.length <= max) return text
  let end = Math.max(0, max)
  const c = text.charCodeAt(end - 1)
  if (end > 0 && c >= 0xd800 && c <= 0xdbff) end -= 1 // never leave half of a surrogate pair
  return `${text.slice(0, end)}${mark}`
}

/**
 * Sends the request as is when it fits. Otherwise every message and the digest shrink together (by one factor, in steps) until
 * the encoded body fits; if even the floor does not fit, the oldest messages go. The newest messages and the digest's head stay.
 */
function fitBody<C extends { transcript: TranscriptMessage[]; design?: string }>(ticket: AiTicket, context: C): C {
  const total = (c: C) => sizeOf({ ticket, context: c })
  if (total(context) <= BODY_BUDGET) return context
  const design = context.design ?? ''
  const longest = Math.max(MIN_MESSAGE_CHARS, ...context.transcript.map(m => m.text.length))
  let transcript = context.transcript
  for (let f = 0.9; ; f *= 0.9) {
    const msgMax = Math.max(MIN_MESSAGE_CHARS, Math.floor(longest * f))
    const next: C = {
      ...context,
      transcript: transcript.map(m => ({ from: m.from, text: cut(m.text, msgMax, '…') })),
      ...(design ? { design: cut(design, Math.max(MIN_DESIGN_CHARS, Math.floor(design.length * f)), CLIPPED) } : {}),
    }
    if (total(next) <= BODY_BUDGET) return next
    if (msgMax === MIN_MESSAGE_CHARS && (!design || design.length * f <= MIN_DESIGN_CHARS)) {
      if (transcript.length <= 1) return next
      transcript = transcript.slice(1) // floor reached and still too big: drop the oldest message
      f = 0.9
    }
  }
}

/** The chat has no last turn, so a turn or Hint request carries only the newest messages; `turn` still counts every answer. The grade reads the whole chat (fitBody sets the byte budget). */
export const TRANSCRIPT_WINDOW = 20

function interviewContext(item: PlanDesignRef, messages: readonly TranscriptMessage[], opts: { hint?: boolean; design?: string }) {
  const transcript = clipTranscript(messages.slice(-TRANSCRIPT_WINDOW))
  const turn = messages.filter(m => m.from === 'you').length
  // `answers` only matters to jobPrompt when there is no transcript; the transcript carries the conversation (I2).
  return { turn, answers: [] as string[], deepDives: item.deepDives, transcript, ...(opts.hint ? { hint: true as const } : {}), ...(opts.design ? { design: opts.design } : {}) }
}

export async function askInterviewer(d: DojoDB, item: PlanDesignRef, messages: readonly TranscriptMessage[], opts: { hint?: boolean; design?: string } = {}): Promise<AiOutcome<string>> {
  const ticket = designTicket(item)
  const r = await callJob(d, 'interview', { ticket, context: fitBody(ticket, interviewContext(item, messages, opts)) }, now())
  if (!r.ok) return { ok: false, error: learnerWords(friendly(r.code, r.error, INVALID_REPLY.turn)) }
  const say = (r.output as { say?: unknown }).say
  return typeof say === 'string' && say.trim() ? { ok: true, value: say } : { ok: false, error: INVALID_REPLY.turn }
}

/** The final grade reads the chat, the notes and the diagram together; it is the `grade` job with sessionGrade (DESIGN-52). */
export async function gradeInterview(d: DojoDB, item: PlanDesignRef, messages: readonly TranscriptMessage[], design = ''): Promise<AiOutcome<InterviewFinal>> {
  const ticket = designTicket(item)
  const context = fitBody(ticket, { sessionGrade: true as const, deepDives: item.deepDives, transcript: clipTranscript(messages), ...(design ? { design } : {}) })
  const r = await callJob(d, 'grade', { ticket, context }, now())
  if (!r.ok) return { ok: false, error: learnerWords(friendly(r.code, r.error, INVALID_REPLY.grade)) }
  const out = r.output as unknown as InterviewFinal
  return out && (out as { done?: unknown }).done === true ? { ok: true, value: out } : { ok: false, error: INVALID_REPLY.grade }
}

/** The stored session's digest, read after the write queue is flushed so the last keystrokes count. */
export async function freshDigest(d: DojoDB, sessionId: string, max: number): Promise<string> {
  const s = await d.designSessions.get(sessionId)
  return s ? designDigest(s, max) : ''
}

export async function drawReference(d: DojoDB, item: PlanDesignRef): Promise<AiOutcome<DiagramJson>> {
  const r = await callJob(d, 'diagram', { ticket: designTicket(item), context: { deepDives: item.deepDives, refs: item.refs } }, now())
  return r.ok ? { ok: true, value: r.output as DiagramJson } : { ok: false, error: learnerWords(friendly(r.code, r.error, INVALID_REPLY.diagram)) }
}

const inflight = new Map<string, Promise<unknown>>()

/** One in-flight call per key: React StrictMode runs effects twice in dev, and a double click must not ask twice. */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
